# Production contract development candidate 0.9.0

Issues 34-37 add 24 separate local criteria. The original 126 criteria, global27 and CAP7 keep their identities and acceptance status. This private, unreleased package supplies canonical data, readonly types and pure checks. Genuine authority, renderer/storage implementations and consumer acceptance remain separate owner handoffs.

## Host interfaces and errors

Import `ProductionOperations` and the new host `ProductionContext` from `@jevelopers/shared-contracts/production-operations`. The root and commerce-evidence retain the existing commerce ProductionContext, which describes supplied evidence validation. Host scope, fresh clock, policy, environment/billing/evidence modes and reference/authorization/assets/templates/runtime/storage/metering ports are independent of requests. Shared-contracts never calls those ports.

```ts
import type { ProductionOperations, ProductionContext } from
  '@jevelopers/shared-contracts/production-operations';
import type { ProductionContext as CommerceProductionContext } from
  '@jevelopers/shared-contracts/commerce-evidence';
```

| Exact service name | Request | Promise constituent |
| --- | --- | --- |
| composeArtifact | ComposeArtifactRequest | ProductionResult<ArtifactRef> |
| personalizeArtifactBatch | PersonalizeBatchRequest | ProductionResult<JobRef or BatchResult> |
| inspectArtifact | InspectArtifactRequest | ProductionResult<PreflightReport> |
| exportArtifactBundle | ExportBundleRequest | ProductionResult<ProductionBundleRef> |
| compareTemplateCompatibility | CompareTemplateRequest | ProductionResult<CompatibilityReport> |
| getArtifactManifestStatus | ArtifactStatusRequest | ProductionResult<ArtifactManifestStatus> |

Each method takes `(ctx: ProductionContext, request: Request)`. These are service binding interfaces without callable compositor stubs. ProductionResult is exactly `{ok:true,value:T}|{ok:false,error:ProductionError}`. Pure checks use the existing value/errors style; the two boundaries are not aliases. `validateProductionResult` selects actual concrete constituents. A successful inspection report may contain unknown or failed checks and cannot imply eligible publication.

Requests carry exact discriminator/schema/policy, request/correlation IDs and operation fields only. Forged tenant/project, time, environment, billing or authority fields reject before reference access. Missing/foreign expected refs return indistinguishable NOT_FOUND. Hosts authenticate scope, freshness and all reads; opaque IDs grant no access.

ProductionReference is a closed supported-contract/version union with canonical UUID, safe positive revision and prefixed SHA256. Old VersionedReference retains its version and revision-zero behavior. ArtifactFile/2 and ProductionBundle/2 are explicit new versions; standalone new values are 1.0.0. String/digest revision adaptation returns LEGACY_UNREPRESENTABLE until an actual registry mapping exists.

All 21 ProductionError codes have fixed safe messages and fixed retry hints. Only classified transient approval-unavailable/storage/render failures are retryable; no retry/spending/replay authority follows. Side effects and usage remain explicit and default unknown when observation is absent. Diagnostics distinguish a scoped persisted ProductionDiagnostic ref from unavailable scoped correlation; no persisted hash is fabricated. Field paths, row IDs, correlations and details remain restricted.

Diagnostic precedence: unsupported schema version; otherwise malformed shape/cardinality/duplicates/unknown fields; then recognized unsupported format only when remaining issues are exclusively format enum mismatches. Single JPEG is OUTPUT_UNSUPPORTED; excessive/duplicate supported formats are INVALID_INPUT. Approval checks retain revoked/unavailable/invalid distinctions, reject expiry equality/future observations and require an exact current supplied observation rather than cached validity.

V1 error conversion validates an actual ErrorEnvelope constituent, carries original code and declared losses, and preserves side effects/usage. Unsupported transient vocabulary returns LEGACY_UNREPRESENTABLE. Conversion does not manufacture diagnostic persistence.

## Desired layout, composition and identity

TemplateSpec contains bounded declarative slots, desired nm canvas/trim/bleed/safe geometry, orientation, fonts, effective DPI, formats and immutable policy/spec/capability pins. PrintSpec and FulfillmentCapabilitySnapshot are reused unchanged. Desired layout never confirms supplier geometry.

PersonalizationSchema is independent of TemplateSpec and has no hashed back-reference. TemplateSpec references it in one direction. Composition binds scope, design/handoff/facts/template/spec/capability, ordered assets, exact values, readonly fact bindings, formatting/layout/output/repair, fonts/runtime and an independently compared resolved-layout commitment. Barcode input is explicitly absent or bound to its own input commitment; a facts digest is never renamed as barcode identity.

Immutable values exclude only their own content_hash. A PreflightReport hashes its immutable body without the wrapper report ref or current eligibility. ArtifactRef contains immutable identity; status/eligibility live in observations. Existing jevelopers-json-v1 governs UTF-16 key order, exact well-formed Unicode, safe/finite ECMAScript numbers and no normalization. Raw bytes have a distinct digest domain.

The semantic request digest includes operation/schema/policy, exact effective inputs, ordered original rows, atomic default, conditional CSV refs and all supplied runtime/font/output/template/spec/capability/approval pins. Transport IDs and the idempotency key are excluded. The key belongs to the tenant/project/operation namespace. Fresh clock, status and delivery attempts are not input fields. No persistence, replay, retention or paid execution is implemented.

| Private concept | Canonical field mapping | Boundary |
| --- | --- | --- |
| mm coordinates | Integer nm desired geometry | BigInt conversion to exact six-decimal mm; independent private maximum required |
| String/digest revision | UUID/positive ProductionReference | No coercion; real registry issuance pending |
| Scene nodes/transforms/crops/blends/visibility/style | Resolved-layout commitment and expected commitment | Producer attests completeness; opaque SHA alone cannot |
| Font buffers/system fonts | ProductionResource font/license commitments | Buffers stay private; real font/license pins pending |
| Private approved facts | Existing EventIntelligencePackage with independently supplied package/readonly bindings | Unsupported or unconfirmed facts block; no SyntheticFacts catalog export |
| Product dimensions | Existing PrintSpec physical dimensions | Never inferred as trim/printable/inset basis |
| Source/display assets | Exact source refs/bytes and normalization policy | Missing/extra/substituted inventory rejects |
| Composed preview | Actual preview ref or null | Render hash is not customer preview authority |
| Unknown telemetry | Existing finance/intake contracts | Unknown stays unknown; no zero/provider/build/ledger guesses |

Nm conversion bounds are +/-2,000,000,000 nm and an independently supplied lower private limit. No rounding occurs. Geometry translation requires known trim, printable, inset basis, bleed, safe and surfaces; unknown/unsupported input fails explicitly. Material template changes require relayout and domain reapproval.

## Rows and conditional CSV

Stable unique row IDs and zero-based source order are retained. Input hashes precede explicit optional display defaults. Identical values under distinct IDs remain distinct. Duplicate IDs, readonly/extra fields, missing/empty required fields and exact UTF-16 bounds reject the whole plan. Limits are 10,000 rows, 32 fields, 4,096 UTF-16 units per cell and 4,000,000 canonical plan bytes; supplied policy may be lower.

Atomic is the effective default. Execution counts globally partition submitted into succeeded/failed/cancelled/skipped/pending; published count is separate. Atomic failed/cancelled and nonterminal operations expose zero publication refs. Partial publishes only complete successes matching independent row metadata and keeps all failed/cancelled/skipped diagnostics. Published bundles bind job/row/ordinal/original-input hash/composition. Skipped requires a reason; cancellation request is distinct from terminal cancellation.

Pages contain at most 100 rows. Complete contiguous source-ordered pages are needed to recompute global counts/publication. Cursor authentication, durable lifecycle, concurrency, fencing and publication remain host-owned; queue/lease objects stay private.

Atomic projects to PartialFailure all_or_nothing; partial projects to partial using committed visibility. Unpublished execution-success rows remain explicitly unprocessed. Terminal partial JobStatus narrowly projects to failed/failed plus PARTIAL_FAILURE and BatchResult reference. Each projection declares loss/non-equivalence and needs consumer agreement; there is no succeeded/partial cast. Unrepresentable projections fail explicitly.

CSV is disabled before fetch/scheduling. Conditional CsvDialect/CsvMapping/CsvCheckpoint values declare UTF-8/BOM/delimiter/quote/newline/exact headers and complete-record positions bound to file/dialect/mapping refs. Supplied enabling/checkpoint evidence is checked without implementing a parser or enabling launch. Streaming, quoted multiline records, malformed encoding, inert formulas and download escaping remain producer/parser work.

## File protocol and finite bounds

ArtifactFile/2 carries exact raw byte hash/length, safe flat ASCII names, closed roles and explicit nullable geometry/profile/characteristics. Nonvisual JSON/ZIP/ICC cannot invent visual dimensions. Profile JSON is a description, not ICC bytes. Hybrid SVG/PDF is not automatically all-vector.

1. Hash all final shipped payloads, including reports/profile/lineage and applicable source/preview/output.
2. ProductionBundle/2 files contains payloads only: at most 97; no manifest, archive, detached or nested ZIP.
3. Bundle content hashes canonical manifest excluding only bundle_hash. Insert it and serialize exact canonical UTF-8 without BOM/newline; raw manifest has its own byte hash.
4. ZIP contains exactly payloads plus manifest.json, at most 98 entries, sorted flat stored regular files with fixed 2000-01-01 timestamp and no extras/comments. Hash raw ZIP bytes.
5. Detached metadata contains bundle-content ref, raw manifest/archive descriptors, raw lineage hash and canonical sorted payload-set hash without its own descriptor.
6. A separately trusted outer commitment contains all payloads plus manifest/archive/detached, at most 100 descriptors, including detached byte hash. Untrusted co-tampering cannot authenticate itself.

Artifact bounds: 8 MiB per ZIP entry, 32 MiB aggregate payload, 40 MiB ZIP, 4 MiB manifest and 1 MiB detached. Count/length/aggregate checks precede body allocation/hashing. Verification is pure in-memory without extraction/inflation. Missing/extra/duplicate/casefold/unsafe names, recursion, prefix/trailing junk, encryption, links/directories, unsupported compression and central/local inconsistencies reject.

Integrity may pass with eligibility blocked. Independent eligibility checks require supported facts/composition, exact capability/spec and confirmed geometry, actual composed preview, complete mandatory final-file preflight, current scoped composition approval, exact row scope and accepted domain/consumer pins. They issue no authority. Calibration remains blocked; real product/per-row/consumer acceptance evidence remains pending.

V1 schemas and fixture bytes remain unchanged. Root ProductionBundle is a version union; commerce helpers explicitly decode v1 and retain v1 contexts/returns. V2-to-v1 protocol translation returns LEGACY_UNREPRESENTABLE. Exact version dispatch may read retained v1 without claiming semantic equivalence.

## Generation, classification and handoff

Standalone validation is split into baseline and production modules, each below the unchanged 16 MiB npm member cap. Selective declaration generation avoids bounded tuple expansion while retaining runtime bounds. Npm safeguards remain 32 MiB compressed/64 MiB expanded, independently of artifact ZIP limits.

Every new field has x-classification. Exact values, low-entropy row hashes, scope, diagnostic paths/IDs and unknown private fields stay restricted. Existing EvidenceProjection remains the public allowlist; no scenegraph, font buffers, signed locators or customer content are added. ProductionCalibration contains synthetic calibration bytes, not a public wire payload.

[Derived provenance](../fixtures/ProductionDerivedProvenance.json) pins all 35 raw vector hashes, correction version and new domains. [Calibration](../fixtures/ProductionCalibration.json) is synthetic/unaccepted and separates byte integrity from semantic or production conformance. Independent row metadata tests have no genuine personalized bytes claim.

The six old installed examples remain. Installed checks compile six service bindings and both contexts, exercise schemas/fixtures and reject invalid readonly/type mutations. [Impact](../compatibility/production-impact.json) keeps accepted pins/acknowledgements null. D3/D6/D7/D8/D9/D10, L5-L8, per-row authority and actual consumer integration remain pending.
