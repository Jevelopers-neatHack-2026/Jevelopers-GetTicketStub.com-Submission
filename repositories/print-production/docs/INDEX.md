# Documentation index

Local deterministic tests and evidence establish local behavior only; consumer adoption, supplier approval and acceptance require owner evidence.

## Build and verification
- [CI workload](runtime/CI-WORKLOAD.md) describes the supported environment and bounded workload planning.
- [Integration-evals handoff](integrations/integration-evals.md) connects local evidence to the master evaluation process.
- [Production-output acceptance](production-output/ACCEPTANCE.md) and [exporter conformance](production-output/EXPORTER-CONFORMANCE.md) cover local output checks; they do not authorize supplier submission.
- [Durability dispatcher handoff](durability/dispatcher-handoff.md) documents durable jobs and their limits.
- [Bounded cold-open WAL initialization](durability/cold-open.md) records the initial SQLite WAL setup retry policy and its transaction, retry, and evidence boundaries.

## Interfaces and implementation
- [Candidate adapter](contracts/candidate-adapter.md) and [candidate intake](contracts/candidate-intake.md) describe the pinned candidate boundary.
- Source-local guides cover [composition](composition/VISUAL.md), [fonts](composition/FONTS.md), and [composition review](composition/REVIEW-FIXES.md).
- The production-output directory contains PDF mapping, paint, semantics and Linux-position notes. Use the specific profile note relevant to the output under review.

See [ownership](architecture/OWNERSHIP.md) and [acceptance allocation](architecture/ACCEPTANCE.md); current acceptance status remains in integration-evals.
