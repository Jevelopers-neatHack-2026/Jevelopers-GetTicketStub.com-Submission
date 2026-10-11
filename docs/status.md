# Private status inbox fixture

This module is a private Phase A development fixture for recording fulfillment status observations. It does not define a provider integration or claim conformance to the shared fulfillment contract. Its mapping, tracking-host, polling, and correction policies are explicitly marked `development_fixture`; production use remains disabled.

## Boundaries

The containing application owns commercial order state. Finance owns the ledger. This store keeps a scoped status observation history, a derived local projection, unresolved conflicts, poll work, and an at-least-once outbox. It does not create or update orders, authorize charges or refunds, or write finance records. The application must supply the `TrustedStatusLookup` port and is responsible for binding it to a separately reviewed authenticated provider read. The status module itself does not open a provider connection.

Callbacks are disabled by default. If the application enables unverified callback hints, a hint can only make a registered poll target eligible sooner; its contents never become provider evidence or directly change the projection. Unknown provider states remain `unknown` while retaining the observed provider status for diagnosis.

## Persistence and deduplication

`LocalStatusStore` writes under a private local directory using the existing durable JSON store and a separate commit marker. Reopening checks the provider/mode/policy binding, validates every persisted observation against the pinned fixture mapping, recomputes identifiers, and rebuilds the observation index, projection, conflict, correction, and outbox relationships. Malformed or disconnected state fails closed and is not repaired in place.

Source IDs and semantic effects serve different purposes. A repeated source ID with identical content is a duplicate; reusing it with changed content records a conflict. Semantic effect IDs omit observation timestamps, so the same effective status arriving under another source ID does not produce a second projection change or outbox effect. Split shipments, tracking references, item quantities, and delta contribution IDs remain scoped to their request. Contradictory terminal states are retained as conflicts; timestamps never select a winner.

Outbox event IDs are stable. Consumers claim events with leases and fencing tokens, then acknowledge them. A process can stop after an event is claimed and receive the same event ID again after lease expiry, so consumers must make their own effects idempotent. Acknowledgment records delivery progress; it does not transfer ownership of the commercial order or ledger.

## Polling and correction

Polling policy is supplied per target and validated before persistence. Retries use bounded exponential backoff, clamp provider retry hints to the configured maximum, and stop after the configured attempt count or an explicit terminal state. Unresolved conflicts can schedule trusted canonical reconciliation. A terminal correction requires a trusted-lookup observation and an explicit fixture correction policy; this is a test seam, not an issuer or provider authorization rule.

The fixture status mapping and approved tracking hosts are deliberately local test data. Shared-contract mapping/consumer conformance, provider authentication, durable cross-process deployment guarantees beyond the local filesystem contract, and release readiness remain pending. Live, sandbox, and release use are not approved by this module.
