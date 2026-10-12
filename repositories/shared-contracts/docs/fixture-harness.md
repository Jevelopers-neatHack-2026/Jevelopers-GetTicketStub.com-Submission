# Canonical fixture harness

Every required name/version is indexed in the [schema manifest](../generated/schema-manifest.json) and [fixture manifest](../generated/fixture-manifest.json). The latter binds fixture file bytes and lists each case's stable ID, version, category, mode, policy version and expected code/path. A missing schema, export, fixture, category, expectation or policy fails; duplicate case IDs and false acceptance fail. The supplemental ProductionApproval example is labelled separately and is not an additional wire export.

Each wire candidate has a positive minimal root encoding, a full root encoding including optional fields, missing-required, wrong-type, unknown-enum, malformed-JSON, unsupported-version, unknown-field, unknown-critical, additive-field and retained-encoding cases. Closed-field policy rejects additive fields on an unchanged exact version. Retained encoding uses the same supported candidate 1.0.0; previous_accepted_major is null. It does not claim a historical accepted release. Multiple exact versions compile together, and generated ContractMap/ContractVersionMap unions preserve all supported versions rather than silently selecting the latest.

Cross-record cases use independently defined fixture contexts: tenant/project/artifact identities; stale/forged/revoked approvals; exact bytes and manifest hashes; duplicate observations versus separately billed attempts; complete or unknown reported usage independently of execution outcome; held uncertain reservations; stale/out-of-order jobs, correction/invalidation and supplier observations; partial decision batches and conditional review reasons. These contexts come from fixture definitions, never from the submitted payload. The approval outcome also checks request scope, audience, exact binding and current approval relationship through the request helper, with an independent request-reference map.

Run all cases or one individually indexed export:

```sh
npm run contracts:check
npm run contracts:fixtures
npm run contracts:fixtures -- --contract ApprovalVerificationOutcome
npm run contracts:compat
npm run contracts:coverage -- --human
npm run contracts:coverage
npm run contracts:coverage -- --output /absolute/private/coverage.json
```

The coverage commands output contribution evidence, not release approval. They preserve all 126 authoritative local criterion IDs/requirements from [the acceptance criteria map](acceptance-criteria.json), record each criterion's issue/artifacts/case contribution, and separate pending independent review, owner/integration acceptance, aggregate release/epic gates and unresolved FC findings. They also record actual per-case results and canonical roundtrip hashes, exact component revision and dirty state, Node/package version, fixture/package digests, modes and unchanged global IDs. The human view reports the same evidence compactly. No raw payloads, prompts, private source/customer data, locators, credentials or local absolute paths are emitted.

Use the actual installed package helper in a trusted adapter:

```js
import { readFile } from 'node:fs/promises';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';
const fixture = JSON.parse(await readFile(
  new URL('../fixtures/ProjectRequest.json', import.meta.resolve('@jevelopers/shared-contracts')), 'utf8'
));
const result = runCanonicalFixtures('ProjectRequest', fixture);
if (result.failures.length) throw new Error('Canonical fixture adapter failed');
```

For a root import resolved to generated/index.mjs, use `new URL('../', import.meta.resolve('@jevelopers/shared-contracts'))` to obtain the package root, then `new URL('fixtures/ProjectRequest.json', packageRoot)`. [The installed driver](../examples/fixture-consumer.mjs) shows the full working sequence. The preceding compact URL points to generated/../fixtures and is equivalent.

`runCanonicalFixtures` invokes actual generated validators and pure semantic helper bindings, canonicalizes each successful wire result, reparses it and compares bytes/hash. It does not mutate the fixture. `assertFixture` requires an explicit false result with the asserted typed code/path for negatives; every export's tests deliberately substitute a false-positive validator result and require the assertion to throw. Installed drivers repeat that check.

Field classification traverses properties, patterns, map values, definitions, every combinator branch, conditionals, negation, contains, tuple/prefix items, dependent schemas, property-name/unevaluated schemas and local/external references. Cycles terminate and unresolved references fail. Public evidence remains a closed allowlist; privacy regressions inject synthetic restricted fields into both top-level and nested evidence and assert rejection/projection exclusion.

`npm test` includes strict generated-type parity and real compiler rejection of brand mixing, unsupported versions and deep readonly mutations. `npm run test:installed` packs twice and compares archive bytes, installs offline without dev dependencies, runs five actual ESM drivers and checks the installed export-map types using the locked compiler. Generation checks all declared outputs, including dependency notices and package contents; unindexed generated files fail.

Local passing fixtures do not demonstrate authentication/revocation infrastructure, budget atomicity, ledger posting, durable recovery, image/preflight execution or supplier submission. [FC-001..004](../compatibility/owner-findings.json) are unresolved producer correctness counterexamples despite current characterized fixtures passing. Their economic protocol repair and owner re-review remain a separate supervisor task. The real nine-consumer gate stays blocked until reviewed exact-revision adapters and acceptance records exist.
