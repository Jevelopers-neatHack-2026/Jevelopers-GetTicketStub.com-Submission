# Neatlogs ingestion and readback

This runbook covers exporting harness workflow events to Neatlogs and proving they arrived. The owning code is `src/observability/private/neatlogs-{config,otlp,live}.js` and the operator tool is `tools/neatlogs-live-verify.mjs`. Facts below were checked against the [Neatlogs docs](https://docs.neatlogs.com/api-reference) on 2026-10-11.

## Credentials: one per purpose

Neatlogs separates ingestion from reading. Do not assume one credential works for both.

| Setting | What it is | Used for | Where it comes from |
| --- | --- | --- | --- |
| `NEATLOGS_API_KEY` | Project key, sent as the `x-api-key` header | OTLP/HTTP ingest to `{ingest}/v1/traces` | Neatlogs → Settings → API keys → Project API key |
| `NEATLOGS_TOKEN` | Expiring service-account token, sent as `Authorization: Bearer` | Public API readback | Settings → Service accounts: create an account, bind it to the project with the least role, mint a token with `context:read` and `observability:read` |
| `NEATLOGS_PROJECT_ID` | UUID of the bound project, sent as `x-project-id` | Public API readback | The project the service account is bound to |
| `NEATLOGS_ENDPOINT` | Ingest origin. Blank means US `https://ingest.neatlogs.com` | Region selection | EU: `https://eu.ingest.neatlogs.com` |
| `NEATLOGS_HOST` | App/API origin. Blank means US `https://app.neatlogs.com` | Region selection | EU: `https://eu.app.neatlogs.com` |

Notes:

- Credentials are bound to the region that issued them. The loader refuses a mixed pair, such as an EU ingest origin with the US app origin.
- SDK ingest keys "do not authorize Public API reads" per the Neatlogs authentication page, and SDK, dashboard and Public API credentials have separate policies.
- The per-user HTTP write key (`nlw_…`, for `POST /v1/trace`) is a different credential. The harness does not use it.
- These names come from the Neatlogs documentation. The harness adds no other Neatlogs variables.

## Loading configuration

Nothing is read implicitly. Configuration is assembled by `loadNeatlogsConfig({ env, envFile })`:

- `env` is an explicit object, normally a copy of the server process environment that the host filled from its secret store.
- `envFile` is optional and must be named explicitly, for example `--env-file .env` in local development. Only the five names above are read. Other lines are ignored.
- Process values win over the file. Credential values can only be reached through `ingestKey()` and `readbackToken()`. JSON and `util.inspect` output show only a redacted summary.
- After loading, `scrubNeatlogsEnvironment(process.env)` removes the five names from the process environment. This is needed because the pinned SDK capture refuses to start while any `NEATLOGS_*` name is present, and it also stops child processes from inheriting the secrets.

Local: copy `.env.example` to `.env` (git-ignored by `.gitignore`) and fill in the values. Deployment: put the values in the host's server secret settings. Never put them in GitHub, issues, evidence, or command arguments.

## Data path

1. Durable workflow events are projected into `agent-harness.telemetry.v1` records with HMAC `tok1_` tokens (`projectTelemetryEvent`). Raw IDs, checkpoints, URLs, customer text and errors never leave this step.
2. The existing pinned SDK capture (`neatlogs@1.1.28`, local exporter, owned mask) produces a sanitized `captured_local` envelope. This step is unchanged.
3. `planNeatlogsExport` turns each root plus completion marker into one trace:
   - `traceId` and span IDs are derived from the event token and a delivery generation (0–3). Retries within a generation resend the same IDs.
   - A trace not found within the bounded readback window is only `not observed in that window`; it does not prove permanent loss or deduplication behavior. Explicit `--recover` moves only bounded-404 `missing` traces to the next generation (new IDs, same content and session) and keeps earlier IDs as `priorTraceIds`. A delayed earlier trace can still appear, so recovery can create a duplicate event.
   - The session ID is the workflow token, which groups one job's events.
   - Tags are `agent-harness@<40-char commit>` and `evidence:synthetic` for verification runs.
   - The root span input is the canonical JSON of the validated projected record, and nothing else.
   - Saved v1 plans from the earlier verifier may omit `generation` and `priorTraceIds` only for generation 0; those values are reconstructed from the canonical input. Recovery rebuilds the bounded plan before sending and rejects a noncanonical workflow name.
4. `encodeNeatlogsExportRequest` writes an OTLP `ExportTraceServiceRequest` protobuf. `sendNeatlogsPlan` POSTs it with `x-api-key`. Redirects are refused and request and response sizes are bounded.
5. `readbackNeatlogsPlan` uses the Public API with the service-account token:
   - It calls `GET /project` and requires the configured UUID.
   - It polls `GET /traces/{traceId}` until `finalizationStatus` is `finalized`.
   - It reads `GET /traces/{traceId}/spans` and `GET /traces/{traceId}/spans/{rootSpanId}/payload?fields=input`.
   - A 404 trace response is only bounded-window non-observation; 409 remains conflict/pending, and 404/409 projection responses remain not-ready. Verification requires one complete span page (`hasMore: false`, `nextCursor: null`), a matching declared span count, matching trace/span IDs, and the exact canonical input string.

Correlation available on read: trace ID ↔ event token, root span ID, session ID ↔ workflow (job) token, input ↔ sequence/revision/fence/event type/state, and tags ↔ component revision. The current projection does not contain operation, billable-attempt, provider, decision or artifact references, so none are invented.

## Outcome semantics

Send results never set `deliveryConfirmed`:

| Status | Meaning |
| --- | --- |
| `receiver_accepted` | HTTP 2xx and zero rejected spans. Not proof of storage. |
| `partially_rejected` | 2xx with `partialSuccess.rejectedSpans > 0` |
| `rejected` | 401/403 (credential) or other 4xx with no earlier ambiguous attempt. Not retried. |
| `not_accepted` | Retries exhausted on 429 |
| `outcome_unknown` | Timeout, connection loss, 5xx, oversized or unparseable 2xx, or cancellation after a request starts. Spans may or may not be stored. |
| `not_configured` / `aborted` | Not configured, or cancellation before the next POST attempt starts. A pre-aborted first call sends zero requests. |

Retries (at most 5, default 3) resend identical bytes with the same deterministic IDs. `Retry-After` is a minimum: numeric seconds and all three HTTP-date forms are honored for 429/503 responses. If the minimum is longer than the local 10-second wait bound, including an arbitrarily large valid numeric delay, the operation stops instead of retrying early. Cancellation after a POST starts is `outcome_unknown`; cancellation during a wait after a completed 429 stops before the next POST.

A terminal refusal after an earlier timeout/5xx does not settle that earlier request; the result stays `outcome_unknown` and includes only static status/reason fields for the last response.

Readback results:

- `verified`: every trace is finalized and its IDs, session, workflow name, tags, span tree and input match.
- `pending`: not finalized, in conflict, or projection data is not ready within the poll budget.
- `missing`: trace lookup returned 404 for every poll in the bounded observation window. This is not proof of permanent loss. It is the only state that `--recover` re-sends, under the next generation, with duplicate-delivery risk recorded.
- `mismatch`: duplicate span IDs, unexpected spans, altered input, missing tags, dead-lettered trace or wrong project.
- `readback_failed`: 401/403, bounded retry-after refusal, cancellation or transport failure.
- `readback_unavailable`: no token or project UUID.
- `duplicateEventDeliveries` counts events found under more than one generation, which can happen when an earlier trace appears after an opt-in recovery. The event is delivered under both IDs, so this is reported rather than hidden.

Only `verified` sets `deliveryConfirmed: true` in evidence. The completion marker may or may not be stored as a span by the receiver. Both are accepted, and `markerStored` records which happened.

The durable telemetry cursor (`TelemetryExporter`) is **not** advanced by this path. Its sink contract is limited to 500 ms and retries on timeout, so wiring a network sink there needs a durable "sent, awaiting readback" state first. That is follow-up work.

## Commands

All commands use Node 22.23.3. Run them from the repository root with dependencies installed (`npm ci --ignore-scripts`).

```bash
# Offline: build a synthetic workflow, capture it, run the redaction gate. No network.
node tools/neatlogs-live-verify.mjs --mode offline \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-offline.json --plan /tmp/neatlogs-plan.json

# Live send of one synthetic workflow (needs NEATLOGS_API_KEY).
node tools/neatlogs-live-verify.mjs --mode send --env-file .env \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-send.json --plan /tmp/neatlogs-plan.json

# Readback of a saved plan (needs NEATLOGS_TOKEN + NEATLOGS_PROJECT_ID).
node tools/neatlogs-live-verify.mjs --mode readback --env-file .env \
  --plan /tmp/neatlogs-plan.json --evidence /tmp/neatlogs-readback.json

# Both in one run; --recover re-sends bounded-window `missing` traces once under the next generation and records the duplicate risk.
node tools/neatlogs-live-verify.mjs --mode send-and-readback --recover --env-file .env \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-live.json --plan /tmp/neatlogs-plan.json

# Offline tests (fake transport, no network).
npm run test:neatlogs-live
```

The tool seeds synthetic canaries (fake private URL, email, token, customer and error text) into the durable workflow's raw fields. It refuses to send if any canary appears in the encoded export body, and it refuses to write evidence that contains a canary or a configured credential value. Evidence is labeled `offline-fixture` or `live-synthetic`. Never point this tool at customer workflows.

## Dashboard check

Open `https://app.neatlogs.com` (or the EU origin) and select the project. Under **traces**, filter by workflow `agent-harness.workflow-events`, then find the trace IDs listed in the evidence plan. The session is the `tok1_…` workflow token. This is an independent visual check. It is not a substitute for the API readback evidence.
