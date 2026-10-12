# Candidate production adapters

Status: **unaccepted development implementation; supplier eligibility blocked**.
The package root retains its runtime API. `@jevelopers/print-production/candidate`
exports `createCandidateProductionOperations(authenticatedHost)`. Its six
`ProductionOperations` methods use the exact owner `./production-operations`
context, request and Promise result unions. No canonical schema is copied here.

The immutable owner archive is vendored unchanged at
`vendor/shared-contracts/jevelopers-shared-contracts-0.9.7.tgz`. Consumer metadata
records reviewed PR31 source `d432ad5c895a67155affeaa05cd8423c758d95c3`, package 0.9.7,
archive SHA-256 `771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43`,
SRI, package-content and fixture digests, and `accepted:false`. Installation used
Node 24.21.0/npm 11.19.0 with `--ignore-scripts --offline --no-audit --no-fund`.
Archive entries were reviewed before installation: 362 regular `package/` files,
35,333,144 unpacked bytes, no unsafe paths, duplicate names or links. The content
manifest covers exactly the 361 other archive members. Every listed content,
fixture and schema hash was verified; all 362 installed files match the archive.
Package-content digest is
`sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1`;
fixture digest is
`sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab`.
The schema manifest lists all 86 version/schema hashes and reports
`source_revision:null`; source provenance comes from the separate owner receipt.

Compared with the retained historical 0.9.4 archive, all 86 schemas and all 90
existing fixture files are byte-identical. The new 91st fixture is the explicitly
synthetic `ProductionRowCsvContextCalibration.json`. The sole declaration change
adds `ProductionZipDescriptor = Pick<ArtifactFile, 'filename' | 'byte_size' |
'byte_hash'>` and accepts those descriptors in `verifyProductionZip`; all six
operation signatures and package export targets are unchanged. Runtime helpers
add facts-reference, row/batch, conditional CSV, missing error/geometry context,
file-inventory and idempotency guards. Three new compatibility finding receipts
retain the owner review inputs. Generated manifests, package version, changelog
and production documentation also change. No owner source is forked here.

The [owner review receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714)
and [private development permission](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6115346934)
permit this immutable private interface before all nine consumers are complete,
under supervisor section 8 criterion 5. They confer no complete program/domain
acceptance or genuine authority. `accepted:false`, `live_integration:false` and
blocked supplier eligibility remain recorded in actual output provenance.

The host authenticates scope, actor/audience, current access, resolver and approval
ports independently. Requests use the factory's frozen `context`; replacement
contexts and undeclared reference versions/hashes fail before resolver access.
Source records, current canonical approvals and byte permissions are parsed and
rechecked, including replay and status reads. The host supplies mappings from
canonical UUID/revision references to existing private IDs, fonts, node styles,
constraints and private permission ports. Mappings and their complete commitments
are persisted in scoped, immutable SQLite records. New output/job/evidence IDs
are issued durably by this producer; external IDs, facts and approvals are not.
Class-based ports retain their authenticated receivers. Profile data is copied
and frozen while external permission backend state remains mutable for revocation.

```ts
import { createCandidateProductionOperations } from "@jevelopers/print-production/candidate";
const candidate = createCandidateProductionOperations(authenticatedHost);
const result = await candidate.operations.composeArtifact(candidate.context, request);
```

| Operation | Actual development behavior |
| --- | --- |
| `composeArtifact` | Canonical template/composition/personalization/facts/spec/capture checks; exact nm/mm conversion; existing private asset parsing, fonts, composition and permission checks; durable SVG publication. |
| `personalizeArtifactBatch` | Canonical structured plan checks; isolated persisted job namespace; existing durable claims/fences, row composition, real export and canonical per-row bundle bytes; private atomic/partial policy and host cancellation; returns a real `JobRef`. |
| `inspectArtifact` | Existing model/permission inspection plus persisted byte-bound final-file evidence; canonical preflight projection with actual stored evidence. |
| `exportArtifactBundle` | Existing offline Chromium SVG/PNG/PDF rendering and actual output inspectors; newly assembled v2 manifest, exact ZIP, detached metadata and independent trusted outer commitment; owner byte verification before atomic publication. |
| `compareTemplateCompatibility` | Owner template comparison plus actual private constraint comparison using authenticated mappings. |
| `getArtifactManifestStatus` | Scoped stored retrieval and owner byte verification; current input/access checks; no new execution or usage attempt. |

All render-affecting private node values, transforms, clipping, text policy, font
bytes/descriptors, source mappings, geometry and output policy participate in the
resolved layout commitment. Source, render, private revision, semantic, canonical
manifest content, raw manifest and final ZIP hashes remain distinct. The bundle
ships real outputs plus canonical preflight and lineage JSON. Internal SQLite
snapshots are not shipped payloads. The manifest describes payloads only; its raw
hash and the final ZIP hash live in detached/outer metadata, avoiding cycles.
Owner 97/98/100 count and 8/32/40 MiB bounds are enforced alongside lower private
64-file/16 MiB storage and 32 MiB ZIP bounds. The exporter receives the 8 MiB
entry ceiling before rendering; metadata limits apply before ZIP packing.

Compose/export execution attempts and the existing batch attempts produce durable
local observations/outbox entries. Provider and billable IDs, prices, finance
receipts and canonical `UsageEvent` references are absent. These observations
remain staged; no accepted finance intake or synthetic acknowledgement is
claimed. Replays reuse durable publication and do not add execution attempts.
Completed status does not create new observations or evidence records once
terminal intents are staged; missing terminal usage may be reconciled on replay.

PR30 review corrections refresh private asset and composition permission backends
on cached compose/export and artifact/job observation. Restored row models carry
their actual values and use the export action; clocks are read again for each
check. Revocation leaves immutable bytes and prior attempts intact.

Canonical publication commits its attempt outcome and terminal observation intent
in the same SQLite transaction. If the outbox is full or terminal telemetry is
unavailable, `canonical_completions` retains that intent. A bounded reconciliation
page runs on authorized entry/replay; the internal `reconcileCompletions` adapter
also permits a host to drain pending intents after delivery frees capacity. It
creates each terminal observation once, without increasing the outbox limit,
deleting observations, or rendering committed output again. The atomic attempt
outcome remains authoritative while an intent has no event. Full capacity before
publication yields a retryable unpublished attempt. Legacy published NULL
attempts are joined through their published observation and reconciled on replay.

Each export key retains its own immutable `export:<operation>` record and bundle.
The append-only `canonical_exports` index selects the latest committed export for
artifact status, using its SQLite commit sequence. The old `bundle:<artifact>`
record remains an immutable first-export compatibility lookup. Semantic batch
redelivery reuses the original persisted request and plan; new delivery IDs and an
explicit default atomic policy do not replace job identity or create row attempts.

Every supported compose/restoration resolves and verifies the exact scoped
`ProductionRuntime` record. The `canonical-private-runtime/v1` mapping hashes the
actual compiled product JavaScript, installed runtime dependency bytes, security
launcher sources, verified runtime
pins/environment, Chromium binary and selected output configuration into distinct
renderer and parser commitments. The record source revision must match the
authenticated producer build revision. Its canonical content hash remains separate
from those commitments and from the existing private renderer-pins digest. Both
the canonical record and measured mapping are durable; fresh checks reject a
retained pin after source/configuration changes. Offline fixture records use the
current checkout revision and real measurements; they supply synthetic authority,
not external approval. A deployment must provide the matching immutable record
and required measured resources. Packed distribution remains unverified.

Unknown callback rejection values are converted at the public/attempt boundary
to fixed typed failures without reading their text or serializing raw objects.
Failure classification is durable even if terminal telemetry must be deferred;
failed diagnostic persistence yields the canonical unavailable reference.
Base and row lineage and batch evidence read version/source/digest/unaccepted
status from the actual consumer pin, verified against installed version/archive.

## Concrete contract gaps and remaining acceptance

Candidate 0.9.7 `checkRowResult` rejects visible successful rows unless their
eligibility is `eligible`; `checkBatchResult` requires every successful row to be
published for a successful batch. Real development row bundles are integrity
passed but blocked, so exporting their references as canonical visible successes
would require counterfeit eligibility. The adapter instead returns the durable
job reference. Job status includes persisted local execution/count evidence and
`batch:null`; actual per-row canonical bytes and exact input/row/ordinal/job hashes
remain stored privately. Tests demonstrate the owner helper's
`INVALID_PUBLICATION` rejection. The owner supports `JobRef` with truthful
persisted row evidence while publication eligibility is blocked. No draft-ref
field exists; PP#13.4 canonical visible row/batch publication remains unfulfilled.

The historical 0.9.3 owner review requested changes for SC-CHK-018 (invalid-clock
TypeError) and SC-CHK-021 (noncanonical independently expected references/bindings
escaping pure helpers). Owner 0.9.4 repaired these paths to typed context failures.
The reviewed 0.9.7 archive adds subsequent context repairs described above;
independent review of this consumer refresh remains pending. Host clock
parsing and typed expected values remain in place; owner source is vendored
unchanged. V2 supplier eligibility intentionally remains `LEGACY_UNREPRESENTABLE`:
an `ArtifactFile/2` preview cannot be equated with `Preview/1` approval.

CSV is disabled without an authenticated enabling policy; existing conditional
private parser mechanics are retained. This candidate factory does not implement
CSV activation or automatic repair scheduling. Existing private mechanical repair
and permission behavior remains available in the private pipeline; a canonical
repair publication needs an independently supplied policy and an explicit
derived-composition/approval mapping. No repair approval is inferred.
An authenticated registered repair-policy reference is an equality-checked pin,
not a transform request. An ordinary no-repair composition may carry it through
compose/replay/export. Mismatched pins fail, and a composition needing an actual
repair remains blocked at export; no automatic shrink, derivative or approval
claim is introduced.

Production mode is blocked before source callbacks while this pin is unaccepted.
Accepted shared-contracts/domain and consumer pins, genuine launch SKU/spec,
creative/event/app authority/access fixtures, real finance intake, and unchanged-
hash fulfillment validator acceptance remain external blockers. No supplier order,
paid generation, registry publication, CI repair, issue closure or release claim
is part of this work. Entire graph retrieval was unavailable (`entire` not
installed); there was no `.codegraph` index. No index or toolchain was installed.

## Acceptance mapping and local evidence

PP#5 has six concrete typed candidate bindings; accepted public API remains open.
PP#16 has actual canonical all-file development bytes and owner byte verification;
supplier/consumer acceptance remains open. Concrete adapter paths support portions
of #6/#7/#8/#9/#10/#11/#12/#13/#14/#17/#18/#19; none of those issues is declared
accepted or complete. Required canonical visible row publication, canonical repair
mapping, conditional CSV activation and external authority/intake are explicitly
unfulfilled as described above.

Focused tests are `canonical-production*` under unit, contract and integration.
Synthetic doubles provide authority/spec/resolvers; rendering, glyph/file
inspection, SQLite and owner validators are real. Coverage includes exact ticket
text, leading zeros, Unicode, concurrent/revised idempotency, restart, partial and
atomic failures, cancellation, forged scope/authority, stale/revoked/changed input,
wrong references/versions/hashes, unsupported geometry/profile, payload/ZIP
missing/extra/tampered bytes, row-scope mismatch and blocked row publication.

```sh
export PATH=/tmp/pp01a-runtime-toolchain/node-v24.21.0-darwin-arm64/bin:$PATH
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8
npm run build
npm run typecheck
npm run format:check
PP_CANONICAL_EVIDENCE_DIR=out/canonical-evidence node --test --test-concurrency=1 \
  dist/tests/unit/canonical-production*.test.js \
  dist/tests/contract/canonical-production*.test.js \
  dist/tests/integration/canonical-production*.test.js
```

Exact commands, outcomes, commits and output digests are recorded in the ignored
`out/canonical-adapter-report.json`. The separate dependency refresh receipt is
`out/canonical-refresh-report.json`; preceding 44 focused and 602 broad passes are
historical receipts, not a full-suite claim for the refreshed HEAD. Independent
parent review of this consumer candidate is still required. The owner 0.9.7
review and development permission are recorded above.
The review-fix receipt is `out/canonical-fix-report.json`; it preserves baseline
failures, permanent regression results, separate-process interruption evidence and
the exact fixed commit/tree. It supplies implementation evidence for a fresh
independent review and does not self-approve the candidate or accept owner 0.9.4.
The current dependency refresh evidence is `out/contracts-097-report.json`, with
the exact consumer HEAD/tree, complete archive delta, all-member installation
audit, final-head checks, six-operation/base-row byte proofs and negative-owner
command/control evidence. Earlier 0.9.4 reports and producer fixture base revisions
remain historical evidence.
