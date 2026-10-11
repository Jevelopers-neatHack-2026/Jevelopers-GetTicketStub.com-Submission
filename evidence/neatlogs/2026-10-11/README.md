# Neatlogs traces from the live TicketStub app — 2026-10-11

**Result:** actual agent runs on production `getticketstub.com` are recorded in Neatlogs as inspectable traces. Each trace has a workflow root, LLM spans with model and tokens, and tool spans for page fetch and parse. One trace shows a failure, one shows an image generation, and one shows the app recovering from a malformed request. This is evidence for SPN-01; it is **not** owner acceptance. Only synthetic or public inputs were used, with no customer data.

| Trace | Workflow | Outcome | What it shows | Screenshot |
| --- | --- | --- | --- | --- |
| `601d02d5d5658f22286286e53cdbe450` (session `op_jiBiNquOKpgM_fxn`) | `ticketstub.research` | OK, 6.9 s | `source.event_page` tool (379 ms), then `parse.title`, then `anthropic/claude-sonnet-5.5` LLM (3,340 tokens, about $0.01) | [trace-research-success.jpg](trace-research-success.jpg) |
| `d3d7bccece4e343b863db06eec4ad578` (session `op_Ba1UqOiaCYptAdmD`) | `ticketstub.research` | **ERROR** | The event-page fetch **timed out** after 8.0 s. The app returned `unreadable_link` (422) with no further AI spend | [trace-research-failure.jpg](trace-research-failure.jpg) |
| `63b4db3d65091615052591841c961ed1` (session `op_bKlgNUuxjOhpVUkv`) | `ticketstub.agent` | OK, 3.2 s | `openai/gpt-6.1-sol` LLM reply, 158 tokens | [trace-agent-reply.jpg](trace-agent-reply.jpg) |
| `4dbdf9e9caf3953a881ad2c8815a91ee` (session `op_qLtplHiDth0xanZo`) | `ticketstub.art` | OK, 21.8 s | Image generation: `openai/gpt-image-2` model check (882 ms), then generation (752 tokens, 20.9 s, provider-reported $0.018785) | [trace-art-image.jpg](trace-art-image.jpg) |
| `8fc27f1ac8ceee3ef891900a9147a350` (session `op_T-joQyeRzoJG175A`) | `ticketstub.art` | OK | **Recovery from a malformed request:** the test event had no `facts` array, so the prompt builder threw before any image call (host log `code=internal`, `attempts=0`). The route still answered with procedural art (`fallback=procedural`) | — |

Machine-readable details, including inputs, producer revision and runtime settings, are in [traces.json](traces.json). The dashboard links work for members of the Neatlogs workspace, for example `https://app.neatlogs.com/traces/<trace-id>`. Public reviewers should use the screenshots and this record.

## How it was produced

- **Producer:** `Jevelopers-neatHack-2026/getticketstub.com`, published commit `e4a19931b5febbf6efdb85e11d1d3da1b88106fe`, on GoDaddy app `gvk66o79l1`.
  - [#46](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/46) added the exporter: content-free spans built from the allow-listed `ticketstub.ops/1` events, sent by OTLP/HTTP to `ingest.neatlogs.com` with no new dependencies.
  - [#51](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/51) and [#53](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/53) added once-only diagnostics.
- **Runtime:** `TICKETSTUB_RUNTIME_MODE=live`, `TICKETSTUB_OPS_ENVIRONMENT=production`, `TICKETSTUB_OPS_TELEMETRY=log,neatlogs`.
  - The host log confirmed `[ops] telemetry sinks: log,neatlogs` and `[ops] neatlogs: export accepted (HTTP 200)`, with no failure lines.
- **Data handling:** exported spans carry only model, provider, tokens, provider-reported cost, durations, status codes and fixed outcome codes. They never carry prompts, page text, event titles, URLs or identity, and tests assert that a seeded canary never reaches the wire.
- **Readback:** the owner's signed-in Neatlogs dashboard and its read-only backend, queried between 21:57 and 22:05 UTC.

## Limitations, recorded rather than hidden

- **Accepted is not stored.** Neatlogs returned HTTP 200 with no rejected spans for every export, but 3 of 7 production sessions were not found 30 seconds or more later (`op_91uV_p0TBBEX8JfW`, `op_LNoK2VHvk6U5V_cr`, `op_j0o1z48tG3dNjntU`). agent-harness#38 documented the same behaviour: a silent receiver-side loss with no client-side error. Confirming storage needs the Public API with a service-account token, which is not yet configured locally.
- **Correction, 2026-10-11 22:45 UTC.** An earlier version of this record said production AI art "fails internally". That was wrong. The failing art requests were agent test payloads without the `facts` array that the studio always sends, so `buildArtPrompt` threw (`event.facts.find`). A well-formed request generated a live image (`op_qLtplHiDth0xanZo` above). A small robustness gap remains: a request missing `facts` gets procedural art and logs `internal` instead of a 400.
- **Cost column.** Neatlogs' own cost column prices some models (research shows $0.01) but not others (the agent shows none). The provider-reported cost is kept on each LLM span.
- **Not covered.** No before/after comparable-improvement claim is made (EVAL-02), and there is no durable harness workflow trace. agent-harness#38 holds the synthetic harness path, which is pending readback.
