# Legacy canonical version election

`validateCanonical` and the twelve `Shared*` aliases elect shared-contract schema version `1.0.0`: UsageEvent, BudgetReservation, ReserveRequest, ReserveResult, SettleRequest, SettleResult, ReleaseRequest, ReleaseResult, QueryRequest, QueryResult, FinancialSummary and ErrorEnvelope. `LEGACY_CANONICAL_VERSIONS` records that immutable election. An SDK adding versions cannot widen these aliases or change a foreign version from `UNSUPPORTED_VERSION` to `VALIDATION_ERROR`.

The wrapper uses the installed SDK's existing `validateContract` and `canonicalJson` capabilities. Invalid JSON values and missing or nonstring versions retain the original validation error. A well-formed JSON object with a foreign string version receives the original unsupported-version envelope. Payloads are neither converted nor relabeled; success preserves the SDK's original value. Other SDK contract names retain their existing dispatch. The public SDK remains pinned to proposal `0.3.0`; its absent `validateContractVersion` is not imported.

Finance's separate native version 2 reporting and budget boundaries remain independently elected. This legacy wrapper does not validate those payloads or replace economic, authorization, relationship or semantic checks. Offline checks with an authenticated private SDK are compatibility evidence, not SDK adoption or host authority.

Run `npm run build --silent && node --test tests/contracts/canonical-compatibility.test.mjs` for the unchanged 100 structural fixture cases, twelve legacy elections, JSON/error precedence and public declaration checks. Parse, relationship and semantic fixture modes are outside this structural wrapper test. Existing contracts and smoke suites remain separate checks.
