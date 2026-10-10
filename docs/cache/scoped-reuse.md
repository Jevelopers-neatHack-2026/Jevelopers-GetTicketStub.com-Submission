# Scoped reuse cache

`src/cache/reuse/store.mjs` is a bounded local persistence component for private research profiles, carefully reviewed public fact projections, freshness observations, operation admission, and invalidation delivery records. It is a cache and coordination primitive. Its implementation and tests are one narrow artifact contribution to EI-11; they do not establish full EI-11 or P0 acceptance.

## Scope and authorization

The host creates a scope with `scopeForAuthenticatedRequest(request)`. Tenant and actor identities come only from injected trusted resolvers. Every read and write also calls the host's `authorizeAction` adapter for the exact action. The returned scope is a process-local opaque capability. Public fact reads still require an authenticated tenant and an authorized actor.

Private profiles are tenant-partitioned and fail closed when their permission references cannot be checked. Public reuse requires the genuine `PrivacyBoundary` instance and its opaque tenant scope and published derivative, followed by `authorizePublicPublication`, an authenticated host policy adapter. No caller-supplied `public`, `approved`, or rights boolean can authorize publication. The public payload contains only `event_name`, `event_date`, and `venue`; its cache-issued profile reference is opaque. Source record IDs, evidence handles, correction references, permissions, original usage and attempt identifiers, and finance lineage remain in encrypted tenant-private records. Privacy review does not establish source officialness, asset rights, or a creative-use permission. Public facts are returned with `trust: 'untrusted_external'` and `rights: 'not_asserted'`.

The private cache key binds occurrence, entity, edition, content hash, schema version, extractor version, question-set version, policy hash, and model version. A lookup for another content or pin version reports stale and does not return the old facts. Writing a new version invalidates the previous eligible version in the same transaction.

## Storage and freshness

SQLite rows hold keyed partition and identity digests plus authenticated-encrypted payloads. The key provider, source-observation verifier, permission verifier, publication policy, retention manager, lineage adapters, and invalidation consumer adapters are injected host services. The database directory must be a trusted application-owned parent. The component applies directory mode `0700`, database mode `0600`, rejects a symlink at the database directory/file boundary, and encrypts payloads using AES-GCM. These checks are for private local application storage and do not claim protection against a same-user host attacker.

Retention expiry is fixed when a profile version is stored; later validation or policy decisions cannot extend that stored expiry. A conditional not-modified observation advances `validatedAt` while preserving original `retrievedAt` and content hash. A newly retrieved body has a separate retrieval time. Removed evidence, evidence loss, permission revocation/expiry, material body changes, and policy-version replacement make the old entry ineligible and enqueue invalidation in the same SQLite transaction. Outages never create a new retrieval time. Clock rollback and unavailable trusted policy or keys fail closed. Expiry reads persist tombstone cleanup before returning unavailable.

The default limits include a 128 KiB encrypted payload cap per item, 2,000 entries, 5,000 flights, 5,000 private lineage links, 128 observations per entry, 10,000 outbox entries, eight delivery attempts per event, 30-day maximum retention, and 512 MiB total encrypted payload storage. The item cap can be configured from 2 KiB upward, preserving room for a bounded encrypted invalidation record. Before admitting an eligible profile or adding a consumer reference, the store reserves one 2 KiB record per possible future invalidation and checks both outbox count and aggregate payload headroom. Hosts can lower other positive-integer limits or raise defaults deliberately. Count and byte caps also bound flight, consumer-reference, private-link, observation, and outbox payloads. Reaching a cap fails closed; this component does not silently discard unresolved invalidations or uncertain operation state.

## Attempts, finance, and consumers

Admission uses SQLite `BEGIN IMMEDIATE` transactions for same-scope single-flight. Separate intentional fresh admissions receive distinct references. Expired active leases become `unknown` and require a trusted reconciliation attestation; the store does not automatically redispatch, release a hold, charge, allocate, or claim usage. A refresh has no provider transport implementation and returns `providerTransport: 'not_implemented'`. Unknown original operation lineage remains unknown. `withPrivateLineage` passes tenant-private references only to an authorized host callback and returns bounded linkage counts with `allocationAuthority: 'finance_external'`; Finance remains authoritative for expense and allocation evidence.

Invalidation events contain an exact entry reference, content hash, profile version, event ID, reason, consumer reference, and a persisted delivery-attempt ID. Dispatch claims each retry with a SQLite compare-and-set and acknowledgement updates must match its persisted attempt ID. Public consumer references must come from the host resolver marked `publicSafeOnly`. An injected delivery callback is only an adapter; an independently injected host verifier must authenticate an acknowledgement against the expected event and attempt before the row can become delivered. Dispatch accepts an optional abort signal; cancellation after delivery leaves the attempt unresolved for bounded retry or reconciliation. Missing, malformed, late, or wrong acknowledgements remain unresolved. A zero-pending snapshot reports `external_consumer_unverified`, never canonical consumer readiness. The cache does not deliver a creative handoff or issue artwork approval.

## Local verification

Run on Node `22.23.3` with the repository lockfile:

```sh
node --test tests/cache/reuse/*.test.mjs
npm run typecheck
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --types node --skipLibCheck false tests/cache/reuse/types-consumer.mts
```

The focused tests use synthetic callbacks and local temporary SQLite databases. They do not prove actual provider metering or Finance allocation, externally authenticated production permissions, canonical creative-consumer delivery, whole-issue closure, or release acceptance. Those remain separate EI-11 obligations.
