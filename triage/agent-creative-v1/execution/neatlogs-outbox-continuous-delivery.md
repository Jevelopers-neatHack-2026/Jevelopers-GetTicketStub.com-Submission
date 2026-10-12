# Neatlogs outbox and TicketStub hand-off: live synthetic evidence (2026-10-12)

Code: agent-harness `ff642c0825c6d6dd2b6ca99d0ef357159ebaf8cb` (branch `launch/neatlogs-outbox-ticketstub-intake`). Node 22.23.3. Neatlogs US, the existing project, ingest key and read-only service-account token from the git-ignored local `.env`. All data is synthetic, and no customer activity was read or exported.

| Path | Evidence | Result |
| --- | --- | --- |
| TicketStub hand-off: 4 synthetic `ticketstub.event/1` events (`intake_submitted`, `research_started`, `art_requested`, `art_ready`) through `createTicketstubHarnessExporter` → outbox → drain | [evidence](neatlogs-outbox-2026-10-12-ticketstub-handoff-evidence.json) | 4 accepted, 0 invalid; 1 send request, `receiver_accepted`; readback through the Public API settled all 4 as `verified` (workflow `agent-harness.ticketstub-events`, one session for the synthetic project) |
| Durable telemetry cursor: a synthetic workflow (created, lease, running, succeeded) through `TelemetryExporter` + `createNeatlogsOutboxSink` → drain | [evidence](neatlogs-outbox-2026-10-12-cursor-evidence.json) | Cursor advanced to 4 on the local outbox commit; 4 sent; all 4 `verified` (workflow `agent-harness.workflow-events`) |

The scripts used scratch databases and a fresh random tokenization key for the cursor run. The hand-off run used the `AGENT_HARNESS_TELEMETRY_KEY` generated into the local `.env`. Both evidence files were scanned against every configured credential value before commit. Offline: 68/68 Neatlogs tests pass (47 existing, 13 outbox, 8 intake); the full suite fails only `OPS04_REAL_SIGTERM_JEV_TELEMETRY`, which fails identically on `origin/main`.

Not covered here: events from the deployed TicketStub app. That needs the getticketstub.com hand-off change, the host settings in GoDaddy secret storage, and a publish, which are owner steps.
