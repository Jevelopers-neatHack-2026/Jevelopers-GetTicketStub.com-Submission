# TD-01B: shared-contracts 0.9.7 consumer slice

Refs issue #5. This is a private, offline, development-stage compatibility slice. It is not adoption, not integrated acceptance and does not close any TD-01B acceptance ID.

**No named owner acknowledgement exists.** No shared-contracts, Finance, or team-dashboard owner or reviewer has reviewed or accepted this work. A model review is not an acknowledgement, and the producer's own review labels do not substitute for one. The acknowledgement field of the driver receipt is `null`.

## Pins

Recorded in `contracts/shared-contracts.pin.json`. The archive and the vendored package are never committed.

| Pin | Value |
| --- | --- |
| Package | `@jevelopers/shared-contracts@0.9.7` |
| Producer head | `d432ad5c895a67155affeaa05cd8423c758d95c3` |
| Producer tree | `c9a0f7707e603f76628bdd5f256808c2af3ba80b` |
| Archive sha256 | `771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43` |
| Archive SRI | `sha512-P462b8thg20g5RknBzdDL5mfxpXF+kpodLPCGrTe3kmKXrw9YZ21x3E/PuGEp0aEOGoiBZlq5JB4Pktq+2lBPg==` |
| Fixture digest | `sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab` |
| Content digest | `sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1` |

Contract versions used: every one is `1.0.0`. The 11 consumer roles (CommonEnvelope, EvidenceProjection, ErrorEnvelope, PartialFailure, JobStatus, JobProgress, Cancellation, JobCommandAcknowledgement, FinancialSummary, FulfillmentStatus, EvaluationEvidence) are exercised through the package's own fixtures. Four have adapter domain cases: FinancialSummary, EvidenceProjection, JobStatus, FulfillmentStatus. The other seven are fixture-only, with no team-dashboard adapter yet.

## Commands

```sh
npm ci                          # repo toolchain: Node 24.21.0 (engines >=24.15.0 <25), npm 11.12.1 (the repo's `packageManager`)
npm run contracts:provision     # clone at pinned head, Node 22.23.3: npm ci, build, pack; verify sha256 + SRI (fail closed); offline install
npm run lint && npm run typecheck && npm test -- --run && npm run build   # unchanged gates; none needs the archive
npm run test:contracts          # driver first (independent package verification), then tsc -p tsconfig.contracts.json and the vitest contracts config
node scripts/run-contract-driver.mjs                                       # verifies the installed package with scripts/package-verify.mjs (no package imports; recomputes hashManifest(files) against the pin, byte-checks every file, rejects any symlink or non-regular entry, any unlisted file, and any path resolving outside the package), then runs the driver and checks its receipt. The driver and contract tests refuse to run if any `node_modules` directory exists in the repo other than the verified root one (it would shadow the package), and import the package only by an absolute file URL proven to lie inside the verified root (`scripts/verified-package.mjs`). Under the producer's runner the driver instead accepts only a resolution inside the snapshot that runner binds (`SHARED_CONTRACTS_ROOT`)
node scripts/producer-consumer-check.mjs <temp copy of producer checkout> .shared-contracts/jevelopers-shared-contracts-0.9.7.tgz
```

`contracts:provision` clones into the gitignored `.shared-contracts/`, needs Node 22.23.3 as the producer toolchain: either first on `PATH` or given as a bin directory in `SHARED_CONTRACTS_NODE_BIN`. The exact version is asserted and it fails clearly otherwise. It runs the clone, producer `npm ci`/build and install with a minimal environment (PATH and TMPDIR only; HOME, the npm cache and empty user/global npmrc files live under `.shared-contracts/home`, `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` are `/dev/null`, so neither `~/.gitconfig` nor `~/.npmrc` applies) and removes any previously installed package before starting and on every failure, and copies the installed package into `node_modules/@jevelopers/`. It does not touch `package.json` or the lockfile, so `npm ci` works for people without the archive. The package is not a declared dependency, so the next `npm ci` removes it; re-run the provision script.

## Results

Tested consumer: commit `81527ccdc21134b53cc63a1c44bcbce5b9bbfbcc`, tree `d509feca562111e7a5c4e15ecb2559610e33be3c`. The commit that adds this document changes documentation only. Base: origin/main `380bba6c75789ac65a7cc6eb6d6d19469a4e5823`.

| Command | Result |
| --- | --- |
| provision | archive sha256 and SRI both equal the pins |
| `npm run lint` | pass, 0 warnings |
| `npm run typecheck` | pass |
| `npm test -- --run` | 5 files, 177 tests passed (same counts as the base) |
| `npm run build` | pass |
| `npm run test:contracts` | driver (with independent package verification) passed; tsc pass; 3 files, 92 tests passed |
| driver on Node 22.23.3 and on 24.21.0 | passed; 11 contracts, 249 package fixture cases, 13 of 13 domain cases |
| producer `consumerChecks` on a temp copy, Node 22.23.3 | team-dashboard row passed; 11 observed contracts; 249 trusted fixture cases; 27 package modules imported and byte-checked; zero team-dashboard failures |

The producer check needs an "accepted" acknowledgement to reach execution. Its runner here (`scripts/producer-consumer-check.mjs`) writes a SYNTHETIC record in a temp directory. It names no reviewer, is labelled synthetic and is never committed. Only that team-dashboard row was exercised; the other eight rows are blocked in the temp copy as expected. This establishes machine consistency and observed fixture execution, not authority or owner review. Playwright suites were not run.

Repo gates ran on Node 24.21.0, not 22.23.3, because `package.json` has `engine-strict` with `node >=24.15.0 <25`. The adapter and driver were also run on 22.23.3.

## What the adapter does

`src/data/shared-contracts-adapter.ts` has no runtime import. The package helpers arrive through an injected `ContractKit`, so the module neither bundles nor requires the archive, and it uses only erasable TypeScript syntax so the driver can run it under Node type stripping.

- Trusted scope: tenant, project, environment and billing mode come from the host's `TrustedScope`. The independent expectation is passed to `checkTrustedContext` and `checkFinancialSummary`. Reference expectations are supplied by the host, not read from the payload.
- Result states: `ready`, `stale` (with age and a stale badge), `missing`, `restricted`, `unknown`, `refused` (with code and path). An absent requested metric is `unavailable`, never zero. A producer-declared unknown metric stays `unknown`. Unknown progress stays `null`.
- Money stays an exact decimal string. No arithmetic, floats or aggregation.
- Valuation, settlement, reconciliation, reservation and completeness are separate axes. Nothing derives ledger, live revenue or authority from `paid`, `live` or `provider_confirmed`. Every result carries `authority: 'read_only_projection'`.
- One read covers one environment and billing partition. A mismatched record, or a summary aggregating several partitions, is refused.
- Tamper handling: the host may pass the canonical digest it obtained out of band; a mismatch is `DIGEST_MISMATCH`. Duplicate members and malformed JSON are refused by the package parser.
- Additive fields: schemas are closed in 0.9.7, so unknown fields are `INVALID_PAYLOAD` and unsupported versions are `UNSUPPORTED_VERSION`. The adapter does not ignore additive fields and does not reinterpret a cached payload of another version.

Mapping to existing UI types: `AmountDisplay` for amounts and `BadgeState` for badges (simulated maps to `fixture`).

## Known unsupported states and findings

Explicitly refused by name (`refuseUnsupported`): Preview1/ArtifactFile2 eligibility (`LEGACY_UNREPRESENTABLE`); CSV input activation, draft-row publication, repair/derived-composition and local UsageEvent pre-ingestion mapping (`UNACCEPTED_INTERFACE`). Every other contract is `UNSUPPORTED_INTERFACE`. BudgetReservation and UsageEvent (TD-01B.A) are not consumed here.

1. Incompatibility, producer `checkFinancialSummary` (0.9.7): it never relates the top-level `environment` and `billing_mode` to `included_environments` and `included_billing_modes`, so a record claiming production/live while listing test/simulated passes. The adapter adds the check. The test `INCOMPATIBILITY (producer 0.9.7)` asserts that the producer accepts it and the adapter refuses; it will fail if the producer later tightens this, which is the cue to revisit.
2. `EvidenceProjection` has no tenant, project or timestamp. Scope cannot be verified from the payload and freshness cannot be assessed. The adapter reports `scopeBinding: 'host_request_only'` and never reports freshness for it.
3. `JobStatus` and `FulfillmentStatus` transition and supplier-identity checks (`checkJobUpdate`, `checkFulfillmentStatus`) need owner-held prior records and mappings the dashboard does not have. Only structural, scope, order, partition and freshness checks are claimed.
4. Fixtures use the same UUID for tenant and project, so the package fixtures cannot detect a tenant/project swap. Local tests therefore use distinct tenant and project ids and assert that swapping them is refused with `SCOPE_MISMATCH`.
5. Not covered: query inputs and cursors (TD-01B.B), cache identity and cancellation (TD-01B.C), transport and typed HTTP errors, fixture-versus-integrated labelling (TD-01B.E), and the CI workflow (it does not run `test:contracts`, since that needs a network clone).

Nothing here is a ledger, Finance, live revenue or authority claim.
