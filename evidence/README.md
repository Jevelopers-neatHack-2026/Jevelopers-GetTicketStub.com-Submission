# Submission evidence index

This index distinguishes planned evidence from dated records of actually verified artifacts. Add sanitized, reviewer-accessible records for each tested release.

| Evidence | Required record | State |
| --- | --- | --- |
| Neatlogs | [Live TicketStub traces](neatlogs/2026-10-11/README.md): actual production agent runs (research, agent, art) with LLM/tool spans, a failure trace and an internal-error recovery; before/after comparable improvement not covered | traces recorded 2026-10-11; SPN-01 accepted by the Finance and reliability owner (CompleteDotTech) 2026-10-11, relayed from chat via PR #33 |
| Entire | [Checkpoint and graph record](entire/2026-10-11/README.md): checkpoint `01M4P1DT7TRNWJ5EA42T47R1P0` bound to commit `3358f0d` (private `entire-checkpoints` repo), plus entire-graph snapshots of all 10 component repos at exact `main` commits, generated without an agent by GitHub Actions | verified 2026-10-11; SPN-02 accepted by the owner (CompleteDotTech) 2026-10-11, relayed from chat; single Claude checkpoint, no entire.io mirror, graph plugin version unpinned |
| CFO.ai | [Current plan, revision 2](cfo-ai/2026-10-11-r2/README.md): actual saved plan, native exports, desktop-Excel recalculation and input-change verification, covering pricing, costs, revenue, runway and scenarios. [Original snapshot](cfo-ai/2026-10-11/README.md) retained. | revision 2 verified 2026-10-11; SPN-03 accepted by the Finance and reliability owner (CompleteDotTech) 2026-10-11, relayed from chat via PR #24; forecasts hypothetical, Finance summary export and submission open |
| Integrated journey | Research, edit, approval, printable artifacts, sandbox fulfillment, financial attribution | planned |
| Implementation history | Inspectable repository commits within permitted coding window | planned |

Maintain original cutoff and provenance. Never fabricate component pins or financial outcomes. See the [master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and [official rules](https://neatlogs.com/hackathon).
