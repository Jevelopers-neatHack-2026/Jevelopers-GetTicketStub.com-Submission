# Inspection consumer preparation

This is a bounded UI preparation for CE-05 (issue 17), including its CE-JEV-03/04/05 contributions. It does not complete actual CE09/06/10 integration or transfer the frozen ccc source approval. All five original CE05 cases, required-for-v1 scope and global owners remain unchanged: CON-01/02/03 Agent and research; ART-01 Creative and fulfillment; ART-02/EVAL-03 Product and frontend; EVAL-04 Finance and reliability.

`src/controls/inspection-consumer.mjs` prepares a future public API operation fragment from a trusted current brief identity/hash, the actual current selection and the already published immutable DesignVersion. Controls `expected_versions.design` is a hashed selection token, **not** a DesignVersion ID. The helper checks the actual selection ID/hash, current brief hash/scope and separate stable edit/inspection action IDs. It creates no authority, database, budget controller or executor. The trusted future host must still supply the actual API envelope, permissions, same creative SQLite connection and qualified CE09 ports; this helper cannot enable a missing operation.

Keep the prepared inspection action ID for lookup/retry. An inspection failure must not retry the image edit. Request preparation and presentation have no callbacks or provider dispatch. A local test uses an actual published native edit to prove these helpers leave its selection, history and image/reservation counters unchanged; no inspection is executed in that test.

## Explicit evidence boundaries

`fixtures/controls/inspection-presentation-inputs.json` is a versioned **local input fixture**. Its small report subset follows the outcome names in committed, unqualified CE09 checkpoint e554139fe6f62274e28d9a2bacb33aca0227d18d. It is neither a producer validator nor a real producer report. No mutable CE09 draft is used. Inputs cannot confer report provenance, final rights, budget limits, repair eligibility, approval, composition or handoff receipts.

The separate `/inspection-presentation.html` demo uses only those local inputs. It never injects reports into the actual native Apply journey. Pending, unavailable, failed, acceptable-for-review, recommended-repair, human-review, refusal and report-failure states have fixed local wording and stable edit/inspection/design/brief/artifact references. Usage completeness and reservation status are separate: partial/unknown usage leaves total cost unknown; even complete usage supplies no cost here. A held reservation remains held. No input string can start repair, approve artwork or authorize purchase.

Status updates use a polite status region, failures use a focused alert, and scenario selection works with the keyboard. Safe references use the existing bounded privacy screening. Unsupported version/fields, private prose, unknown codes, credential-shaped IDs, signed URLs and hostile own-property hooks fail closed. Raw recommendation/reason/error text, prompts, artwork bytes, provider request IDs and observations never render. The disabled inspect button explains the actual missing prerequisite. This page's successful browser tests are presentation evidence only.

## Actual native browser evidence

The existing loopback host reset accepts only `png`, `jpeg` or `webp`. All three use the existing intercepted native provider/codec, real API, immutable CE08 bytes and paired C03/CE11 path. Browser tests exercise keyboard draft/follow-up/locks/zero-call behavior, explicit Apply, decoded image dimensions, exact byte/hash/parent/media bindings, private-attribution fingerprints, current selection/history, duplicate and historical replay, Compare, Restore, stale action rejection, post-ACK cancellation and unknown-usage failure/hold/replay. Original server and browser regressions remain required.

The fixture-only `/__fixture/native-evidence` endpoint returns hashes of private attribution and request identity, stored attempt/target bindings and sanitized transport byte metadata. It withholds evidence on revoked read policy. It does not return raw usage or raw provider request IDs. Public result hashes and private attribution fingerprints are distinct.

PNG fixture pixels differ between parent and output; this proves only that fixture path. JPEG/WebP use static valid codec samples for both parent and output. Matching parent/output bytes in those formats are expected and prove native transport/decoding, **not** visual edit quality. Zero live application-provider calls occur. Fixture identity, rights, Finance and owner usage mapping remain MOCK/simulated.

## Reproducible checks and pending prerequisites

Run on exact Node 22.23.3 and 24.15.0, with the runtime directory first in PATH so browser servers/workers use it:

```sh
npm ci --ignore-scripts --offline
npm ci --ignore-scripts --offline --prefix examples/frontend-action-roundtrip
npm ci --ignore-scripts --offline --prefix src/models/codec-runtime
node fixtures/controls/check.mjs --browser --out examples/frontend-action-roundtrip/test-results/current-evidence.json
make build
make check TARGET=all MODE=mock
make acceptance TARGET=all
node tests/controls/package-export-prerequisite.mjs
node examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc -p tests/controls/types/tsconfig.package-prerequisite.json
```

The controls runner includes the new pure consumer checks and strict **source** types. It does not establish public packaging. The separate runtime package check must actually fail while `creative-engine/controls` is absent, and the strict package consumer must actually report TS2307; neither is skipped, shimmed or included as a passing aggregate. Expected acceptance remains exit 2. Record actual commands, exits and runtime identities. Archive raw stdout/stderr, browser artifacts, screenshots and source identities outside Playwright's cleanup directory before the next run. Historical evidence JSON remains immutable with its original identities, including genuine prior failures.

Required local work remains: qualified corrected CE09 merge followed by actual `api.invoke` inspection on the same creative SQLite store; public controls export/build/strict package consumer and controls CI codec installation under a serialized root grant; actual CE06 zero-image composition/ordered compound/research correction; actual CE10 exact-artifact approval-bound handoff; full downstream release journey and renewed complete actual-PR review/current CI/pinned merged checks. CE09 F1 cumulative deadline, F2 final rights/TTL, F3 mixed usage and F4 terminal replay corrections remain exclusively backend-owned. These presentation tests do not resolve them.

External gates remain canonical producer/consumer contract agreement; authentic application identity/rights/approval; Finance grants, rates, ledger and reconciliation; harness-owned DecisionPort/observer capabilities; Neatlogs ingestion/readback; Q01 accepted corpus/promotion; separately authorized live providers; declared production consumer/renderer agreement; exact CloudLinux/CageFS/LVE host validation. This preparation grants no local, external or global acceptance.

PR-ready ordinary references: issue 17 (CE05); related issues 16 (CE09), 18 (CE06), 19 (CE10). No issue closure or approval transfer is claimed.
