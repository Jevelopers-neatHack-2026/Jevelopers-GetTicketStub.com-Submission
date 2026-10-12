# SC-13 reporting/query/export proposal packet (PROPOSED, unreviewed)

Status: **proposal only**. Not adopted, not canonical, not exported, no compatibility promise.

Scope: shared-contracts#13 (SC-06C / GAP-001), plus the cost-intelligence requests in comments 6106954205 and 6110875437 and the Finance operational accounting record in cost-intelligence#14 comment 6103884301 (`ci-operational-accounting-1.0.0`).

Files (all under this folder, standalone, JSON Schema 2020-12, closed objects, local `#/$defs/...` refs only):

| File | Local proposed name | Known consumers |
| --- | --- | --- |
| `reporting-query.schema.json` | `ReportingQuery` | cost-intelligence (CI-08 query), team-dashboard, integration-evals |
| `reporting-export-manifest.schema.json` | `ReportingExportManifest` | cost-intelligence (CI-08X export), team-dashboard, integration-evals |

What this packet is not:

- The `$id` values are `urn:sc13-proposal:reporting-v1:...:0.1.0-proposed`. They are a proposal namespace, not canonical shared-contracts `$id`s, and nothing here is a public export of any package.
- It has no root package, dependencies, scripts, generated types, compatibility layer or fixtures. Fixture content needs Finance-approved metric definitions that do not exist yet; none are invented here.
- It does not compute ledgers, formulas, queries or CSV rendering, and makes no claim of actual dashboard integration. The files are plain JSON with no Node-only code, so a browser can load them, but no browser execution is claimed.
- It does not rename or redefine Finance policy. Metric names (`gross_sales`, `net_sales`, `direct_costs`, `contribution`, `operating_result`, `cash`, `budget_remaining`) are copied verbatim from `ci-operational-accounting-1.0.0` and only used as keys that point at an immutable definition reference. Formulas, class/sign matrices and recognition rules stay with Finance/cost-intelligence.
- The existing `FinancialSummary/1.0.0` (strict, no `as_of`) is untouched. Reconciling these shapes with it is an owner decision (Q-SUMMARY).

Contracts require owner review before any adoption. Reviewers: cost-intelligence (producer, storage/math/query/export), Finance supervisor (accounting semantics), team-dashboard (consumer), integration-evals (acceptance), shared-contracts maintainer.

## Shared building blocks (duplicated in both schemas, local refs only)

| `$defs` | Meaning |
| --- | --- |
| `id`, `token` | Bounded opaque identifier; lowercase vocabulary token (vocabulary is owner-supplied) |
| `utc_instant` | RFC 3339 shape, `Z` only |
| `iana_timezone`, `currency_code` | Shape only |
| `sha256` | `sha256:` plus 64 lowercase hex, zero-filled placeholder rejected |
| `immutable_ref` | `{id, version, content_hash}`, all required |
| `watermark`, `source_watermark` | `known {watermark_utc, cursor|null}` or `unknown {reason}` |
| `denominator_ref` | `{kind: approved_design|workflow|order, definition_ref}` |
| `decimal`, `known_decimal` (manifest only) | Exact signed decimal string; `known` or `unknown` with `value: null` and a reason |
| `object_ref` (manifest only) | `{object_store_id, object_key}`, no scheme/query/fragment |

Conventions: required fields are explicit (no defaults); arrays are bounded; unknown is encoded as an explicit object, never absent, `0` or `""`; amounts are never JSON numbers.

## Field decisions, owners and open questions

Every field below is a proposal. "Owner" is who must decide before adoption.

| ID | Fields | Proposed decision | Owner | Question |
| --- | --- | --- | --- | --- |
| Q-SCOPE | `query.expected_scope`, `manifest.scope` | Tenant/project are independent caller expectations, labelled `caller_expectation_not_authorization`. | cost-intelligence, auth owner | What trusted source supplies the real scope, and which component rejects a mismatch? |
| Q-PERIOD | `period.*` | Half-open `[start_utc, end_utc)` on `recognized_at` UTC, per Finance record. | Finance | Confirm half-open and `recognized_at` as the only period basis. |
| Q-TZ | `period.timezone`, `timezone_policy_ref`, `time_bucket` | Timezone only defines `day`/`month` bucket boundaries; the period itself stays UTC. | Finance, dashboard | Is that right, or must the period boundary itself be zone-local? Who owns the tz database version and DST rules? |
| Q-FX | `fx_conversion` | One currency partition per query; `const none_single_currency_partition`. | Finance | Issue asks for explicit sourced FX when requested. Add a dated FX source ref variant, or require one query per currency and let consumers present them side by side? |
| Q-ENV | `environments`, `billing_modes` | Bounded unique token lists, vocabulary not defined here. | Finance, cost-intelligence | Supply the closed vocabulary, including how test-environment live AI cost and simulated commerce are named. |
| Q-POLICY | `policy_refs.*`, `metrics[].definition_ref` | Four immutable refs plus one per metric. | Finance | Are these the right four policy axes? What is the canonical `id`/`version` for `ci-operational-accounting-1.0.0`, and how is its content hash produced? |
| Q-SNAP | `snapshot` | `pinned` (snapshot id, as-of, fingerprint) or `resolve_at_as_of` (as-of only; the producer must return a pinned snapshot in the manifest). | cost-intelligence | How is a fingerprint computed? Does a late entry always create a new snapshot id (per Finance record)? |
| Q-SRC | `sources`, `source_watermarks` | Source id plus known/unknown watermark; at least one entry. | cost-intelligence | Is a cursor needed in addition to a time watermark? Who owns source ids? |
| Q-FILTER | `filters`, `group_by`, `time_bucket`, `include_unallocated_bucket` | Dimensions `workflow_id, run_id, order_id, design_version_id, metric_key, accounting_class`. Each dimension may appear once (object key). Max 50 values, max 4 group-bys. Unallocated bucket is always requested. | cost-intelligence, dashboard | Confirm dimensions and limits. `accounting_class` values come from the Finance class list, which this packet does not copy. |
| Q-DENOM | `denominator`, `ratios[]` | Explicit `none` or `{kind, definition_ref}`. | Finance | Do we need more denominator kinds, or per-metric denominators? |
| Q-PAGE | `page.*` | Limit 1..500, order `group_key_asc`; cursor carries `bound_snapshot_id` and `query_hash`. A non-null cursor requires `snapshot.mode = pinned` (structural `if/then`). | cost-intelligence | Is a cursor allowed to expire? What does the host return when the bound snapshot is no longer available? |
| Q-VOCAB | `reconciliation_state`, `valuation_basis`, `coverage.completeness` | Placeholder enums plus actual/estimated/provider_confirmed buckets. | Finance | Map to the existing `FinancialSummary` values or replace. |
| Q-AMT | `precision`, `amount`, `unallocated_amount` | Decimal strings; no exponent, no `+`, no negative zero. `max_fraction_digits` 0..30. | Finance | Required scale per currency? Are negative metric values legal for each metric? |
| Q-UNK | `unknown_reasons` enum | Small reason list (missing source, partial source, unreconciled, missing FX, missing attribution, definition unavailable, not yet resolved, denominator zero/missing). | Finance | Complete and align the reason vocabulary. |
| Q-CSV | `serialization_policy` | `csv_formula_safety` is required; the algorithm is named, not defined. JCS canonicalization (RFC 8785) for JSON bytes. | cost-intelligence (CI-08X), security reviewer | Define exact neutralization (leading `= + - @ tab CR`) and CSV dialect. Confirm JCS. |
| Q-FILE | `files.json`, `files.csv` | At least one format; media type fixed per format; byte size, sha256, row count. | cost-intelligence | Is a manifest self-hash or detached signature needed? Where is it stored? |
| Q-REF | `object_ref`, `provenance`, `drilldown_refs` | Store id plus relative key; no URLs. | cost-intelligence, platform | Which object stores exist and how are access checks done? |
| Q-ASSUME | `observed_facts`, `assumptions` | Separate arrays. Facts point at provenance ids; each assumption carries a code and a policy ref. No free text. | Finance | Is a policy ref mandatory for every assumption? |
| Q-SUMMARY | whole packet | Separate versioned contracts, not an extension of `FinancialSummary`. | shared-contracts maintainer, Finance | Separate contracts, or additive `FinancialSummary` fields? |
| Q-LATENT | manifest | No wall-clock `generated_at` (keeps it deterministic). | cost-intelligence | Is a creation time needed outside the hashed bytes? |

## Requirement to schema path to obligation to verification

Paths are JSON pointers into the named schema (Q = query, M = manifest). "Host" means the verifier an authenticated owner supplies; the schema cannot do it.

| Requirement | Schema paths | Semantic obligation (not enforced by schema) | Verification |
| --- | --- | --- | --- |
| Trusted tenant/project, independent expectations | Q `/properties/expected_scope`; M `/properties/scope` | Scope comes from authenticated context; expectation must match it. Manifest scope must equal the query scope and snapshot scope. | Host auth check; cross-field equality test |
| Period UTC/timezone/policy | Q `/properties/period`; M `/properties/period` | `start_utc < end_utc`; timezone exists in the pinned tz database; policy ref resolves; manifest period identical to query period. | Host timezone/date validator; equality test |
| Single currency, no silent mixing | Q `/properties/currency`, `/properties/fx_conversion`; M `/properties/currency` | Currency is a registered code; every amount in the manifest is in that currency; no conversion occurred. | Host currency registry check; ledger-side check |
| Environment/billing-mode selection | Q and M `/properties/environments`, `/properties/billing_modes` | Values belong to the owner vocabulary; manifest sets equal query sets; simulated commerce excluded from actual sales. | Host vocabulary check; Finance fixtures |
| Policy and definition immutability | Q `/properties/policy_refs`, `/properties/metrics`; M `/properties/policy_refs`, `/properties/totals/items/properties/definition_ref` | Each ref resolves to an immutable artifact whose bytes hash to `content_hash`; manifest refs equal query refs. | Host artifact resolver; hash check |
| As-of, snapshot id, fingerprint | Q `/properties/snapshot`; M `/properties/snapshot` | Fingerprint recomputes from the snapshot; manifest snapshot equals the one the query resolved to; as-of is not in the future. | Host snapshot service; equality test |
| Source coverage and watermarks, known vs unknown | Q `/properties/sources`; M `/properties/source_watermarks`, `/properties/totals/items/properties/coverage` | Source ids exist; watermarks are authentic and monotonic; manifest watermarks equal the snapshot's; `coverage.missing_source_ids` agree with `unknown` watermarks/amounts. | Source authenticity verifier; cross-field test |
| Bounded filters/group-by, page limit | Q `/properties/filters`, `/properties/group_by`, `/properties/time_bucket`, `/properties/page` | Filter values exist and are within scope; group-by has no duplicate semantics with filters. | Host query validator |
| Cursor bound to snapshot | Q `/properties/page/properties/cursor`, root `allOf` | `bound_snapshot_id` equals `snapshot.snapshot_id`; `query_hash` equals the hash of the query without the cursor; token is tamper-evident. | Host cursor verifier. Only "cursor requires pinned mode" is structural. |
| Immutable export id, query ref, snapshot ref | M `/properties/export_id`, `/properties/query_ref`, `/properties/snapshot` | `query_hash` equals the canonical hash of the stored query; export id is not reused for different bytes. | Host store; hash check |
| JSON/CSV file hash, size, media | M `/properties/files` | `byte_size` and `content_hash` match the stored bytes; `row_count` matches rows. | Host byte verifier |
| Safe object refs, no expiring URLs | M `/$defs/object_ref`, `/properties/provenance`, `/properties/drilldown_refs` | Keys resolve inside the named store, in the scope's tenant; drilldown snapshot id equals the manifest snapshot id. | Host resolver and access check |
| Exact amounts, null for unknown | M `/$defs/decimal`, `/$defs/known_decimal`, `/properties/totals` | Decimal scale and currency are consistent; a total equals the exact sum of detail rows before rounding; unknown never replaces zero or vice versa. | Host decimal arithmetic verifier (no JS Number) |
| Metrics with definition refs | M `/properties/totals/items` | Metric values follow the referenced Finance definition; this packet does not compute them. | Finance fixtures and independent oracle (CI-06) |
| Unknown/partial counts, missing sources | M `/properties/totals/items/properties/coverage` | Counts add up to the underlying record count; `completeness` agrees with counts and amount state. | Cross-field test |
| Missing cash unknown, explicit zero distinct | M `/$defs/known_decimal` | Cash is `unknown` unless reconciled opening balance and movements exist. | Finance fixtures |
| Zero/missing denominator null with reason | M `/properties/ratios`, Q `/properties/denominator` | Zero denominator gives `unknown` with `denominator_zero`; missing gives `denominator_missing`. | Cross-field test against the numbers |
| Unallocated bucket explicit | Q `/properties/include_unallocated_bucket`; M `/properties/totals/items/properties/unallocated_amount` | Unmatched spend appears in the bucket; allocated plus unallocated equals source expense; allocation never increases project expense. | Finance allocation oracle |
| Assumptions separate from observed facts, provenance | M `/properties/assumptions`, `/properties/observed_facts`, `/properties/provenance` | Facts reference real provenance entries; assumptions are never counted as observed. | Host reference check |
| Serialization: CSV formula safety, deterministic bytes | M `/properties/serialization_policy` | The exporter actually neutralizes leading formula characters in every text cell and emits JCS bytes. | Exporter test with injection fixtures |
| Presentation rounding separate from exact values | M `/properties/precision`, `/properties/presentation_rounding` | Exported values are unrounded; any display rounding happens in the consumer. | Consumer test |
| No secrets, prompts or addresses | Whole packet | The schema has no free-text fields except bounded ids/tokens, but ids can still contain anything matching the pattern. | Host redaction scan |

## Schema limitations (what Ajv cannot check)

- Source authenticity, hash correctness and tamper evidence. A well-formed `sha256:` string proves nothing.
- Cross-field and cross-document equality: manifest vs query for scope, period, currency, modes, policy refs; `bound_snapshot_id` vs `snapshot_id`; drilldown snapshot vs manifest snapshot; cursor `query_hash`.
- `start_utc < end_utc`, valid calendar dates and leap seconds, and that `as_of_utc` does not precede the period or lie in the future.
- Timezone membership and currency registry membership (patterns only).
- Decimal scale vs `max_fraction_digits`, decimal sums, zero denominators, and the relation between ratio numbers and totals.
- Uniqueness inside arrays of objects (`metrics[].metric_key`, `totals[].metric_key`, `sources[].source_id`, `provenance[].provenance_id`). `uniqueItems` is used only on scalar arrays.
- `unknown` vs `coverage` consistency, and `known_count + partial_count + unknown_count` totals.
- Reachability, access and tenant ownership of `object_ref`s. The pattern only excludes obvious URLs and `..`/`//`.
- A zero-filled hash is rejected, but any other bogus digest passes.
- `$id`s are proposal URNs. There is no compatibility or migration behaviour for version `0.1.0-proposed`.
- Free-of-secrets: id patterns are permissive within their charset.

## Validation command template

Pin Ajv 8.17.1 in a separate provisioned directory (not this repo); a later worker supplies fixtures. Run offline from that worker's checkout. The schemas use no `format` keyword, so `ajv-formats` is not needed, and strict mode must compile them:

```sh
AJV_DIR=/path/to/provisioned/ajv-8.17.1 \
SCHEMA=proposals/reporting-v1/reporting-query.schema.json \
DATA=/path/to/fixture.json \
node -e '
const { createRequire } = require("node:module");
const fs = require("node:fs");
const Ajv = createRequire(process.env.AJV_DIR + "/")("ajv/dist/2020");
const ajv = new Ajv({ strict: true, allErrors: true });
const validate = ajv.compile(JSON.parse(fs.readFileSync(process.env.SCHEMA, "utf8")));
const ok = validate(JSON.parse(fs.readFileSync(process.env.DATA, "utf8")));
if (!ok) console.error(JSON.stringify(validate.errors, null, 2));
process.exit(ok ? 0 : 1);
'
```

Record the Ajv version (`require(AJV_DIR + "/node_modules/ajv/package.json").version`), Node version, schema git SHA, fixture hashes and exit codes. Exit 0 means structural validity only, never semantic acceptance.

## Verification performed on this packet

- Both files parse as JSON and every `$ref` is a local `#/$defs/...` that resolves.
- Both compile under Ajv 8.17.1 `ajv/dist/2020` with `strict: true`.
- Throwaway inline checks (not committed, not fixtures) confirmed one structurally valid instance of each schema and rejection of: extra property, zero-filled hash, multi-currency, over-limit page, non-UTC time, negative zero, numeric amount, unknown amount with a value, URL object key, empty file set, wrong media type, and a cursor with `resolve_at_as_of`.
