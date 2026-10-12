# PostgreSQL evidence reader (CI-10.2, local ledger slice)

`createPostgresEvidenceReader` reads the typed references already stored in the immutable financial ledger. It adds a durable read adapter to the existing evidence API without changing the canonical vocabulary, legacy injected-store behavior, financial calculations or ledger writes. Refs #11, #8 and #18 are partial implementation links; this slice does not close those issues or an acceptance gate.

The factory is available from both `@jevelopers/cost-intelligence` and `@jevelopers/cost-intelligence/evidence`. It returns `lookupPostingEvidence` and `lookupByOperationalReference`, using the existing 1.0.0 requests and results. Construction is synchronous and opens no connection. Each invocation acquires its own transaction; callers cannot obtain or reuse the internal `EvidenceLinkStorePort`.

## Host composition

Use the restricted `ci_finance_runtime` pool, a current Finance authority and the host clock. The database port deliberately requires separate `release()` and `discard()` methods. A release-only legacy adapter cannot satisfy this interface: passing an optional flag to an old `release()` function would not guarantee eviction.

```ts
import { createPostgresEvidenceReader } from '@jevelopers/cost-intelligence/evidence';
import type { PostgresEvidenceDatabasePort } from '@jevelopers/cost-intelligence/evidence';

// The host configures this pool with finite connection/query transport timeouts.
// For node-postgres, discard MUST forward to PoolClient.release(true).
const database: PostgresEvidenceDatabasePort = {
  async connect() {
    const client = await restrictedPool.connect();
    return {
      query: (text, values) => client.query(text, values ? [...values] : undefined),
      release: () => client.release(),
      discard: () => client.release(true),
    };
  },
};

const evidence = createPostgresEvidenceReader({
  database,
  clock: { now: () => new Date() },
  financeAuthority: currentFinanceAuthority,
});
const result = await evidence.lookupPostingEvidence(validatedPostingRequest);
```

The host obtains the scope and current actor through its trusted application boundary. A caller-supplied scope is not an authorization decision. The reader uses the existing `ledger.readSnapshot` operation and grant, captures the authority method once for a lookup, and detaches each full raw authority response before shared validation. Every renewal must retain the same principal kind, actor and membership/service-grant revision. Changed, denied, expired or unavailable authority suppresses the result; a new request may be made under a newly authorized revision.

Database role checks refuse superuser, BYPASSRLS, owner/migrator membership and other privileged runtime roles. The host remains responsible for finite driver acquisition/query transport timeouts and for implementing physical connection discard. This library does not provision credentials or establish a real authority issuer connection.

## Stored scope and supported references

Every SQL predicate binds tenant, project, environment and billing mode, and every returned record is checked again against those four values. An absent posting and a posting in another partition return the same `not_found` outcome. A quarantined partition returns unavailable even for an absent identifier. Reverse results contain at most 50 matches, selected in deterministic event-id order; a 51st row produces the existing `result_limit_reached` gap.

| Lookup key | Existing source | Namespace behavior |
| --- | --- | --- |
| Posting/event ID | Ledger event primary key | Existing posting request |
| Logical operation, source observation, reservation, correlation | Explicit ledger columns | `cost-intelligence` |
| Transport, provider and billable attempt | Existing identity ID plus `known` status | `cost-intelligence` |
| Provider request | Existing request ID plus `known` status and provider dimension | Explicit `provider:<lowercase-name>` |
| Workflow and job | Exact stored dimension member | `cost-intelligence` |

Posting-to-observation links include only actual `usage_observation` rows in the same ledger operation. Intake inbox rows are not fabricated into financial ledger observations. Valid `neatlogs` or `entire` correlation/workflow/job references have no accepted native index in this slice: after authorization, they return unavailable before database acquisition. Other unsupported reference kinds retain the existing validation/source-gap behavior.

SQL selects only explicit scalar identity fields and the required dimension/pricing members. It never selects an amount, event payload or an entire source/dimension/pricing object. JSON type flags prevent a persisted number or Boolean from being coerced into an apparently valid string reference. Rate-card revision 0 is supported; a string, fraction or unsafe integer is refused rather than rounded. The existing public allowlist handles unsafe reference strings as broken links or malformed-source gaps. Wrong stored JSON types fail the complete lookup.

Every result retains `billingAuthority: false`. Provider request correlation is not a paid invoice, accepted usage or permission to settle a hold. Missing reconciliation, adjustment and export lineage remain explicit gaps; empty reverse results do not prove zero usage.

## Transaction and privacy observation

Each lookup begins a read-only READ COMMITTED transaction and binds the existing financial database scope. It holds ACCESS SHARE locks on the ledger and privacy-quarantine tables before inspecting their policy capability, then acquires the existing `ci02-ledger:<tenant>:<project>:<environment>:<billing>` advisory transaction gate. The same transaction performs health checks, privacy checks, the posting read and any related reads.

Current authorization is renewed around awaited query boundaries, including failed or malformed responses. Query rows are bounded and detached before later authority calls. Any observed read, health or quarantine fault poisons the entire lookup. In particular, a related-observation failure cannot return a posting retained from an earlier successful read, even though an independently injected legacy store can represent unavailable related evidence as a completeness gap.

The final sequence is: detach the successful projection, renew current authorization, make a fresh READ COMMITTED privacy query while the gates remain held, then COMMIT. Synchronous trusted-time checks keep the captured grant unexpired and recently verified before and after the final query and COMMIT; invalid or backward clock readings refuse. Raw authority snapshots retain malformed own keys so validation cannot be bypassed through copying. No external authority/source await occurs after COMMIT releases the partition gate. The database observation boundary is that successful COMMIT; the reader does not promise that later JavaScript/HTTP disclosure atomically shares a host grant epoch.

The existing controlled audit protocol participates in the partition gate. Privileged direct quarantine writers must also participate to obtain the same exclusion; the stronger all-writer insert fence remains the active settlement lane's prerequisite. This migration does not copy or claim that unmerged guard. ACCESS SHARE excludes policy DDL while the relied-on tables are held; it does not attest every concurrent core-function, role, trigger or index change.

## Health, indexes and cleanup

Migration `0014_evidence_reader_indexes.sql` adds eight lookup indexes and a dedicated evidence-reader capability/health view. It preserves earlier migration checksums, foundation health and runtime write permissions. It can be applied without the separate coverage migration0013 and is designed to compose with it normally.

At installation, parser-equivalent probes require the reviewed ledger/quarantine policy expressions, commands and role sets; a pre-existing false or extra policy is rejected. The installed descriptor includes the complete policy sets (including PUBLIC), table owners and forced RLS, required append-only/truncate guards, and the exact required index definitions and validity. Later descriptor drift refuses reads. Existing core scope/mutation functions and the controlled-audit protocol remain separately reviewed prerequisites; this feature does not attest their function bodies or authorize privileged catalog changes.

The cooperative operation deadline is 15 seconds; it is not a hard wall-clock return bound. Individual current-authority waits are capped at 2 seconds, and acquisition is capped at 5 seconds. A late-acquired idle connection is released exactly once and receives no BEGIN. Server settings bound lock waits to 2 seconds, statements to 5 seconds and idle transactions to 5 seconds. A timed-out callback cannot resume a later insert or COMMIT; this reader issues no insert at all.

Active SQL promises are not raced and their connections are not released early. Finite host driver transport timeouts remain necessary: a query or rollback Promise that never settles is not bounded solely by local monotonic checks. Any query/COMMIT fault or failed rollback selects `discard()`. Clean completion, or a refusal without a query fault followed by successful rollback, selects `release()`. A COMMIT transport error returns unavailable and evicts the connection. Because the operation is read-only, retry starts a fresh authorized lookup and makes no financial duplicate.

## Validation and remaining qualification

The SQL-transport model covers request/authority aliasing, malformed authority responses, principal revision continuity, final-query/commit expiry, stale or invalid clocks, retained-posting suppression, explicit JSON types and exact revision parsing, bounded results, unsupported namespaces, timeout continuations and physical-discard selection. It is synthetic scheduling evidence, not proof of PostgreSQL isolation, RLS or durability. The PostgreSQL suite separately drives grant expiry across actual final privacy queries and COMMIT using a synthetic trusted clock.

The real PostgreSQL suite uses the existing disposable-database lifecycle and synthetic ledger appends. It checks actual projections/RLS, new-pool recovery, controlled-audit exclusion, policy DDL exclusion, poisoned-read cleanup and physical connection eviction, index/policy drift, migration preflight and unchanged earlier checksums. Database execution is a separate required outcome; authored tests or model passes do not qualify it.

The migration catalog and SQL safety policy also run before database startup. The generic destructive-SQL scanner remains unchanged. Only migration 0014's exact reviewed whole-file hash and two exact temporary-policy cleanup literals receive a narrow scan exception; changed bytes, filenames or additional destructive statements retain conservative refusal. These static checks do not execute the migration.

```sh
npm run typecheck
npm run build --silent
node scripts/run-suite.mjs traceability --offline --suite=migration-policy
npm run test:evidence
npm run test:evidence:postgres -- --offline
npm run test:migrations -- --offline
npm run test:exports
npm run test:traceability
```

The dedicated PostgreSQL step is mandatory in hosted CI and its test file is required by integration/release plans. Missing PostgreSQL or skipped required cases are not passes. Other absent domain leaves and acceptance criteria stay open. Actual current-candidate PostgreSQL results, independent review and accountable host/consumer acceptance are still required before claiming the corresponding CI-10 outcome.
