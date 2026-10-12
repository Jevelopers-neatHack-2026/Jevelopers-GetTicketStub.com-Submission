# Reporting proposal test environment

This private, CI-only package provisions **Ajv 8.17.1 and its four locked
transitive dependencies** for the existing `proposals/reporting-v1` runner.
It is not a canonical SDK, package release, Finance implementation, or consumer
adoption record. No root package, schema, or committed fixture is changed.

The five dependency entries (versions, URLs, SRI hashes and dependency edges)
are retained from the existing repository lock at
[`d432ad5c895a67155affeaa05cd8423c758d95c3`](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/d432ad5c895a67155affeaa05cd8423c758d95c3/package-lock.json),
blob `9e7069f967f7f030e5b7ebdc6967b4b0982d1ff5`. The root identity is deliberately
CI-only; this does not install or repin that SDK candidate. The installed set is
ajv 8.17.1, fast-deep-equal 3.1.3, fast-uri 3.1.8,
json-schema-traverse 1.0.0 and require-from-string 2.0.2.

The read-only `Reporting proposal` workflow copies this manifest/lock to runner
scratch and runs `npm ci --ignore-scripts --include=dev --no-audit --no-fund`.
That **preparatory provisioning step uses the package registry**. Validation
then uses only the provisioned dependencies and local schemas/fixtures, with
npm offline mode enabled. This is not an operating-system network-denial claim.
No package lifecycle scripts, provider requests, publication or checkout write
credentials are used. Artifacts record the actual checkout/tree, runtime/npm
versions, source hashes, provisioning output, fixture results and TAP results,
including failures. Both Node 22.23.3 and 24.21.0 are tested.

For a local run, copy these two JSON files to a fresh temporary directory,
provision there, and point `SC_AJV_ROOT` to its `node_modules` directory:

```sh
export SC_AJV_ROOT=/absolute/path/to/provisioned/node_modules
node proposals/reporting-v1/validate.mjs
node --test --test-reporter=tap tests/reporting-proposal.test.mjs \
  tests/reporting-error-location.test.mjs \
  tests/reporting-error-location-integration.test.mjs
```

Missing pinned Ajv fails the integration tests; it is never skipped or replaced
with validator doubles. The dependency-free location tests separately isolate
runner behavior using explicitly synthetic doubles.

## Error-location assertions

A negative fixture's `error_at` is a JSON Pointer selecting the error location
or a containing subtree. Only the **exact location or a slash-delimited
descendant** matches: `/rows/1` includes `/rows/1/value`, but not `/rows/10`;
`/currency` does not include `/currency_extra`. Escaped pointer segments retain
their encoded identities. The empty pointer selects the whole document; `/`
selects the empty-name property, not every root property. A required keyword
must match the same error as the location. Summary truncation does not truncate
the list used for matching.

The real integration regressions shorten the committed currency-negative
expectation to `/currenc`: the fixture must fail with `error_location_mismatch`
in-process and CLI exit 1. The unchanged 199-case corpus remains a separate
positive control. All results are structural/synthetic evidence only, never
FinancialSummary acceptance, authenticated authority, or consumer adoption.
