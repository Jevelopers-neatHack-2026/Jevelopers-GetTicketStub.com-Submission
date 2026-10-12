# storage

Private transactional SQLite artifact storage is implemented in local-store.ts.
See [durability guarantees and upstream gates](../../docs/durability/README.md).
The candidate canonical adapter is exercised by the local `artifact-storage`
conformance suite. Live integration acceptance and handoff eligibility remain
unproven; see the linked scope and criterion coverage.
