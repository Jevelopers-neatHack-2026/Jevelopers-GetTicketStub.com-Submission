# Neatlogs SDK local-capture full handoff

**Status:** local SDK mapping prerequisite implemented and locally verified. The full ACV1-AH10 outcome and its live/global acceptance criteria remain open.

**Repository:** agent-harness
**Branch:** launch/acv1-neatlogs-sdk-local
**Worktree:** /Users/completetech/agent-harness-worktrees/acv1-neatlogs-sdk-local
**Inspected base:** bb280f2bfcf390b5d228148fb961ed0b2af326c9
**Base tree:** 50d9c05c0311f443961f40a0e39d9a56c6b0e52e
**Implementation/evidence commit:** 3a4372b0efaa716efade02b6d586140fb072fee5 (parent: the inspected base)
**Implementation tree:** 97520c70ddbf75fd01ed10dc2643b1526899a24e
**Advisory:** triage/agent-creative-v1/execution/neatlogs-sdk-next-wave-advisory.json, SHA-256 3b984b57ed6cca9aaf8e4763cc4ec949b09554bf82222248faaf05effe8724f3 (read in full from the source repository).
**Issue:** [ACV1-AH10 / issue #10](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/10), P0, owner role Agent and research, no named assignee/reviewer, still open in the local full snapshot. No issue or external application was changed.

The requested execution profile was a fresh gpt-6-luna/max, strict, Fast, non-UI author run. This interface did not expose a control to verify the active model/effort/Fast setting, so this handoff does not attest those settings. Work was non-UI; no nested author or subagent was used.

## Scope and ownership

This change implements only real Neatlogs 1.1.28 local mapping of already projected telemetry records. It does not create an exporter-to-service bridge, claim ingestion, or satisfy sponsor acceptance. No provider, finance, Neatlogs service, Entire service, live API, or external account was called. No global OTel provider, signal hook, monkeypatch, prompt API, log capture, init(), or flushAll() was added.

The shared writer transfer named by the user covered only package.json, package-lock.json, Makefile, and .github/workflows/runtime-foundation.yml; that transfer is now exercised by the exact package and CI wiring below. The bounded worker's source ownership for src/store/errors/types was not transferred and those files were not edited. No bounded branch source or package/Makefile changes were copied. The readiness-contract reviewer and contract author continue to own their separate 13 readiness paths. After the bounded merge, root integration may need to reconcile shared package/Makefile/CI changes. This worker did not merge, push, close an issue, or start that integration.

### Changed paths

Shared paths authorized by the transfer:

- package.json
- package-lock.json
- Makefile
- .github/workflows/runtime-foundation.yml

New implementation and evidence paths:

- src/observability/private/neatlogs-sdk-mapper.js
- src/observability/private/neatlogs-sdk-mask.js
- src/observability/private/neatlogs-sdk-capture.js
- tests/observability/neatlogs-sdk/ (six test suites plus controlled subprocess fixtures, helpers, and strict public API typecheck)
- docs/decisions/neatlogs-sdk-conformance.md
- triage/agent-creative-v1/execution/neatlogs-sdk-local-full-handoff.md

Protected runtime, store, telemetry cursor, entrypoint declarations, and JEV source files were not changed. The local runtime test confirms the workflow event page, cursor, and financial outbox are unchanged.

## Dependency and source record

Node v22.23.3 and npm 10.9.9 were used. Direct runtime dependency is exactly neatlogs@1.1.28; no OpenTelemetry package is directly imported by the harness. The strict TypeScript check compiles against the public Client, trace, ClientOptions, and ClientOptions['spanExporter'] APIs from neatlogs.

The complete lock graph has 57 package records. package-lock.json stores resolved package URLs, versions, SHA-512 integrity, and license metadata. The actual capture artifact carries the same 57-record normalized graph with path, name, version, integrity, license, optional/development flags, and installed-state fields. The lockfile SHA-256 is 9c136cb70e980c19daf05978ce98a372cf2825fcbbd37f098d583aa7083fff7d.

Key pinned records:

| Package path | Version | Integrity | License |
| --- | --- | --- | --- |
| node_modules/neatlogs | 1.1.28 | sha512-KeOEzjufhhTaxF7pckw08JOaILQvjj8HpS+Xb+3owMzQfjEtjYG01Oo2WtOGurifuTNMMabjw3WSRDi8a0thmg== | MIT |
| node_modules/@opentelemetry/api | 1.9.1 | sha512-gLyJlPHPZYdAk1JENA9LeHejZe1Ti77/pTeFm/nMXmQH/HFZlcS/O2XJB+L8fkbrNSqhdtlvjBVjxwUYanNH5Q== | Apache-2.0 |
| node_modules/@opentelemetry/core | 1.30.1 | sha512-OOCM2C/QIURhJMuKaekP3TRBxBKxG/TWWA0TL2J6nXUtDnuCtccy49LUJF8xPFXMX+0LMcxFpCo8M9cGY1W6rQ== | Apache-2.0 |
| node_modules/@opentelemetry/exporter-trace-otlp-proto | 0.57.2 | sha512-awDdNRMIwDvUtoRYxRhja5QYH6+McBLtoz1q9BeEsskhZcrGmH/V1fWpGx8n+Rc+542e8pJA6y+aullbIzQmlw== | Apache-2.0 |
| node_modules/@opentelemetry/otlp-exporter-base | 0.57.2 | sha512-XdxEzL23Urhidyebg5E6jZoaiW5ygP/mRjxLHixogbqwDy2Faduzb5N0o/Oi+XTIJu+iyxXdVORjXax+Qgfxag== | Apache-2.0 |
| node_modules/@opentelemetry/resources | 1.30.1 | sha512-5UxZqiAgLYGFjS4s9qm5mBVo433u+dSPUFWVWXmLAD4wB65oMCoXaJP1KJa9DIYYMeHu3z4BZcStG3LC593cWA== | Apache-2.0 |
| node_modules/@opentelemetry/sdk-trace-base | 1.30.1 | sha512-jVPgBbH1gCy2Lb7X0AVQ8XAfgg0pJ4nvl8/IiQA6nxOsPvS+0zMJaFSs2ltXe0J6C8dqjcnpyqINDJmU30+uOg== | Apache-2.0 |
| node_modules/@opentelemetry/sdk-trace-node | 1.30.1 | sha512-cBjYOINt1JxXdpw1e5MlHmFRc5fgj4GW/86vsKFxJCJ8AL4PdVtYH41gWwl4qd4uQjqEL1oJVrXkSy5cnduAnQ== | Apache-2.0 |

The remaining transitive records, including nested OpenTelemetry versions, protobuf packages, and optional dependency branches, are in the lockfile and capture artifact. Neatlogs declares an optional @ai-sdk/otel branch; npm's default install includes it and its optional packages in the lock graph. No LLM framework integration was configured or called. No examples, Doctor, prepack, pretest, global SDK initialization, or optional framework integration were run.

All 24 pinned SDK/dependency source hashes were verified by the real-capture fixture: Neatlogs package metadata, ESM entrypoint, declarations and source map; 15 mapped Neatlogs TypeScript sources; four relevant OpenTelemetry sources; and the partial-success response handler. The artifact contains the complete names and SHA-256 values.

## Runtime behavior implemented

The private boundary accepts only ordered agent-harness.telemetry.v1 HMAC-projected records with the exact ten own-data fields. It rejects accessors, proxies, cyclic/extra/malformed records, invalid enum values, over-limit fields/batches, and out-of-order sequences before SDK import. The bound is 32 records, 1 KiB per record, 64 KiB per batch, 32 root spans plus 32 completion markers, 64 total spans, and 128 KiB serialized capture output.

For each record, actual SDK Client.activate() and trace() create a static WORKFLOW root with an allowlisted source token, workflow token, sequence, revision, event/state/fence data, and original source time. The static SDK completion marker is explicitly retained and counted. SDK generated IDs may change on replay; no stable-ID or remote-deduplication claim is made.

The owned synchronous mask reconstructs a narrow safe envelope and resource set. It catches errors and returns null on invalid data. It rejects undefined results from its own path, does not expose per-span mask injection, and removes input/output/error content, ambient verification markers, user/session data, unknown attributes, and unapproved resource fields. The offline API key is a synthetic placeholder only. Runtime options are fixed; the caller can select only the bounded test controls timeoutMs, exporter delay, and local exporter success/failure mode.

One preparation at a time is enforced through one active-request latch plus a generation counter. Tests cover abort before and during a controlled exporter barrier, timeout, delayed callback, exporter failure, a concurrent CAPTURE_BUSY request, replay in the next generation, concurrent isolated clients, idempotent close, and late callback handling. Outcomes are a local sanitized artifact or bounded failure; there is no accepted, acceptedCount, service receipt, cursor advancement, or Finance acknowledgement.

The test subprocess is launched with a minimal environment. On this Darwin host it runs under sandbox-exec with network denied and a fixed local exporter; the endpoint option is the static .invalid URL and cannot be selected from source data. Production capture checks only the names of ambient NEATLOGS_*, OTEL_*, and NODE_OPTIONS variables and refuses unsafe settings before importing the SDK; it does not read or copy values.

## Required ten-group acceptance matrix

| Group | Result | Evidence and boundary |
| --- | --- | --- |
| REAL_PACKAGE | Pass locally | Node 22.23.3 imports the real pinned SDK; public Client/trace/exporter APIs typecheck; 57 locked package records and 24 source hashes are captured. |
| EVENT_MAPPING | Pass locally | Three synthetic durable workflow events pass through the unchanged HMAC projector, real SDK and local exporter; three roots and three completion markers reconstruct the exact source records. Replays do not claim stable generated IDs. |
| PRIVACY_CANARIES | Pass for synthetic local artifacts | Raw-ID, URL, secret-suffix, customer, error, and session marker canaries are absent from sanitized capture, fixture stdout/stderr, and artifact. Live account/customer evidence review is still open. |
| MASK_DROPS_ARE_FAILURE | Pass locally | Actual SDK subprocess covers null, undefined, invalid object, throw, reject, and timeout results. Empty flush/mask loss does not become source acceptance. Undefined pass-through is observed only with synthetic canaries. |
| ENQUEUE_FLUSH_NOT_ACK | Pass locally | Local exporter delay/failure, zero captured spans after null-mask filtering, and successful SDK flush are checked; no outcome is labeled accepted. |
| BOUNDS_AND_CANCEL | Pass locally | Limits include roots plus completion markers; malformed, oversized, accessor, proxy, cyclic, and extra-field records fail before SDK import. Timeout, abort, busy latch, generation replay, bounded output and close paths are exercised. |
| CONTEXT_LIFECYCLE | Pass locally | Two real Client instances and concurrent workflows are isolated; listener/global OTel provider snapshots are unchanged. Namespaced Neatlogs global symbols are observed and documented. |
| NO_SECONDARY_EGRESS | Pass in this Darwin subprocess run | OS network deny, minimal environment, explicit custom local exporter, fixed workflow/options/endpoint, and no default OTLP path. No actual service or provider was called. |
| STOCK_ACK_REGRESSION | Source-pinned pass; exporter runtime variant pending | Exact pinned sources show Neatlogs undefined-mask pass-through, null filtering, empty-export SUCCESS, and OTLP partialSuccess/malformed-response information loss. The advisory allows this runtime variant to remain pending when it would require forbidden transport monkeypatching or network. |
| RESTART_AND_EVIDENCE | Pass locally | Child process is killed before SDK import and after actual SDK capture. Durable events, telemetry cursor, and outbox remain available/unchanged; artifact flags remote ingestion, sponsor acceptance, Entire, cursor advance, Finance ack, and live service access false. |

The current saved full issue snapshot was updated at 2026-10-10T13:47:26Z; it preserves the full AH-10, SPN-01, SPN-02, EVAL-03, and EVAL-04 acceptance wording. GitHub live retrieval could not be refreshed because the local gh token was invalid; this handoff does not claim a successful live issue read. The issue was not modified.

## Original AH-10 and global acceptance still required

The issue's three original testable acceptance cases are retained without rewriting their meaning:

1. **Correlated workflow with JEV fallback, provider retry, and final verification.** The required artifact must link all steps and artifact/usage references without raw content and must not invent sponsor evidence. **Pending:** the frozen source projection contains only event/workflow tokens, revision/state/fence, event type, and source time. Operation, billable attempt, provider, decision, artifact, usage, fallback topology, and evaluated-run references are absent. This increment does not invent or backfill them.
2. **Secrets, credential suffixes, and customer content in an error/request fixture.** Sanitized logs/exports must survive scanning and manual review with no seeded values. **Synthetic local canary test passed.** Published evidence, repository history, live SDK debug, account data, and the issue's manual sanitization review remain pending.
3. **Telemetry outage, volume spike, and SIGTERM during flush.** Memory/disk/flush must be bounded, telemetry loss/pending status explicit, and financial outbox preserved. **Local limits, controlled callback delay/failure, process kill, source page, cursor, and outbox invariants passed.** No strict service bridge exists, so real collector outage, service retry behavior, volume delivery, and SIGTERM during a remote flush remain pending.

Global checklist dependencies remain with their original owners and meanings:

- **SPN-01 — Neatlogs use (P0; Finance and reliability):** requires an actual agent run and inspectable Neatlogs traces tied to an evaluated application run. **Pending:** no account, approved host/region, retention contract, ingestion, or evaluated service artifact was used.
- **SPN-02 — Entire use (P0; Agent and research):** requires actual Entire development provenance/checkpoints or repository graph tied to relevant revisions. **Pending:** Entire remains disabled and no Entire artifact was captured.
- **EVAL-03 — Evidence classification (P0; Product and frontend):** requires labels for simulated, sandbox, live, estimated, and pending claims plus a reviewed evidence index/narrative. **Local classifications are explicit; global index and review remain pending.**
- **EVAL-04 — Secrets and customer data (P0; Finance and reliability):** requires a review of published evidence and repository history, sanitization review, and applicable scanning. **Synthetic fixture checks passed; global review/scanning remains pending.**
- Sponsor acceptance, region selection, retention, live access, owner-approved model/provider budget, and AH-10 release evidence remain required and unavailable here.

AH-10 remains blocked by its recorded ACV1-AH01 and ACV1-ACCESS prerequisites (#7 and #4). Its existing relationship to AH11-OPS (#20) and AH12 (#23) is unchanged. Local package mapping is only a prerequisite contribution. The issue, owner roles, acceptance checklist, contract catalog, and external handoffs were not changed.

The issue's narrow external producer handoffs remain pending: EI-12R (#22) and CE-12 (#12) each require actual correlated Neatlogs and applicable Entire provenance plus owner acceptance. No producer schema was copied and no external repository was edited. The issue's proposed live AH-10 route (make verify CASE=AH-10 MODE=live FIXTURE=neatlogs-correlated-run) and recorded SPN-02 route (make verify CASE=SPN-02 MODE=recorded FIXTURE=entire-development-provenance) remain unavailable. Its closure gate still requires merged implementation/tests, successful checks on pinned release revisions, satisfied dependencies, accessible sanitized evidence, and no required behavior hidden behind stubs. This branch has not merged and does not meet that gate.

## Full sink gate still disconnected

Do not connect the local collector to the telemetry cursor or financial outbox. A future approved sink still needs all of the following before service delivery can be considered:

1. Owner-selected approved regional HTTPS host and fixed /v1/traces path, vetted DNS/socket behavior, and no user-selected endpoint, proxy, headers, TLS override, or redirects.
2. Strict bounded request and response parsing that reports actual full versus partial service acceptance and source-span/marker coverage; retries and sampling/loss must not hide missing records.
3. Transport that honors the sink AbortSignal, retains in-flight identity until actual completion/cancellation, rejects stale callbacks, and fits the existing 500 ms wait or obtains a separately reviewed limit change.
4. Durable nonretryable partial rejection/quarantine/drop and recovery semantics compatible with the existing telemetry retry loop. The existing exporter retries rejected results and has no persistent partial/nonretryable outcome; returning false can replay rejected data, and returning true loses rejected spans.
5. Correlation fields from separately reviewed producers, then actual acceptance, retention, dashboard visibility, and sponsor evidence. A successful receiver response alone cannot prove these.

Do not claim acceptance after trace(), span.end(), enqueue, local callback, flush(), or stock OTLP SUCCESS. Do not patch unexported SDK internals or fabricate a sink receipt.

## Commands and outcomes

All commands use /Users/completetech/.cache/acv1-toolchains/node-v22.23.3-darwin-arm64/bin first in PATH unless otherwise noted. Exit codes below refer to the final successful run of each command.

| Command | Exit | Result |
| --- | ---: | --- |
| npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org | 0 | Populated the default npm cache from the real locked graph; scripts remained disabled; 57 packages added. |
| make bootstrap | 0 | Repeated npm ci --ignore-scripts --offline --no-audit --no-fund; 57 packages installed from cache; build, ESM imports, and strict TypeScript passed. |
| make check | 0 | Syntax checks, internal package import, sanitized-environment real neatlogs ESM import, strict TypeScript API checks. |
| make test | 0 | 105 passed, 0 failed, 0 skipped; TAP at .runtime-artifacts/runtime-full.tap. |
| make verify CASE=AH-10 MODE=mock FIXTURE=neatlogs-sdk-local | 0 | 9 passed, 0 failed, 0 skipped; actual Neatlogs subprocess and source-pin regression included. |
| python3 -m unittest discover -s tests/config/provider-profile -p 'test*.py' | 0 | 48 provider-readiness tests passed; no live provider calls. |
| make verify CASE=ACV1-AH05 MODE=mock FIXTURE=jev-phase-b-offline | 0 | 59 passed, 0 failed, 0 skipped; 520 static assertion call sites (not an executed assertion count); all nine named JEV acceptance groups covered. Controlled fixtures recorded 52 DNS resolutions, 19 HTTPS requests, 18 writes, 0 blocked external attempts, 0 provider API calls, and 0 live network calls. Evidence binds implementation commit 3a4372b0efaa716efade02b6d586140fb072fee5 to the inspected base with a clean worktree. |
| git diff --check | 0 | No whitespace errors. |

The first offline bootstrap attempt occurred before the default npm cache contained undici-types@8.9.0 and returned ENOTCACHED. The registry fetch above was authorized, scripts were disabled, and the subsequent offline bootstrap succeeded. This initial cache miss did not alter source files or the lockfile.

The named ACV1-AH05/JEV offline target is an existing synthetic fixture. Its controlled DNS and HTTPS calls are in-process test fixtures, not calls to an external provider or service. No JEV source ownership was assumed by this change.

## Local artifact hashes

| Artifact | SHA-256 | Contents |
| --- | --- | --- |
| .runtime-artifacts/neatlogs-sdk-local-capture.json | 980805d708f57aa9d866f9c4983db653719f02890857ffa9793ffdfcf3e7ab85 | Sanitized real SDK capture; 3 source records, 3 root spans, 3 completion markers; all 24 source hashes; full 57-package version/integrity/license graph; darwin-sandbox-exec-deny-network; no remote ingestion, sponsor acceptance, Entire, cursor advance, Finance acknowledgement, or live service access. |
| .runtime-artifacts/neatlogs-sdk-local.tap | 6ee013f363df49157ac7efb529113d675292e860fd7657dc8afbe38729c185d4 | Named AH-10 route TAP; 9 passed, 0 failed, 0 skipped. |
| .runtime-artifacts/runtime-full.tap | c88b94b534f020ea8781aa72801917f8c77f83ef95d53e7e420c21d33af98106 | Full repository TAP; 105 passed, 0 failed, 0 skipped. |
| .runtime-artifacts/ACV1-AH05-jev-phase-b-offline.tap | aff1ec1f898f2b59b8ab28012ba7a8571bf72449e46d0900ccc2a24047e60716 | Sanitized JEV named-route TAP; 59 passed, 0 failed, 0 skipped. |
| .runtime-artifacts/ACV1-AH05-jev-phase-b-offline.json | 6bc4e381ea72ba06924005fed56c388e6f5a6c8ecdeaf432264d44bea582db52 | Revision-bound JEV manifest; base bb280f2bfcf390b5d228148fb961ed0b2af326c9, commit 3a4372b0efaa716efade02b6d586140fb072fee5, tree 97520c70ddbf75fd01ed10dc2643b1526899a24e. Manifest records all nine groups, no skips, controlled-network counters, and no provider/live calls. |

The JEV manifest's captured raw runner output SHA-256 is 0e467017a75d4b9527636d813feab6a58bb6a984ffc913a0a685be0167cd7699; its adjacent manifest checksum file records 6bc4e381ea72ba06924005fed56c388e6f5a6c8ecdeaf432264d44bea582db52. Generated .runtime-artifacts files are ignored by Git and remain local evidence. CI is configured to emit neatlogs-sdk-local.tap and upload the sanitized capture artifact. CI has not run on a published branch in this task.

## Review and handoff boundary

The branch must remain separate. No merge, push, or issue closure occurred. Independent Astra review of the exact commit pair, published/current CI, root integration after the bounded merge, actual issue/service acceptance, live Neatlogs/SPN-01, Entire/SPN-02, sponsor, regional retention, and approved model/provider budget are not satisfied by these local results. Do not report AH-10, SPN-01, SPN-02, EVAL-03, or EVAL-04 globally complete.
