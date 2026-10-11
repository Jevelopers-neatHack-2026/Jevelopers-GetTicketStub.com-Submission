# Candidate production adapters

Status: **unaccepted development implementation; supplier eligibility blocked**.
The package root retains its runtime API. `@jevelopers/print-production/candidate`
exports `createCandidateProductionOperations(authenticatedHost)`. Its six
`ProductionOperations` methods use the exact owner `./production-operations`
context, request and Promise result unions. No canonical schema is copied here.

The immutable owner archive is vendored unchanged at
`vendor/shared-contracts/jevelopers-shared-contracts-0.9.3.tgz`. Consumer metadata
records PR31 head `d129ea0a83be926882b194cb88a6cf30c3831685`, package 0.9.3,
archive SHA-256 `5a4d345ee2751e731aa44c1bbe33a079109998b6471ce2c7daa0b74aedec9352`,
SRI, package-content and fixture digests, and `accepted:false`. Installation used
Node 24.21.0/npm 11.19.0 with `--ignore-scripts --offline --no-audit --no-fund`.
Archive entries were reviewed before installation: 357 regular `package/` files,
35,279,296 unpacked bytes, no unsafe paths or links. This pin is not acceptance.

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
Read-only status does not create new observations or evidence records.

## Concrete contract gaps and remaining acceptance

Candidate 0.9.3 `checkRowResult` rejects visible successful rows unless their
eligibility is `eligible`; `checkBatchResult` requires every successful row to be
published for a successful batch. Real development row bundles are integrity
passed but blocked, so exporting their references as canonical visible successes
would require counterfeit eligibility. The adapter instead returns the durable
job reference. Job status includes persisted local execution/count evidence and
`batch:null`; actual per-row canonical bytes and exact input/row/ordinal/job hashes
remain stored privately. Tests demonstrate the owner helper's
`INVALID_PUBLICATION` rejection. Full canonical row/batch publication is pending
an owner-supported representation of blocked development execution.

The owner review at this frozen head remains REQUEST_CHANGES for SC-CHK-018
(invalid-clock TypeError) and SC-CHK-021 (malformed independently expected
references/bindings escaping pure helpers). Host clock parsing and typed expected
values prevent those inputs reaching helpers here; owner source remains untouched.
The owner eligibility helper still returns `LEGACY_UNREPRESENTABLE` for the genuine
legacy preview/approval mapping. This adapter does not bypass it.

CSV is disabled without an authenticated enabling policy; existing conditional
private parser mechanics are retained. This candidate factory does not implement
CSV activation or automatic repair scheduling. Existing private mechanical repair
and permission behavior remains available in the private pipeline; a canonical
repair publication needs an independently supplied policy and an explicit
derived-composition/approval mapping. No repair approval is inferred.

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
`out/canonical-adapter-report.json`. Independent parent review is still required.
