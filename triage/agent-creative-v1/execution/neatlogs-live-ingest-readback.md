# Neatlogs live ingestion and readback: 2026-10-11 evidence

Scope: ACV1-AH10 prerequisite and getticketstub.com#27, Neatlogs setup items. All data is synthetic. No customer activity was exported.

## Component revisions

- agent-harness `52db7edcc2fb7a69c24b56c5362eb2fec5b28778`. This is the code that sent the traces. The tag `agent-harness@52db7ed…` was attached to every trace.
- `neatlogs` SDK `1.1.28` (pinned; capture path unchanged).
- Node `22.23.3`.

## Target

- Neatlogs US (`https://ingest.neatlogs.com`, `https://app.neatlogs.com`). The project is the existing single project "Complete's project", confirmed in the signed-in dashboard.
- No workspace, project, key or service account was created. No settings were changed.
- Ingest used the existing project API key from the git-ignored `agent-harness/.env`, through `--env-file`.
- There is no service account, so no Public API readback token exists.

## Commands

```bash
npm ci --ignore-scripts
npm run build
npm run test:neatlogs-live   # 20/20 pass, fake transport, no network
node tools/neatlogs-live-verify.mjs --mode offline --component-revision <sha> \
  --evidence <scratch>/offline-evidence.json --plan <scratch>/offline-plan.json
node tools/neatlogs-live-verify.mjs --mode send --env-file ../agent-harness/.env \
  --component-revision 52db7edcc2fb7a69c24b56c5362eb2fec5b28778 \
  --evidence <scratch>/send-evidence.json --plan <scratch>/plan.json
```

## Results

Evidence files: [send evidence](neatlogs-live-2026-10-11-send-evidence.json) (`live-synthetic`) and [export plan](neatlogs-live-2026-10-11-plan.json). Both passed the tool's leak scan for canaries and credential values, and were rescanned before commit.

- **Redaction gate:** 6 synthetic canaries were seeded into the durable workflow's raw fields: private URL, email, token-like string, customer text, raw ID and error text. None appeared in the encoded export body (`exportBodyFindings: []`). The dashboard shows only `tok1_` HMAC tokens and enums.
- **Send:** one request, `receiver_accepted`, HTTP 200, `rejectedSpans: 0` of 6 expected spans (3 roots plus 3 completion markers). `deliveryConfirmed: false` by design.
- **Dashboard readback** (signed-in browser session, independent of the ingest key, at 2026-10-11 ~18:00Z):

| Seq | Event | Trace ID | Dashboard |
| --- | --- | --- | --- |
| 1 | `workflow_created` | `42d52c183ddf75c568a56010c884b82f` | Present. URL trace ID matches; input event token and workflow token match the plan; span `agent_harness.workflow_event` (WORKFLOW); 1 span; 2 tags; session turn 1/2 |
| 2 | `lease_acquired` | `8b5edad544e2d08b14a20aa478ee3d09` | Present. Input event token and workflow token match the plan |
| 3 | `state_transition` | `31fedb2dafb257d9f1c965d8973db03d` | **Not found** at `/traces/<id>` after more than 2 minutes, despite HTTP 200 with 0 rejected spans |

  - Session `tok1_52648f98…3b60` (workflow token) groups traces 1 and 2.
  - The completion marker is not stored as a span. The readback verifier already accepts this case and records `markerStored: false`.
  - Trace reference: `https://app.neatlogs.com/traces/42d52c183ddf75c568a56010c884b82f`. Project access is required.

## Trace 3 root-cause investigation (2026-10-11 ~18:20Z)

Checked through the dashboard's own backend: the signed-in session, read-only `/api/traces/v3/<id>/view` and `/api/sessions/<session>`.

| Test | Sent | Result |
| --- | --- | --- |
| Original | `31fedb2d…`, with its root start in the same millisecond as trace 2 | 404. The session lists 2 traces, and the session `lastActivityAt` equals trace 1 `updatedAt`, so there is no sign trace 3 was ever cataloged |
| Re-send of trace 3 alone | Same IDs and input, fresh timestamps | HTTP 200, 0 rejected; still 404 |
| Trace 3 content under new IDs (`46d6764e…`), plus a trace 2 control (`823c3df3…`) | New IDs, starts 5 ms apart | Both finalized |
| Two new-ID traces with identical start times (`18279145…`, `990448b3…`) | Same session, same start nanosecond | Both finalized |

Conclusions:

- **Root cause (proven):** the receiver lost the first delivery of trace ID `31fedb2d…` and silently discards later deliveries of that ID while still answering HTTP 200 with 0 rejected spans. Content and start-time collision are ruled out.
- **First-loss trigger:** unknown. It is server-side, and only the Public API `finalizationStatus` (for example `dlq`) can show it. A dashboard session gets 401 on `/api/v1/public`.
- **Harness defect:** purely deterministic IDs made the loss unrecoverable. Fixed by delivery generations: readback reports `missing` and `--recover` re-sends under the next generation.
- **Extra data:** the tests added 4 synthetic traces and 1 dropped re-send to the same session, all tagged `evidence:synthetic`.

## Limitations and open items

- **Public API readback not run.** It needs a service-account token (`NEATLOGS_TOKEN`) with `context:read` and `observability:read`, bound to the project UUID (`NEATLOGS_PROJECT_ID`). Creating that identity needs owner approval. With it: `node tools/neatlogs-live-verify.mjs --mode readback --env-file .env --plan triage/agent-creative-v1/execution/neatlogs-live-2026-10-11-plan.json --evidence <path>`. This reports `finalizationStatus` (`pending`/`dlq`) for trace 3.
- **Trace 3 is unexplained.** Receiver acceptance did not mean storage. The 2026-10-11 run therefore counts as 2 of 3 traces confirmed, by dashboard only. It is not a fully verified delivery.
- **Durable cursor not wired.** `TelemetryExporter` (500 ms sink cap, retry on timeout) is not wired to this network path. Follow-up: a durable "sent, awaiting readback" state.
- **Correlation limited by the projection.** It contains job (workflow), event, sequence, revision and fence. Operation, billable-attempt, provider and artifact references are absent upstream and are not invented.
- **Customer app integration pending.** getticketstub.com `exportToHarness()` is still a no-op stub. Customer-app integration through a harness intake contract remains downstream.
- **Pre-existing test failure.** `OPS04_REAL_SIGTERM_JEV_TELEMETRY` (tests/operations) fails identically on unmodified `origin/main` `cdd52b1` in this environment, so it is unrelated to this change. Full suite result: 261/262.
