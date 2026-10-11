# Package and release evidence

Package 0.6.0 is private and unreleased. Schema versions are independent exact semver (1.0.0 retained candidates plus nine 2.0.0 finance proposals); generated/schema-manifest.json maps schema identities/hashes to the package version with source_revision=null until an actual release mapping is accepted. No project license, visibility change, tag, GitHub release or registry publication is implied.

The [package manifest](../package.json) exports the ESM/type root, operations, research-creative, commerce-evidence and fixture-harness subpaths plus exact schema/fixture/compatibility files. It includes generated bindings/standalone validators/manifests/notices, pure runtime helpers, schemas, fixtures, compatibility records, docs, nonvisual examples and README. Build tooling, tests and npm dev dependencies are not distributed. `generated/package-content-manifest.json` hashes this exact content excluding only itself; its digest binds helper code and export-map bytes as well as data schemas. Installed tests verify file bytes and the two generated archives are identical.

```sh
npm run build
npm run generate -- --check
npm run test:installed
npm pack --dry-run --json
```

The distribution archive has a SHA256 digest and actual SHA512 SRI recorded by npm pack. Package source SHA cannot be self-embedded in bytes committed at that SHA; record it externally in immutable release evidence together with archive integrity/content digest. A future authorized release maps tag `v<package_version>`, exact source commit/tree, package version/archive filename/SRI, schema manifest and fixture digest. A tag alone is not acceptance. The [changelog](../CHANGELOG.md) distinguishes candidate additions, request-linkage repair and unresolved owner decisions. The [version policy](../compatibility/version-policy.json) specifies impact review, exact encoding retention, rollback and removal notice.

Dependency provenance is derived from the locked build and esbuild input graph. Only Ajv 8.17.1 runtime/equal and ucs2length helpers and fast-deep-equal 3.1.3 are embedded in the current standalone validator. Their actual upstream MIT notices are preserved verbatim in [third-party notices](../generated/THIRD_PARTY_NOTICES.md), and [provenance](../generated/dependency-provenance.json) records versions, npm lock SRI, embedded source files and notice hashes. Build-only esbuild, json-schema-to-typescript, TypeScript and their transitive lock data remain dev dependencies; no runtime npm dependency is required. Dependency notices are not a license for this project's source.

Review public artifacts under the field privacy policy. Fixtures use synthetic UUIDs/tokens, public source revisions and small synthetic byte arrays. They contain no real prompts/customer source/private URLs/provider credentials. Synthetic bytes demonstrate comparison mechanics and establish no image format validity, print preflight or third-party rights. Real asset rights and private locator access remain domain-owner obligations. Publish only minimized allowlisted evidence, never raw context/payloads or local filesystem locations.

The final evidence record must contain:

- Exact shared source commit/tree and dirty state; package/Node/npm versions and locked dependency mode.
- All schema identities, versions and byte hashes; complete fixture file digest and per-case typed expected/results/policy; canonical bound hashes and generated type parity.
- All local commands with exit codes, full-suite failures/skips, deterministic generation and a clean committed schemas/generated/fixtures diff.
- Actual archive SHA256/SRI, content manifest, export-map/installed Node ESM and TypeScript checks, dependency provenance/notices and privacy/rights review.
- Nine exact consumer revisions, checked-in pin rows, genuine reviewed drivers/observed imports, scope-sensitive results, accepted acknowledgement provenance and migration/rollback/deprecation decisions.
- Per-criterion SC coverage and unchanged global IDs with contribution-only evidence, plus every unresolved owner proposal/finding/real integration limitation.
- Independent exact-candidate review and required GitHub checks/approvals; supervisor-controlled delivery, merge and post-merge verification.

Run every required inventory flag:

```sh
npm run contracts:inventory -- --require-owner --require-consumer --require-leaf --require-version-policy --require-field-classification --require-fixtures --require-docs --require-consumer-pins
npm run contracts:check
npm run contracts:fixtures
npm run contracts:compat
npm run contracts:consumers -- --paths /absolute/private/consumer-paths.json
npm run contracts:coverage
npm run docs:check
```

Owner acceptance, genuine consumer integration and unresolved producer findings keep release gate #3 and epic #1 open. Each leaf needs all its own reviewed merged evidence; local fixture coverage is not global CON/ART/FIN/EVAL/ARC verification. The [requirements map](requirements.json) and master integration-evals tracker preserve those identifiers. Registry publication and tag/release creation require a separate repository-owner release decision.
