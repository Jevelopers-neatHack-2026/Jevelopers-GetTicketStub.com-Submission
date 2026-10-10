# Creative inspection and bounded repair policy

This source package defines deterministic artwork checks, a versioned structured observation format, narrow DecisionPort questions, a review-only report, held-out fixture metrics, and a durable local repair counter. It is a fixture policy (`fixture-policy/1.0`), not an accepted production threshold or a canonical external inspection protocol.

## Evaluation order and evidence

The deterministic gate runs before any visual decision. It snapshots the supplied artifact bytes, verifies the artifact content hash, and currently decodes bounded PNG inputs to check file structure, checksum, dimensions, and scanlines. It validates the trusted brief and design version, immutable parent identity, declared source references, unresolved facts, and the explicitly supplied asset-use set against the brief’s permission records. A failed check is a failure; missing or uncertain evidence requires human review. A favorable visual answer cannot change these checks.

The in-process decoder currently supports PNG only. JPEG and WebP are not passed through an alternate decoder; they receive an unsupported-media result and require human review until the selected shared verified decoder is integrated. This source package does not claim validation of the production image adapter or its supported format set.

Visual observations are separately sourced records bound to tenant, project, brief, brief hash, design version, parent hash, artifact, and artifact hash. They retain observer/model/configuration identity, source reference, uncertainty, structured findings, and usage completeness. The question builder exposes only allowlisted observation codes, source hashes, and validated prior answers. It never sends raster bytes or raw image content to JEV. A report is limited to `acceptable_for_review`, a bounded repair recommendation, human review, refusal, or failure. It cannot approve artwork, establish legal rights, or certify print readiness.

The host supplies the trusted scope and the pre-eligible repair-action intersection. Inspection does not grant asset rights, unlock controls, authorize spending, or dispatch an operation. The repair controller stores a local action identity and cumulative fixture limits; it is not a Finance ledger, budget authority, provider executor, or permission to perform an edit. Unknown repair cost remains unknown and prevents a new bounded claim. Finance quotes, acknowledgements, grants, and actual provider attempts remain separate injected authorities.

## Decision questions

The inspection questions use the existing DecisionPort contract. Two independent questions ask for a Noul probability of a supported defect and a Score over the versioned visual-quality legend. A dependent Choice question is planned separately and receives only the schema-validated first-stage answers. Noul has one probability and does not contain a separate confidence field. Invalid answer keys, unsupported model or schema versions, mismatched Score legends, fabricated confidence, timeout, cancellation, abstention, refusal, or injected instructions cannot add an action or expand scope; they produce an unavailable or review-required result.

The model identifier is pinned to `jev-1.13.0` in the fixture request context. Moving aliases are intentionally not selected by this module. This is a compatibility proposal for an injected DecisionPort consumer, not a statement that TypeSafe or another owner has accepted this question set, model policy, or transport. The provider documentation describes available model identifiers and Noul’s output shape, but does not establish account access or live acceptance: [TypeSafe model catalog](https://docs.typesafe.ai/models) and [Noul primitive](https://docs.typesafe.ai/primitives/noul) (checked 2026-10-10).

## Durable local repair limits

The SQLite controller binds each inspection to its trusted tenant/project/brief/design scope and exact brief/design hashes. Its fixed fixture limits are two repair claims, 60 seconds, and three simulated units across reopen/restart, duplicate calls, cancellation, and concurrent workers. Claims and completion records are idempotent by action identity. A result recorded after cancellation or expiry remains non-publishable. The controller’s status only records local limits; a consuming API must independently revalidate its current context and obtain C03 authorization before dispatch or publication.

## Fixture policy and evaluation

The fixture manifest names seven buckets: corrupt integrity, revoked or unknown permission, valid unchanged output, wrong subject, mask drift, poor result, and adversarial observation. The tests also exercise parent/source bindings, malformed answer shapes, trusted DecisionPort context, bounded repair restart and concurrency, report limitations, and held-out metrics. Fixture metrics report defect false negatives, valid-output false repairs, human-review/failure counts, latency, and downstream cost. If any case cost is unknown, total downstream cost remains explicitly unknown; known subtotals are not represented as full cost.

`promotion_status` remains `not_promoted`. The frozen fixture policy does not establish classifier calibration, Q01 thresholds, a selected vision provider, live JEV execution, owner acceptance, account access, or production quality. Production promotion requires separately reviewed held-out evidence and accepted owner policy.

## Current integration boundary

This worktree is a source-only inspection package. It does not wire inspection into the application API, a vision adapter, a durable design-version publication transaction, C03 metering/Finance, or the shared event/trace sink. Those integrations remain required before CE-09 can be considered complete. The source tests are checked on Node 22.23.3 and 24.15.0 and can be run with:

```sh
node --test tests/inspection/*.test.mjs
```

The runtime entrypoint assertion is included in `tests/inspection/public-entrypoint.test.mjs`. The public declarations are checked with TypeScript 5.9.3 under strict NodeNext resolution by compiling `tests/inspection/public-consumer.mts` against the source subpath. The TypeScript compiler remains a top-level build dependency to be wired during serialized root integration. These local checks are not application-level or live-provider acceptance evidence.
