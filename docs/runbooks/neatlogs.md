# Neatlogs ingestion and readback

This runbook covers exporting harness workflow events to Neatlogs and proving they arrived. The owning code is `src/observability/private/neatlogs-{config,otlp,live}.js` and the operator tool is `tools/neatlogs-live-verify.mjs`. Facts below were checked against the [Neatlogs docs](https://docs.neatlogs.com/api-reference) on 2026-10-11.

## Credentials: one per purpose

Neatlogs separates ingestion from reading. Do not assume one credential works for both.

| Setting | What it is | Used for | Where it comes from |
| --- | --- | --- | --- |
| `NEATLOGS_INGEST_KEY` | Project key, sent as the `x-api-key` header | OTLP/HTTP ingest to `{ingest}/v1/traces` | Neatlogs → Settings → API keys → Project API key |
| `NEATLOGS_API_KEY` | Legacy alias for `NEATLOGS_INGEST_KEY` during the rename | Same ingest use as `NEATLOGS_INGEST_KEY` | Existing host setting; migrate to the new name |
| `NEATLOGS_READ_TOKEN` | Expiring service-account token, sent as `Authorization: Bearer` | Public API readback | Settings → Service accounts: create an account, bind it to the project with the least role, mint a token with `context:read` and `observability:read` (the create dialog pre-ticks only `context:read`; tick **Traces and sessions · Read** too, since scopes cannot be changed after creation) |
| `NEATLOGS_TOKEN` | Legacy alias for `NEATLOGS_READ_TOKEN` during the rename | Same readback use as `NEATLOGS_READ_TOKEN` | Existing host setting; migrate to the new name |
| `NEATLOGS_PROJECT_ID` | UUID of the bound project, sent as `x-project-id` | Public API readback | The project the service account is bound to |
| `NEATLOGS_ENDPOINT` | Ingest origin. Blank means US `https://ingest.neatlogs.com` | Region selection | EU: `https://eu.ingest.neatlogs.com` |
| `NEATLOGS_HOST` | App/API origin. Blank means US `https://app.neatlogs.com` | Region selection | EU: `https://eu.app.neatlogs.com` |

Notes:

- **Renamed 2026-10-12.** `NEATLOGS_API_KEY` and `NEATLOGS_TOKEN` remain accepted as legacy aliases while hosts migrate to the canonical names. For each renamed credential, the source order is canonical process environment, canonical named file, legacy process environment, then legacy named file. The canonical name therefore wins even when its value comes from the file and a legacy value is in the process environment. A blank or whitespace-only candidate falls through; an invalid nonblank selected credential is rejected instead of falling back. Removal of the aliases requires a separately reviewed change.
- Credentials are bound to the region that issued them. The loader refuses a mixed pair, such as an EU ingest origin with the US app origin.
- SDK ingest keys "do not authorize Public API reads" per the Neatlogs authentication page, and SDK, dashboard and Public API credentials have separate policies.
- The per-user HTTP write key (`nlw_…`, for `POST /v1/trace`) is a different credential. The harness does not use it.
- `NEATLOGS_PROJECT_ID`, `NEATLOGS_ENDPOINT` and `NEATLOGS_HOST` are the names from the Neatlogs documentation. The harness adds no other Neatlogs variables.

## Loading configuration

Nothing is read implicitly. Configuration is assembled by `loadNeatlogsConfig({ env, envFile })`:

- `env` is an explicit object, normally a copy of the server process environment that the host filled from its secret store.
- `envFile` is optional and must be named explicitly, for example `--env-file .env` in local development. Only the seven names in the table above are read. Other lines are ignored.
- Unrenamed settings (`NEATLOGS_PROJECT_ID`, `NEATLOGS_ENDPOINT`, and `NEATLOGS_HOST`) use a nonblank process value before the file. Credential values can only be reached through `ingestKey()` and `readbackToken()`. JSON and `util.inspect` output show only a redacted summary.
- After loading, `scrubNeatlogsEnvironment(process.env)` removes all seven recognized names from the process environment. This is needed because the pinned SDK capture refuses to start while any `NEATLOGS_*` name is present, and it also stops child processes from inheriting the secrets.

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

The synthetic verifier path above does not use the durable telemetry cursor (`TelemetryExporter`). The runtime path below does.

## Runtime path: durable exporter → outbox → OTLP sender

This is how a trace of a real harness workflow reaches Neatlogs. It is off by default.

1. **Opt-in.** `loadNeatlogsTelemetryOptIn({ enabled: true, env, envFile, scrubEnv })` returns `{ enabled: false }` unless `enabled` is exactly `true`. When it is enabled, it loads settings through the same strict `loadNeatlogsConfig`, scrubs all seven recognized names from `scrubEnv`, and refuses to start without an ingest key. No new settings are added.
2. **Exporter.** `createNeatlogsOperationsTelemetry({ databasePath, outboxDirectory })` builds the existing `TelemetryExporter` on its own store connection. It is passed to `createOperationsWorker({ telemetry })`, the worker's existing injection point.
   - The worker itself is unchanged and still makes no network calls.
   - Records are the existing `agent-harness.telemetry.v1` projection with its fixed event allowlist. Policy drops are unchanged; for example, `private_local_step_*` events are dropped.
   - Tokens use a random HMAC key for each process. A run's events share one session (the workflow token). Tokens cannot be linked across runs.
3. **Outbox sink.** `createNeatlogsOutboxSink({ directory, maxRetainedBatches: 128 })` is the exporter's sink. It validates the batch with the mapper, then writes it atomically to `batch-<first>-<last>.json` (mode 0600, file and directory fsync, rename). It does no network I/O. The cursor advances only after the batch is durable on disk.
   - `maxRetainedBatches` defaults to 128 (four 32-batch drain pages) and accepts only integers from 1 through 1,024. Invalid values throw `INVALID_OUTBOX_LIMIT` before creating the directory. This is a local operational admission policy, not a provider quota or an accepted retention/deletion policy. The private `createNeatlogsOperationsTelemetry` factory forwards the same optional field; the runtime CLI uses the default.
   - Every retained batch occupies a slot regardless of sender or readback state. A slot allows its batch to grow to the existing 2 MiB serialized limit as immutable intents and history accumulate. Thus normally admitted retained batch payloads are bounded by `maxRetainedBatches × 2 MiB` (256 MiB at the default), plus the scheduling cursor. Capacity is not calculated from the smaller initial unsent file. A serialized atomic update may also temporarily hold one replacement file; filesystem metadata, retained crash artifacts and other host data are not included in that payload bound.
   - At capacity, an exact retry of already stored records is acknowledged without rewriting them. A page containing a genuinely new suffix returns `{ accepted: false, acceptedCount: 0 }` without creating a file or acknowledging that page. The existing exporter records `TELEMETRY_SINK_UNAVAILABLE`, retains its cursor and pending events, and reports `pendingRecords`; it does not count a capacity refusal as a policy drop. The independent authoritative usage/outbox data is untouched.
   - Admission streams at most the configured number of batch entries, one cursor entry and one final EOF/overflow observation, with a fixed 32-entry directory buffer. It retains at most that many batch paths and the requested page's at-most-32 matching source records. An over-cap directory is retained and refuses all admissions, including replay when a complete inventory cannot be established. Unexpected entries, abandoned temporary files, nonregular entries and files beyond their size limits likewise refuse admission without cleanup. Diagnose those artifacts before an owner-approved retention or migration action; a caller may explicitly choose a larger valid local cap.
   - Keep the outbox dedicated to batch files and its regular, bounded `drain-cursor.json`. Store evidence JSON, plan files, databases and other output outside it, as the commands below do. Drain-cursor content validation still belongs to the existing drain path; inventory checks do not acknowledge delivery or validate a provider result.
   - File enumeration, reads and durability calls are synchronous; an exporter timeout cannot preempt a blocked filesystem call. Slow or unavailable storage can block the event loop or refuse the sink write.
   - If a retry after a timeout carries a page that grew in the meantime, only the new suffix is written.
   - A stored record that differs from the retried one is refused.
4. **Drain.** `drainNeatlogsOutbox({ directory, config, tags, forbidden, send, readback, recover })` visits at most 32 retained batches per call. A separate `drain-cursor.json` schedules batches in numeric sequence order, starting after the previous visit and wrapping at the end. Retained terminal batches and unresolved retries cannot permanently occupy the first page. New batches use `agent-harness.neatlogs.outbox-batch.v2`; each selected `pending_send` batch is processed as follows when `send` is enabled:
   1. On its first send only, it captures the batch through the pinned SDK and plans it with `planNeatlogsExport`.
   2. It scans the encoded body for the run's raw identifiers and configured credentials. A hit marks the batch `blocked`, with no request. A later leak hold preserves any earlier send uncertainty.
   3. It durably stores the exact encoded body, its SHA-256, tags, span timestamps, generation and selected records in an immutable dispatch intent. The regional origins and a hash of the optional configured project UUID are pinned too; credentials and the raw project UUID are not stored. It re-derives the plan from the original records and validates the bytes, times and IDs before any POST.
   4. It records a call before invoking `sendNeatlogsPlan`, then durably records each possible POST start through the sender's synchronous `onPostStart` boundary. A failed intent or start-marker write prevents the dependent POST.
   5. It writes the actual result back after the call. A process exit or failed result write leaves the start marker unresolved. Restart retries use the stored bytes, tags, times and generation without another SDK capture. Even a caller callback that interrupts between the durable marker and fetch leaves conservative uncertainty.

   After that:
   - `outcome_unknown`, `not_accepted`, `aborted` and `not_configured` stay `pending_send` until readback changes the state. A later send retries the exact same intent. A later refusal cannot settle an earlier unknown or interrupted call: the summary remains `outcome_unknown`, and every earlier result is retained. A receiver acceptance in a later call still records `priorOutcomeUnknown`; it cannot prove deduplication or delivery.
   - With `readback`, any recorded possible delivery is eligible, including an interrupted POST or an attempt held at its retry limit. The plan is re-derived from the stored records and intended generations. The resulting state (`verified`, `pending`, `missing`, `mismatch`, `readback_failed` or `readback_unavailable`) is persisted without the project UUID. Readback leaves the send history unchanged.
   - Once readback changes the state, ordinary drains continue readback without automatically resending. `pending`, unavailable and failed observations leave the same generation unresolved. A `missing` observation permits only explicit recovery, or later readback of that same intended generation. `verified` and `mismatch` are terminal for this file-outbox drainer.
   - Tags are `agent-harness@<sha>`, `evidence:runtime` and `harness-mode:<mode>`. The drain refuses `evidence:synthetic`.
   - With `recover` (`--recover` on the tool), a `missing` batch selects only its bounded-404 traces for the next delivery generation. It persists that subset, its exact bytes and the full updated readback plan **before** sending; prior plans and observations remain in `recoveryHistory`. An unknown or interrupted recovery keeps that new intent for retries, even when the next call does not select another recovery. Earlier IDs remain `priorTraceIds`, and delayed visibility is reported as duplicate-delivery risk and, when observed, `duplicateEventDeliveries`.
5. **Mapper allowlist.** The SDK mapper now accepts every event type on the durable telemetry allowlist, including the `operations_work_*` types. A test asserts that the two lists are equal.

The telemetry exporter's cursor advances when the batch is durably in the outbox. "Sent, awaiting readback" is the batch file's state.

### Intent bounds, configuration changes and older batches

Each v2 batch retains at most four intents: its initial generation and three explicit recovery selections. Each intent holds at most 32 sender-call records and eight possible POST starts across restarts; the per-call sender limit remains one to five attempts, capped to the remaining total. Exhaustion marks the batch `held` with `DISPATCH_ATTEMPT_LIMIT_REACHED` or `RECOVERY_GENERATION_LIMIT_REACHED`. Holding neither confirms delivery nor deletes the records. Eligible held batches can still be read back; reaching a bound grants no new recovery generation.

The batch's `send` summary, and `recovery.send` for the current recovery, are derived from the current validated intent whenever it is reopened or persisted. Inspection through `iterateNeatlogsOutboxSnapshot` and the runtime CLI therefore includes an interrupted possible POST even when the process exited before recording its result, or the next drain stops at the eight-POST cap. A readback-only restart may verify the intended trace while its sender outcome remains unknown; readback never creates a sender acknowledgement or fills in an unfinished call's `result` or `completedAt`. An intent with no completed call and no possible POST has `send: null`, including a newly selected recovery whose previous generation was accepted. A later incomplete call with zero possible POSTs preserves the last known result for that same intent. Read-only inspection derives these summaries without rewriting the retained files or advancing the drain cursor.

When a completed sender call records `retryAfterMinimumMs`, subsequent drains defer POSTs for that batch until its `completedAt` plus that minimum. The constraint is read from all validated call histories, including earlier recovery generations, so a newer summary cannot erase it. The drainer returns promptly with the existing pending/missing state, without appending a call, consuming a POST attempt, allocating a recovery generation or sleeping through the delay. It still permits bounded readback and checks tag/project conflicts before a deferred send. A later drain at the exact deadline may proceed with the same stored intent bytes. Missing, malformed and zero receiver minima add no wait. Large minima use exact integer comparison and cannot overflow into an early retry; a backward wall-clock adjustment extends the wait conservatively. This is a per-batch constraint from durably recorded sender results, not a cross-batch/account rate limiter. A process exit before recording a response still has an unknown outcome and no recovered receiver header; preserve that uncertainty and use the existing host recovery policy.

The serialized batch is limited to 2 MiB, including base64 wire snapshots and retained call, plan and readback history. Oversized writes fail before the dependent POST. Reopening validates the same size bound, duplicate JSON keys, the parser's depth-64 budget, source records, intent fields, exact wire encoding and full current-plan identity before network work. The regression suite exercises 32 records, ten tags, four generations, 32 calls and eight possible starts per intent through the actual restart parser. Corrupt or oversized artifacts remain on disk for diagnosis and are never silently replaced with a fresh send.

Retries refuse changed tags (`DISPATCH_TAG_CONFLICT`) or a changed region/project binding (`DISPATCH_TARGET_CONFLICT`) before I/O. Readback uses the stored tags. Supply the original configuration for the retained intent; adding or removing `NEATLOGS_PROJECT_ID` also changes that binding. Set the intended project before the first send if later readback is required. Credential rotation is possible because secrets are not persisted, but the caller remains responsible for using credentials for the originally intended account and project. These local hashes do not authenticate a provider account or grant permission to send.

Older `agent-harness.neatlogs.outbox-batch.v1` files have no reliable immutable dispatch snapshot: the earlier sender could POST and exit while `plan` and `send` were still null. They cannot safely be classified as unsent. A send request therefore retains the original data and records `legacy_held` / `LEGACY_DISPATCH_BYTES_UNAVAILABLE`, with `outcomeResolved: false` and `automaticResendAllowed: false`. Recorded accepted, partial or unknown legacy plans may still be read back under their existing IDs. Missing legacy traces never trigger automatic recapture, migration or recovery. The operator must preserve the artifact and reconcile any available historical sender/provider evidence before a separately reviewed migration or intentional replacement; this change does not invent old wire bytes.

The drain scheduling cursor is durably written **before** reading or processing each selected batch. If a batch's content is invalid, capture throws, or the process exits during delivery, the next invocation can visit later batches; it returns to the retained failed batch after rotation. This cursor records a visit, not delivery or readback, and never settles or deletes a batch. A selected filename with an invalid numeric range fails with `BATCH_INVALID` before it can replace the cursor and requires repair. A deleted last-visited batch does not reset progress: selection starts at the next numeric range, or wraps if none remains. Malformed, unsupported, oversized, nonregular or symlink cursor files fail closed with `DRAIN_CURSOR_INVALID` before any delivery work; they are not silently reset. An absent cursor starts with the first range.

`send: false` still prohibits sends and recovery. `readback: false` still prohibits readback. Setting both to `false` inspects one page without creating or advancing the scheduling cursor. A readback-only invocation may advance past unsent batches, but cannot send or acknowledge them. An empty outbox creates no cursor.

The cursor is not a cross-process lease or an ownership fence. The caller must serialize file-outbox drainers and writers externally and use the intended admission policy. The 32-batch limit bounds drain work; admission has the separate streamed inventory bound above. Drain and evidence enumeration still grow with the retained file count, including directories populated before a cap applied. Evidence inspection yields one parsed batch at a time and the CLI immediately reduces it to a sanitized summary, but its directory list and retained summary array still grow with the outbox. The admission cap does not prune retained data, clean crash artifacts, fence concurrent writers or impose a hard total-host-disk or filesystem-latency guarantee. Those retention/ownership requirements remain separate work. Durable intent, admission and synthetic recovery tests establish only the private file-outbox behavior described here; they do not establish live provider delivery, financial settlement, host capacity or global acceptance.

## Delivery queue for long-running hosts

`src/observability/private/neatlogs-delivery-queue.js` keeps the "sent, awaiting readback" state in SQLite (WAL, `synchronous=FULL`), separate from the workflow store, for a host process that hands the harness events in-process and drains on a schedule. The harness worker's own telemetry cursor uses the file outbox in `neatlogs-outbox.js` (see "Runtime path").

- **Producers enqueue locally.** `NeatlogsDeliveryQueue.enqueue(entries)` is one local transaction, idempotent by event token, and capped at 5,000 unsettled rows (further rows are refused and counted). Entries hold only `tok1_` tokens, a fixed event type, canonical input JSON, and up to 24 scalar attributes whose names may not start with `neatlogs.`. On schema migration, retained v1 rows keep their original bytes and are held from automatic send; a same-token v2 event with different input is an immutable-content conflict, not a duplicate or an instruction to rewrite the legacy row.
- **Drain.** `drainNeatlogsDeliveryQueue(queue, config, { tags })` takes a cross-process lease, then:
  1. With a readback token, it reads due `sent` rows (one bounded page, at most 32) and advances the fairness cursor only as a trace request starts. `verified` settles; a definitive `mismatch` (including `dlq`) settles as `failed`; a trace still 404 after 10 minutes may move to the next generation and is re-queued, with prior IDs retained. An ambiguous outcome that reaches its bounded stop condition stays `sent` and unresolved: pending/conflict/projection uncertainty at the deadline and a finite 404 after generation 3 are held without automatic re-poll, resend, settlement, or settled-row pruning. Held rows retain their event identity and continue to count against the 5,000 unsettled-row cap.
  2. It sends due `queued` rows, at most 32 per request and 4 requests per pass. `receiver_accepted` and `partially_rejected` become `sent` for readback. `outcome_unknown` also remains `sent`: it is not blindly re-posted, and unresolved rows are held when their bounded readback decision ends. Explicit nonacceptance such as `not_accepted` is retried with backoff from 30 s to 30 min; `rejected` and retry exhaustion settle as `failed`. A finite server `Retry-After` minimum is persisted exactly, including values longer than the local 10-second sleep bound, so a restart cannot turn it into an early POST.
  3. It deletes settled rows older than 7 days.
- **Without a readback token, rows stay `sent` and are never reported as delivered.**
- Span times are the send time. The event's own time is in the input. Diagnostics hold counts, trace IDs and status codes only.

## Historical TicketStub evidence qualification

The October 12 hand-off records below are preserved as historical, author-reported evidence from their recorded branch and app commits. The raw evidence files are not changed by this correction. Their exact pins in the reviewed base snapshot are:

| Historical record | Bytes | SHA-256 |
| --- | ---: | --- |
| [Delivery-queue and TicketStub hand-off summary](../../triage/agent-creative-v1/execution/neatlogs-outbox-continuous-delivery.md) | 2,926 | `028b560313a82237b093dc2973b174ae43e87c3c8f412d54a447d4b3365141fb` |
| [TicketStub hand-off raw JSON](../../triage/agent-creative-v1/execution/neatlogs-outbox-2026-10-12-ticketstub-handoff-evidence.json) | 2,692 | `aa0b2683601cf4e89e0b2c5fef60365177783beb86e94728785fe1e2658d8bbb` |
| [TicketStub app-run raw JSON](../../triage/agent-creative-v1/execution/neatlogs-outbox-2026-10-12-ticketstub-app-run-evidence.json) | 1,189 | `cb192ff9e324adcd1c6449905e3487ab857e2564ac84a4be9822df880c40be61` |

The summary attributes four synthetic events as accepted and later verified through the Public API, and describes a separate localhost TicketStub sandbox run. This correction does not independently reproduce those historical builds, requests, readbacks, secret scans, or custody; it does not establish a deployed GoDaddy run. The current source and test changes are not runtime evidence. In particular, no fresh application build, live POST/readback, raw request/response capture, independent secret scan, or observation-window proof is claimed here.

The independent source check for this correction is limited to hashing the local summary and raw JSON files at the reviewed base snapshot. It did not compare the recorded historical harness/app commits or builds with that snapshot, so no historical source equivalence is independently established. The JSON counters and caller-supplied source strings do not include raw request/response transcripts or a per-call observation window; the producer's no-AI/procedural description is not a measured cost or access ledger.

## TicketStub hand-off

`@jevelopers/agent-harness-runtime/ticketstub` (`src/integrations/ticketstub/index.js`) is the intake contract for getticketstub.com product events (`ticketstub.event/1`). The app calls it in-process from `exportToHarness()`.

- **Validation.** Every event is checked against the harness's copy of the contract (`TICKETSTUB_EVENT_SPEC`: types, field kinds, enums, 16-hex refs, request ID shape, and an email/URL/long-token screen on codes). Anything outside it is refused and counted as `invalid`, not repaired. Keep the copy in step with `src/server/events.ts` there.
- **Tokens.** Request, actor, project, event, fact, version, share and order values use separate HMAC-SHA256 domains (`ticketstub.request`, `ticketstub.actor`, `ticketstub.project`, `ticketstub.event`, `ticketstub.fact`, `ticketstub.version`, `ticketstub.share`, and `ticketstub.order`) under `AGENT_HARNESS_TELEMETRY_KEY`. Product references are scoped to the project token or, without a project, the request token; this permits scoped joins for the same reference without exposing its raw value. The session is the project token, or the request token for events without a project. These tokens do not establish producer ownership or external consent.
- **Export.** One trace per event, workflow `agent-harness.ticketstub-events`, tags `ticketstub` plus the host's (for example `ticketstub@<commit>`). The input is `agent-harness.ticketstub-intake.v2` JSON: type, source event time, mode, actor kind, fields and tokens. OTLP span time is the send time; the source time remains in the input. Attributes: `agent_harness.source`, `ticketstub.event_type`, `ticketstub.mode`, `ticketstub.actor`.
- **Host API.** `createTicketstubHarnessExporter({ env, databasePath, tags })` reads `AGENT_HARNESS_TELEMETRY_KEY` and the `NEATLOGS_*` names from the explicit `env` object. It does not use the SDK capture, so the host keeps its `NEATLOGS_*` settings and nothing is scrubbed. `accept(events)` is synchronous and local, and schedules a drain; `drain()` does the network work; `status()` returns counts and trace IDs; `close()` stops scheduling and waits for owned running/scheduled work before closing the queue.
- **Deployment settings (server secret storage).** `NEATLOGS_INGEST_KEY` (required), `AGENT_HARNESS_TELEMETRY_KEY` (required), and `NEATLOGS_READ_TOKEN` with `NEATLOGS_PROJECT_ID` (optional, enables server-side readback and recovery). The ingest key is the same project key the app's own operational exporter uses.

## Commands

All commands use Node 22.23.3. Run them from the repository root with dependencies installed (`npm ci --ignore-scripts`).

```bash
# Offline: build a synthetic workflow, capture it, run the redaction gate. No network.
node tools/neatlogs-live-verify.mjs --mode offline \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-offline.json --plan /tmp/neatlogs-plan.json

# Live send of one synthetic workflow (needs NEATLOGS_INGEST_KEY).
node tools/neatlogs-live-verify.mjs --mode send --env-file .env \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-send.json --plan /tmp/neatlogs-plan.json

# Readback of a saved plan (needs NEATLOGS_READ_TOKEN + NEATLOGS_PROJECT_ID).
node tools/neatlogs-live-verify.mjs --mode readback --env-file .env \
  --plan /tmp/neatlogs-plan.json --evidence /tmp/neatlogs-readback.json

# Readback of a saved plan that re-sends `missing` traces once under the next generation
# (needs the API key, token and project ID). The plan file is updated with the new IDs.
node tools/neatlogs-live-verify.mjs --mode readback --recover --env-file .env \
  --plan /tmp/neatlogs-plan.json --evidence /tmp/neatlogs-recovery.json

# Both in one run; --recover re-sends bounded-window `missing` traces once under the next generation and records the duplicate risk.
node tools/neatlogs-live-verify.mjs --mode send-and-readback --recover --env-file .env \
  --component-revision "$(git rev-parse HEAD)" \
  --evidence /tmp/neatlogs-live.json --plan /tmp/neatlogs-plan.json

# Offline tests (fake transport, no network).
npm run test:neatlogs-live
```

The tool seeds synthetic canaries (fake private URL, email, token, customer and error text) into the durable workflow's raw fields. It refuses to send if any canary appears in the encoded export body, and it refuses to write evidence that contains a canary or a configured credential value. Evidence is labeled `offline-fixture` or `live-synthetic`. Never point this tool at customer workflows.

### Runtime application trace

```bash
# Offline: run one genuine worker job (mock dependency mode, local-pure operations only) and fill the outbox. No network.
node tools/neatlogs-runtime-trace.mjs --mode run --outbox /tmp/neatlogs-outbox \
  --component-revision "$(git rev-parse HEAD)" --evidence /tmp/neatlogs-runtime-offline.json

# Live: the same run, then drain the outbox (send + Public API readback).
node tools/neatlogs-runtime-trace.mjs --mode send-and-readback --env-file .env --outbox /tmp/neatlogs-outbox \
  --component-revision "$(git rev-parse HEAD)" --evidence /tmp/neatlogs-runtime-live.json

# Resume: send pending batches and read back accepted ones in an existing outbox.
# Add --recover to re-send bounded-404 `missing` traces once under the next generation.
node tools/neatlogs-runtime-trace.mjs --mode drain --env-file .env --outbox /tmp/neatlogs-outbox \
  --component-revision "$(git rev-parse HEAD)" --evidence /tmp/neatlogs-runtime-drain.json
```

The tool runs the workflow through the normal in-process entry point: `createOperationsWorker` → `submitSyntheticWork` → owned runner child → `runBoundedLocalPlan`.
- `submitSyntheticWork` is the worker's only intake today. Its scope strings carry no authority.
- The plan uses only `number.add` and `text.concat`. The registry marks provider, network and shell operations unavailable, so no model or provider call is possible.
- Evidence is labeled `live-runtime-application` or `offline-runtime-application`, with `harnessMode: mock`.
- Evidence contains no credential, project UUID or raw run identifier. Every raw job, workflow, scope, owner and event ID of the run is scanned for before anything is written or sent.

For network modes, `drainPage` records only the at-most-32 batch visits from this invocation. `batches` is a read-only inspection of every retained batch after that page, labeled `batchEvidenceSource: persisted_outbox_snapshot`. It includes previously stored results and does not claim a fresh provider observation for them. `deliveryConfirmed` keeps the complete-count rule: there must be at least one retained batch, the summary count must match the current file count, and every retained readback result must be `verified`. An incomplete page, an unresolved row, or a cursor by itself cannot establish complete delivery. The inspection is not an atomic snapshot during concurrent writes; use the same external serialization required for draining.

## Dashboard check

Open `https://app.neatlogs.com` (or the EU origin) and select the project. Under **traces**, filter by workflow `agent-harness.workflow-events`, then find the trace IDs listed in the evidence plan. The session is the `tok1_…` workflow token. This is an independent visual check. It is not a substitute for the API readback evidence.
