# Fulfillment capability and print-spec proposal (#32)

`FulfillmentCapabilitySnapshot@1.0.0` is an immutable supplier capability capture;
`PrintSpec@1.0.0` is its exact per-product specification value. Both are new
producer proposals pending canonical maintainer, fulfillment, print-production
and application review. Package 0.8.0 is an unreleased candidate. Neither name
claims a supplier authentication result, renderer capability, selected launch
SKU/country/method, successful preflight, print eligibility or order authority.
The existing `PrintSpec` reference label is retained. There is no generic
`CapabilitySnapshot` alias: the print-production renderer API is separate.

The concrete input is fulfillment revision
`cfc03caced85256b5d19f35a80d5886bc2171950`, published in
[receipt 6104784220](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4#issuecomment-6104784220).
The four received files are `src/catalog.ts`, `docs/catalog.md`,
`tests/catalog-fixtures.mjs` and `tests/catalog-suite.mjs`. The fixture file's
SHA256 is `b72f94405efbd201cad9cc039a326482dae9ab939eef45679df2b7337807e55e`.
That file digest is distinct from a canonical payload or package digest.
[The alpha/beta data](../compatibility/capability-source-fixtures.json) retain
the two actual synthetic input shapes. No producer normalizer, discovery port,
selection evaluator, provider adapter or approval service is copied here.

## Exact field migration

`adaptFulfillmentCatalogV1(input, context)` only maps the received
`connector-development-catalog/1` field version. It requires independent
`context.trusted_scope` UUIDs and explicit `context.now`. Submitted scope fields,
unmapped fields and unsupported private versions reject. Successful results own
deeply frozen copies. Decimal conversion preserves values without rounding;
the original field spelling, decimal spelling and array ordering remain in the
source fixture/pinned source, not in an implied reversible byte encoding.

| Received field | Canonical field and decision |
| --- | --- |
| `localFormat` | Explicit adapter version gate; canonical `contract/schema_version/policy_version` are fixed discriminators. |
| `providerId/apiVersion/catalogVersion` | Snapshot `provider_id/api_version/catalog_version`; provider/API also bind each `PrintSpec`. |
| `source.reference/revision` | `source.reference/revision`, bounded opaque references, never credential-bearing URLs. |
| `source.retrievedAt/evidenceMode/evidenceReference` | `source.retrieved_at/evidence_mode/evidence_reference`; caller attribution, not authenticated provider observations. |
| Full private input | `source.input_hash`, SHA256 of canonical original input data; not a claim that the received file bytes or supplier are genuine. |
| `freshness.maximumAgeSeconds` | `freshness.maximum_age_seconds` and exact derived `fresh_until`. |
| `products[].sku/variantId/availability` | Embedded `PrintSpec.sku/variant_id/availability`; canonical availability also allows explicit `unknown`. |
| `constraints.dimensions` | `physical_dimensions`, exact width/height/depth in integer nanometres; basis `unspecified_physical_product`. Physical stock, printable, trim and outer-frame equivalence are not inferred. |
| Missing geometry distinction | `geometry.trim/printable/outer_frame` and `inset_geometry_basis` explicitly unknown with `not_in_source`. Separate known geometry needs its own `evidence_ref`. |
| `minimumBleed/minimumSafeArea` | `minimum_bleed/minimum_safe_area`, four exact nanometre insets. The source does not establish their geometry basis. |
| `minimumResolutionDpi/surfaces` | `minimum_resolution_dpi/surfaces`, positive integer DPI and bounded identifier sets. |
| `files.types/minimumCount/maximumCount` | `files.mime_types/minimum_count/maximum_count`, MIME syntax and inclusive integer counts; minimum cannot exceed maximum. |
| `color.spaces/profiles` | `color.spaces/profiles`, explicit bounded nonempty sets. |
| `options/materials` | Explicit states and identifier sets; known options may be empty, known materials must be nonempty. |
| `personalization.modes/maximumFields/maximumCharactersPerField` | `personalization.modes/maximum_fields/maximum_characters_per_field`, limits only; no names, customer text or row data. |
| `destinations[].countryCode/regions` | `country_code/regions`; known nonempty source regions become `mode: allowlist` with codes. Only an explicitly known empty source list becomes `mode: unrestricted`. Unknown/unsupported never become unrestricted. |
| `shipping[].countryCode/regionCode/methods` | `country_code/region_code/methods`; null means declared country-wide route. Duplicate route keys and known country/region contradictions reject. Consumers apply exact-region precedence over the country-wide fallback; shared-contracts does not choose a route. |
| `providerAttributes` | `provider_metadata`, source JSON preserved including array order; participates in material spec identity. |
| Private normalizer's `specIdentity/catalogContentIdentity/snapshotIdentity` | New canonical `spec_identity/content_identity/capture_identity` algorithms below. Private hashes must be explicitly recomputed after mapping, never relabeled as canonical. The adapter accepts the raw development input, not the private normalized output. |
| `CatalogSource/Constraint/selection/signatures` | Private library types/behavior; no independent wire exports. |

Every constraint has exactly one state: `known` plus a valid value, `unknown`
plus a bounded reason, or `unsupported` plus `provider_declares_unsupported`.
Ambiguous unsupported reasons reject rather than invent a provider declaration.
Missing states/constraints reject. Unknown constraints remain valid data about
uncertainty; a structural or consistency success cannot make them print-ready.
Fulfillment/production must block mandatory unknown/unsupported capabilities in
their own operation and selection boundaries.

## Units, identities and clock

Canonical physical values are decimal strings containing bounded integer
nanometres, at most 2,000,000,000 nm. Dimensions are positive; insets allow zero.
The source field adapter accepts `mm`, `cm`, `in` decimal strings with at most
three fractional digits. Conversion uses integer arithmetic and exact factors
1,000,000, 10,000,000 and 25,400,000. Unsupported units, leading zeros,
exponents, negatives, excess source precision and out-of-range values block.
The generic converter permits zero; fixed dimensions reject zero separately.
An accepted 0.001 inch value becomes exactly 25,400 nm. No floating arithmetic
or rounding is used. Legacy `inches/pixels` are not aliases for this adapter.

All identities use the existing `jevelopers-json-v1` canonical JSON and SHA256,
with separate domain tags. Spec identity covers provider/API, SKU, variant,
availability, every constraint (including separate geometry/evidence) and
provider metadata. It excludes tenant/project, catalog version and source
capture metadata. Content identity covers provider/API/catalog version, source
reference/revision and sorted product keys/spec hashes. Capture identity covers
content identity, tenant/project, complete source metadata/input hash and
freshness. Scope is checked independently even though spec/content hashes may
be equal across tenants; a hash never grants access or authority.

Only declared sets and product/destination/shipping rows are sorted for hash
calculation. Their wire values are preserved. Opaque metadata arrays preserve
order. Reordering source sets preserves spec/content hashes but changes the
original input hash and therefore capture identity. Exact equivalent units
preserve material spec identity. Different retrieved time, evidence attribution
or freshness changes capture only; source revision/catalog version changes
content/capture; changed material constraints change spec/content/capture.
No canonical hash is copied from a private producer algorithm.

Clocks are caller-supplied UTC strings with exactly millisecond precision.
`fresh_until = retrieved_at + maximum_age_seconds`, with a one-year policy
bound. Expiry equality is fresh; the next millisecond is stale. Invalid calendar
dates, a clock before capture, expiry mismatch and capture-time regression
reject. Comparing history verifies an expired old capture at its recorded
expiry solely for integrity; it does not return it as currently fresh.

## Pure boundaries and privacy

The root package and `@jevelopers/shared-contracts/capability` export the same
pure helpers: `checkPrintSpec`, `checkFulfillmentCapabilitySnapshot`,
`checkPrintSpecBinding`, `compareFulfillmentCaptures`, `hashPrintSpec`,
`deriveCapabilityIdentities`, `convertPhysicalLength`,
`adaptFulfillmentCatalogV1`, `translatePrintSpecToLegacy`.
Generated structural validators enforce exact supported versions without
coercion/defaults. Semantic helpers check scope, geometry, counts, route keys,
privacy/resource bounds and hashes using owned data. Hash derivation validates
mapped structure/consistency before computing identities; it does not validate
a provider or issue a signed receipt.

Binding checks compare exact product/spec and independently supplied capture
and content identities. They do not select artwork, DPI, formats, countries or
shipping methods. Capture comparison returns `unchanged`, `capture_refresh`,
`source_or_catalog_change` or `material_drift`, with changed product keys.
Material drift invalidates the previous binding; consumers must revalidate,
requote and obtain external approval as applicable. No helper performs any of
those operations, grants printing eligibility or reuses approval automatically.

Safe-area content-room checks require a separately known trim/printable basis.
They enforce left+right < width and top+bottom < height. Actual source fixtures
leave this basis unknown. `generic-known-print-geometry-control` fixtures are
separate synthetic controls, not missing fields invented for either supplier.
Outer-frame and physical dimensions never substitute for trim/printable data.

All scope, provider, source, geometry, constraint, metadata and hash fields are
restricted; only contract/version discriminators are public. The existing
`projectEvidence` allowlist strips capability payloads, source labels, stable
hashes and metadata recursively. Consumers must use independently assigned
public evidence IDs, not hash private low-entropy fields into a public ID.
Credentials, authorization headers, signed URLs, raw customer identifiers,
names/addresses/contact details and personalization content are excluded.
Metadata is bounded to 64 keys per object, 32 KB per product, safe integers,
4,096-character strings and 2,000-element arrays; complete helper inputs are
bounded to 1 MB, 20,000 traversal nodes and depth 16. Sensitive-looking keys,
URLs, email/phone/address/secret strings block. This screening is a contract
boundary, not an authentication or general-purpose data-loss-prevention claim.

## Compatibility and consumer obligations

Every existing schema, fixture encoding and immutable baseline remains intact.
`ProductionBundle@1.0.0.print_spec` only carries product/variant, numeric
width/height, `mm/inches/pixels` and one numeric bleed. It cannot represent
physical depth, geometry basis, four insets, DPI, source identities or richer
constraints. `translatePrintSpecToLegacy(..., 'ProductionBundle/1.0.0')`
returns `LEGACY_UNREPRESENTABLE` at `/print_spec`, even for a known generic
geometry control. Missing legacy fields do not represent richer constraints.

`FulfillmentQuote@1.0.0.spec_ref` already permits the `PrintSpec` label, but its
UUID/revision/content-hash reference has no accepted canonical spec issuing
authority or agreed consumer adapter. Translation returns
`LEGACY_ADOPTION_PENDING` at `/spec_ref`. `OrderAuthorization@1.0.0` binds quote
and bundle without a direct rich spec reference; translation is
`LEGACY_UNREPRESENTABLE` at `/bundle_ref`. No UUID is minted from a content hash.
An eventual bundle wire extension requires a reviewed new version with
explicit consumer migration and rollback; this slice changes no legacy wire.

SC-CAP.1..7 are a separate local related-follow-up map in requirements and
coverage. The original 126 criteria and 27 global IDs retain their encodings
and membership. New deliverables consume #4/#5/#6/#7/#8/#24/#25/#29/#30
artifacts without rewriting their authoritative dependency or closure graph.
The catalog records canonical ownership, fulfillment stewardship/producer,
and print-production, application, harness and eval consumers. Named owners,
acknowledgements, accepted pins and integration results remain null/pending.

Run the affected checks and [installed example](../examples/capability-consumer.mjs)
on supported Node 22.23.3 and Node 24.21.0. Pin the shared source SHA, package
version/archive integrity, schema hashes from `generated/schema-manifest.json`,
fixture digest from `generated/fixture-manifest.json`, package-content digest,
producer source revision and actual tested consumer SHA together. The source
SHA is supplied by the supervisor after committing, not fabricated from a
dirty candidate. Consumers must return actual results and acknowledgement for
the exact candidate. Local fixtures cannot satisfy genuine transport, account,
provider, renderer/preflight or launch gates. SC-CAP.7 additionally requires
fresh independent Astra High review, supervisor publication of a narrow
producer receipt, merged/post-merge verification and genuine required reviews.
Full production operation/template/personalization APIs and financial reporting
proposals remain separate pending concrete input/agreement.
