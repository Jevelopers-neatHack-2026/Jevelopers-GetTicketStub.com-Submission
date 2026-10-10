# shared-contracts

Public schemas, validation and compatibility fixtures.

## Implementation status

Candidate package 0.2.0 provides the two foundation contracts and all 20 operations wire exports for #9-14, an injected DecisionPort, derived ESM validators/declarations, pure context/semantic helpers and offline fixtures. Domain schemas #15-28, named owner agreement and accepted consumer integrations remain pending. This package is private and unreleased; no license or publication decision is implied.

Use Node 22.23.3 (see .node-version), npm and the exact package-lock.json. After provisioning the cache once, every check runs offline:

```sh
export npm_config_offline=true npm_config_audit=false npm_config_fund=false
npm ci --ignore-scripts
npm run build
npm test
npm run contracts:check -- --contract CommonEnvelope
npm run contracts:fixtures -- --contract CommonEnvelope
npm run contracts:check -- --contract EvidenceProjection
npm run contracts:fixtures -- --contract EvidenceProjection
npm run contracts:compat -- --foundation
npm run generate -- --check
npm run docs:check
npm run test:installed
npm pack --dry-run
```

The full-catalog commands `contracts:check`, `contracts:fixtures` and `contracts:compat` fail for each missing domain leaf. `--foundation` is an explicit local scope for the two candidates, not release evidence. `contracts:inventory` supports --require-owner, --require-consumer, --require-leaf, --require-version-policy, --require-field-classification, --policy-only, --require-fixtures, --require-docs and --require-consumer-pins. Owner checks require named reviewer/owner acknowledgements; consumer pin checks require accepted exact revisions and passing evidence. --policy-only checks field-classification policy without silently claiming domain completeness. Missing artifacts are failures, not skipped tests. Unknown commands, duplicate/unknown flags and missing flag values fail.

`--implemented` selects all 22 current candidates without claiming full release coverage. Use it for contracts:check, contracts:fixtures, contracts:compat and scoped inventory checks. The [operations guide](docs/operations-contracts.md) links schemas/fixtures, exact decimal and uncertainty rules, server-supplied contexts, independent reporting/outcome semantics, and explicit Score profile adapters. The [operations consumer](examples/operations-consumer.mjs) runs from the installed local archive with zero provider calls. Structural scoped types now support other contract discriminators; OperationCode/OperationResult describe semantic rejections without expanding the foundation ValidationCode union. Package 0.2.0 records these additions while foundation schema bytes stay pinned.

`contracts:compat -- --before old-schema.json --after new-schema.json` classifies a local schema change conservatively. Required additions, removals, type/unit/constraint changes and unsafe enum changes require a breaking-impact review; documentation-only changes pass. [Candidate baselines](compatibility/baselines.json) bind exact schema bytes to detect same-version drift. They are local immutability guards, not owner acceptance or historical consumer versions. [Fixture manifest](generated/fixture-manifest.json) records exact fixture file hashes and the common digest.

For installed Node ESM JavaScript and TypeScript:

```js
import { parseContract, checkTrustedContext } from '@jevelopers/shared-contracts';
const parsed = parseContract('CommonEnvelope', jsonFromCaller);
if (!parsed.ok) return parsed.errors;
// authenticatedExpectations come from your server adapter, outside this package.
const scoped = checkTrustedContext(parsed.value, authenticatedExpectations);
```

TypeScript imports `CommonEnvelope`, `EvidenceProjection`, branded ID/ExactDecimal types and discriminated Result types from the same package. Runtime parsing returns the schema-derived type. [Consumer driver](examples/consumer.mjs) imports real installed schemas/fixtures, exercises success/rejection/projection/hash behavior and is run by test:installed from an offline local archive with no dev dependencies.

Contracts use exact schema_version negotiation. Unknown fields and enums fail; optional means absent unless null is explicitly allowed. JSON parsing rejects duplicate member names. No coercion, defaults, mutation, network lookup or authentication occurs. Errors contain typed code/path and optional schema keyword, with no submitted values; unknown-field failures identify the parent container and omit arbitrary field names. Current and previous accepted majors remain supported during migrations; no previous accepted major has been invented. See [version policy](compatibility/version-policy.json) and [ADR](docs/adr/0001-canonical-schemas.md).

The [catalog](docs/contract-catalog.md) indexes each required export, producer, consumer, authority and owner leaf. [Identity rules](docs/identity-policy.md) separate events, versions, operations and attempts. [Privacy/hash policy](docs/privacy-policy.md) defines the public allowlist and canonical bytes. [Requirements map](docs/requirements.json) preserves issue/global acceptance references. [Consumer handoff manifest](compatibility/consumers.json) records nine discovered source SHAs and role slots with null acceptance fields.

Provision exact consumer checkouts yourself. Set their local paths and reviewed offline driver commands in the manifest, or supply `contracts:consumers -- --paths /absolute/path/to/paths.json`. That JSON maps repository names to local checkout paths. The runner never clones or fetches and requires clean exact-SHA checkouts, shared schema/source pins, fixture digest and acknowledgement. Missing integration keeps the gate blocked. Keep research/creative local proposals until explicit adapters are reviewed: JEV Score shapes and ResearchPackage alias remain unresolved; application approval and finance policy remain external authority.

A consumer driver command is `["node", "relative/path.mjs"]` inside its reviewed checkout. It receives SHARED_CONTRACTS_ROOT and SHARED_CONTRACTS_OFFLINE=1 with a minimal environment. It must use local fixtures and no provider/network calls, and return JSON containing status=passed, consumer_sha, shared_source_revision, fixture_digest and contracts_tested. Package integrity is SHA512 SRI; schema pins contain contract/version/sha256. Its external acknowledgement record must have status=accepted and bind the same consumer/shared revisions and fixture digest. The runner verifies those declared bindings and schema/fixture hashes, not acknowledgement authenticity. The nine discovered SHAs do not satisfy this integration contract.

Migration from creative's local envelope is breaking: producer string becomes module/source/build revisions, string source references become typed opaque references, policy/observation time becomes explicit, local 1.0/1.1 names require exact-semver mappings, and scoped UUID primitives need owner-authorized identity mappings for legacy IDs. Preserve local payloads until those adapters and owner reviews exist; validators never fabricate replacement IDs. The canonical candidate's closed fields differ from creative's proposed additive-field handling. The foundation CI job checks only these candidate behaviors; the separate full release-readiness workflow runs all unfinished release obligations and remains blocked.

To upgrade, review producer/consumer impact, retain old encodings and migration fixtures, pin exact shared and consumer revisions together, and keep the previous pin for rollback. Any failed consumer blocks the upgrade. A release must record source SHA, schema hashes, locked package integrity, fixture digest, commands/results and owner acknowledgements, with notice/replacement and 90 days minimum before removals. generated/schema-manifest.json currently records candidate hashes/toolchain and a null release SHA. npm pack includes generated bindings, runtime, schemas, fixtures, compatibility and docs; it excludes tests/build tooling/dev dependencies. No registry upload, tag or GitHub release occurs.

[Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.
