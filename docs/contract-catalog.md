# Contract Catalog

This is the maintained inventory. The JSON record below is consumed by `contracts:inventory`. Foundation candidates are implemented locally and await owner review. All domain leaves are unimplemented. Paths and versions remain null until artifacts exist; no planned export counts as an implementation.

| Export | Leaf | Producers | Consumers | State |
| --- | --- | --- | --- | --- |
| CommonEnvelope | #7 SC-04 | shared-contracts | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence, team-dashboard, integration-evals, getticketstub.com | foundation_candidate |
| EvidenceProjection | #8 SC-11 | shared-contracts | integration-evals, team-dashboard, getticketstub.com | foundation_candidate |
| ErrorEnvelope | #9 SC-08.ERROR | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence | getticketstub.com, agent-harness, team-dashboard, integration-evals | unimplemented |
| PartialFailure | #9 SC-08.ERROR | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence | getticketstub.com, agent-harness, team-dashboard, integration-evals | unimplemented |
| JobStatus | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | unimplemented |
| JobProgress | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | unimplemented |
| Cancellation | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | unimplemented |
| JobCommandAcknowledgement | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | unimplemented |
| UsageEvent | #11 SC-06.USAGE | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors | cost-intelligence, integration-evals | unimplemented |
| BudgetReservation | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| ReserveRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| ReserveResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| SettleRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| SettleResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| ReleaseRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| ReleaseResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| QueryRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| QueryResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | unimplemented |
| FinancialSummary | #13 SC-06.SUMMARY | cost-intelligence | team-dashboard, getticketstub.com, integration-evals | unimplemented |
| DecisionPortRequest | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | unimplemented |
| DecisionPortResult | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | unimplemented |
| DecisionReceipt | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | unimplemented |
| ProjectRequest | #15 SC-02.PROJECT | getticketstub.com | agent-harness | unimplemented |
| ResearchRequest | #16 SC-02.RESEARCH | agent-harness | event-intelligence | unimplemented |
| EventIntelligencePackage | #17 SC-02.RESEARCH-PACKAGE | event-intelligence | creative-engine, agent-harness, getticketstub.com, integration-evals | unimplemented |
| ResearchCorrectionRequest | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | unimplemented |
| ResearchCorrectionReceipt | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | unimplemented |
| ResearchInvalidation | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | unimplemented |
| CreativeBrief | #19 SC-02.BRIEF | creative-engine | agent-harness, creative-engine | unimplemented |
| DesignControlSchema | #20 SC-02.CONTROLS | creative-engine | getticketstub.com | unimplemented |
| DesignVersion | #21 SC-02.DESIGN | creative-engine | getticketstub.com, print-production, agent-harness, integration-evals | unimplemented |
| ApprovalReference | #22 SC-07.APPROVAL | getticketstub.com | creative-engine, print-production, event-intelligence, agent-harness, integration-evals | unimplemented |
| ApprovalReceipt | #22 SC-07.APPROVAL | getticketstub.com | creative-engine, print-production, event-intelligence, agent-harness, integration-evals | unimplemented |
| ArtifactHandoffManifest | #23 SC-07.HANDOFF | creative-engine | print-production, getticketstub.com, agent-harness, integration-evals | unimplemented |
| ProductionBundle | #24 SC-07.PRODUCTION | print-production | getticketstub.com, fulfillment-connectors, agent-harness, integration-evals | unimplemented |
| FulfillmentQuote | #25 SC-07.QUOTE | fulfillment-connectors | getticketstub.com, agent-harness | unimplemented |
| OrderAuthorization | #26 SC-07.ORDER-AUTH | getticketstub.com | agent-harness, fulfillment-connectors | unimplemented |
| FulfillmentStatus | #27 SC-08.FULFILLMENT | fulfillment-connectors | getticketstub.com, agent-harness, team-dashboard, integration-evals | unimplemented |
| EvaluationEvidence | #28 SC-02.EVIDENCE | integration-evals | team-dashboard, getticketstub.com | unimplemented |

```json catalog
{
  "policy_version": "1.0.0",
  "contracts": [
    {
      "name": "CommonEnvelope",
      "group": "CommonEnvelope",
      "issue": 7,
      "requirement": "SC-04",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "shared-contracts",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "shared-contracts"
      ],
      "consumers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "print-production",
        "fulfillment-connectors",
        "cost-intelligence",
        "team-dashboard",
        "integration-evals",
        "getticketstub.com"
      ],
      "trust_boundary": "scope and identity propagation",
      "semantic_authority": "scope and identity propagation",
      "lifecycle": "immutable event; stable on redelivery",
      "field_steward": "shared-contracts",
      "state": "foundation_candidate",
      "schema_path": "schemas/CommonEnvelope/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/CommonEnvelope_1_0_0.d.ts",
      "helper": "tooling/runtime.mjs",
      "fixtures": "fixtures/CommonEnvelope.json",
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification",
      "acceptance": null
    },
    {
      "name": "EvidenceProjection",
      "group": "EvidenceProjection",
      "issue": 8,
      "requirement": "SC-11",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "shared-contracts",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "shared-contracts"
      ],
      "consumers": [
        "integration-evals",
        "team-dashboard",
        "getticketstub.com"
      ],
      "trust_boundary": "allowlisted public evidence",
      "semantic_authority": "allowlisted public evidence",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "shared-contracts",
      "state": "foundation_candidate",
      "schema_path": "schemas/EvidenceProjection/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/EvidenceProjection_1_0_0.d.ts",
      "helper": "tooling/runtime.mjs",
      "fixtures": "fixtures/EvidenceProjection.json",
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification",
      "acceptance": null
    },
    {
      "name": "ErrorEnvelope",
      "group": "ErrorEnvelope",
      "issue": 9,
      "requirement": "SC-08.ERROR",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "print-production",
        "fulfillment-connectors",
        "cost-intelligence"
      ],
      "consumers": [
        "getticketstub.com",
        "agent-harness",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "typed failure without retry authority",
      "semantic_authority": "typed failure without retry authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "PartialFailure",
      "group": "PartialFailure",
      "issue": 9,
      "requirement": "SC-08.ERROR",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "print-production",
        "fulfillment-connectors",
        "cost-intelligence"
      ],
      "consumers": [
        "getticketstub.com",
        "agent-harness",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "typed failure without retry authority",
      "semantic_authority": "typed failure without retry authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "JobStatus",
      "group": "JobStatus",
      "issue": 10,
      "requirement": "SC-08.JOB",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness"
      ],
      "consumers": [
        "getticketstub.com",
        "event-intelligence",
        "creative-engine",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "workflow state and cancellation",
      "semantic_authority": "workflow state and cancellation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "JobProgress",
      "group": "JobProgress",
      "issue": 10,
      "requirement": "SC-08.JOB",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness"
      ],
      "consumers": [
        "getticketstub.com",
        "event-intelligence",
        "creative-engine",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "workflow state and cancellation",
      "semantic_authority": "workflow state and cancellation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "Cancellation",
      "group": "Cancellation",
      "issue": 10,
      "requirement": "SC-08.JOB",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness"
      ],
      "consumers": [
        "getticketstub.com",
        "event-intelligence",
        "creative-engine",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "workflow state and cancellation",
      "semantic_authority": "workflow state and cancellation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "JobCommandAcknowledgement",
      "group": "JobCommandAcknowledgement",
      "issue": 10,
      "requirement": "SC-08.JOB",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness"
      ],
      "consumers": [
        "getticketstub.com",
        "event-intelligence",
        "creative-engine",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "workflow state and cancellation",
      "semantic_authority": "workflow state and cancellation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "UsageEvent",
      "group": "UsageEvent",
      "issue": 11,
      "requirement": "SC-06.USAGE",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "print-production",
        "fulfillment-connectors"
      ],
      "consumers": [
        "cost-intelligence",
        "integration-evals"
      ],
      "trust_boundary": "observation without financial posting",
      "semantic_authority": "observation without financial posting",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "BudgetReservation",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ReserveRequest",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ReserveResult",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "SettleRequest",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "SettleResult",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ReleaseRequest",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ReleaseResult",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "QueryRequest",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "QueryResult",
      "group": "BudgetReservation",
      "issue": 12,
      "requirement": "SC-06.RESERVATION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "cost-intelligence",
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "trust_boundary": "cost-intelligence alone authorizes reservations; command names pending",
      "semantic_authority": "cost-intelligence alone authorizes reservations; command names pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "FinancialSummary",
      "group": "FinancialSummary",
      "issue": 13,
      "requirement": "SC-06.SUMMARY",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "cost-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "cost-intelligence"
      ],
      "consumers": [
        "team-dashboard",
        "getticketstub.com",
        "integration-evals"
      ],
      "trust_boundary": "read-only financial projection",
      "semantic_authority": "read-only financial projection",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "cost-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "DecisionPortRequest",
      "group": "DecisionPort",
      "issue": 14,
      "requirement": "SC-05",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "bounded injected decisions without approval authority",
      "semantic_authority": "bounded injected decisions without approval authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "DecisionPortResult",
      "group": "DecisionPort",
      "issue": 14,
      "requirement": "SC-05",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "bounded injected decisions without approval authority",
      "semantic_authority": "bounded injected decisions without approval authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "DecisionReceipt",
      "group": "DecisionPort",
      "issue": 14,
      "requirement": "SC-05",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine"
      ],
      "consumers": [
        "agent-harness",
        "event-intelligence",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "bounded injected decisions without approval authority",
      "semantic_authority": "bounded injected decisions without approval authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ProjectRequest",
      "group": "ProjectRequest",
      "issue": 15,
      "requirement": "SC-02.PROJECT",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com"
      ],
      "consumers": [
        "agent-harness"
      ],
      "trust_boundary": "authenticated application ingress",
      "semantic_authority": "authenticated application ingress",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ResearchRequest",
      "group": "ResearchRequest",
      "issue": 16,
      "requirement": "SC-02.RESEARCH",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "agent-harness",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "agent-harness"
      ],
      "consumers": [
        "event-intelligence"
      ],
      "trust_boundary": "bounded research ingress",
      "semantic_authority": "bounded research ingress",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "agent-harness",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "EventIntelligencePackage",
      "group": "EventIntelligencePackage",
      "issue": 17,
      "requirement": "SC-02.RESEARCH-PACKAGE",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "event-intelligence",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "event-intelligence"
      ],
      "consumers": [
        "creative-engine",
        "agent-harness",
        "getticketstub.com",
        "integration-evals"
      ],
      "trust_boundary": "facts and asset permissions; ResearchPackage alias unresolved",
      "semantic_authority": "facts and asset permissions; ResearchPackage alias unresolved",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "event-intelligence",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ResearchCorrectionRequest",
      "group": "ResearchCorrectionRequest",
      "issue": 18,
      "requirement": "SC-02.RESEARCH-EVENTS",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com",
        "event-intelligence"
      ],
      "consumers": [
        "event-intelligence",
        "creative-engine",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "immutable correction and stale-use propagation",
      "semantic_authority": "immutable correction and stale-use propagation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ResearchCorrectionReceipt",
      "group": "ResearchCorrectionReceipt",
      "issue": 18,
      "requirement": "SC-02.RESEARCH-EVENTS",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com",
        "event-intelligence"
      ],
      "consumers": [
        "event-intelligence",
        "creative-engine",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "immutable correction and stale-use propagation",
      "semantic_authority": "immutable correction and stale-use propagation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ResearchInvalidation",
      "group": "ResearchInvalidation",
      "issue": 18,
      "requirement": "SC-02.RESEARCH-EVENTS",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com",
        "event-intelligence"
      ],
      "consumers": [
        "event-intelligence",
        "creative-engine",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "immutable correction and stale-use propagation",
      "semantic_authority": "immutable correction and stale-use propagation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "CreativeBrief",
      "group": "CreativeBrief",
      "issue": 19,
      "requirement": "SC-02.BRIEF",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "creative-engine",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "creative-engine"
      ],
      "consumers": [
        "agent-harness",
        "creative-engine"
      ],
      "trust_boundary": "exact sourced facts and bounded generation policy",
      "semantic_authority": "exact sourced facts and bounded generation policy",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "creative-engine",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "DesignControlSchema",
      "group": "DesignControlSchema",
      "issue": 20,
      "requirement": "SC-02.CONTROLS",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "creative-engine",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "creative-engine"
      ],
      "consumers": [
        "getticketstub.com"
      ],
      "trust_boundary": "inert declarative controls",
      "semantic_authority": "inert declarative controls",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "creative-engine",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "DesignVersion",
      "group": "DesignVersion",
      "issue": 21,
      "requirement": "SC-02.DESIGN",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "creative-engine",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "creative-engine"
      ],
      "consumers": [
        "getticketstub.com",
        "print-production",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "immutable original/generated/transformed artwork",
      "semantic_authority": "immutable original/generated/transformed artwork",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "creative-engine",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ApprovalReference",
      "group": "ApprovalReference",
      "issue": 22,
      "requirement": "SC-07.APPROVAL",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com"
      ],
      "consumers": [
        "creative-engine",
        "print-production",
        "event-intelligence",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "application authenticates current approval and revocation",
      "semantic_authority": "application authenticates current approval and revocation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ApprovalReceipt",
      "group": "ApprovalReceipt",
      "issue": 22,
      "requirement": "SC-07.APPROVAL",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com"
      ],
      "consumers": [
        "creative-engine",
        "print-production",
        "event-intelligence",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "application authenticates current approval and revocation",
      "semantic_authority": "application authenticates current approval and revocation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ArtifactHandoffManifest",
      "group": "ArtifactHandoffManifest",
      "issue": 23,
      "requirement": "SC-07.HANDOFF",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "creative-engine",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "creative-engine"
      ],
      "consumers": [
        "print-production",
        "getticketstub.com",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "approved artwork inputs; consumption receipt naming pending",
      "semantic_authority": "approved artwork inputs; consumption receipt naming pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "creative-engine",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "ProductionBundle",
      "group": "ProductionBundle",
      "issue": 24,
      "requirement": "SC-07.PRODUCTION",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "print-production",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "print-production"
      ],
      "consumers": [
        "getticketstub.com",
        "fulfillment-connectors",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "final print composition and preflight remain production authority",
      "semantic_authority": "final print composition and preflight remain production authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "print-production",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "FulfillmentQuote",
      "group": "FulfillmentQuote",
      "issue": 25,
      "requirement": "SC-07.QUOTE",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "fulfillment-connectors",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "fulfillment-connectors"
      ],
      "consumers": [
        "getticketstub.com",
        "agent-harness"
      ],
      "trust_boundary": "quote terms without purchase authority",
      "semantic_authority": "quote terms without purchase authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "fulfillment-connectors",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "OrderAuthorization",
      "group": "OrderAuthorization",
      "issue": 26,
      "requirement": "SC-07.ORDER-AUTH",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "getticketstub.com",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "getticketstub.com"
      ],
      "consumers": [
        "agent-harness",
        "fulfillment-connectors"
      ],
      "trust_boundary": "purchase authorization separate from art approval and budget",
      "semantic_authority": "purchase authorization separate from art approval and budget",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "FulfillmentStatus",
      "group": "FulfillmentStatus",
      "issue": 27,
      "requirement": "SC-08.FULFILLMENT",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "fulfillment-connectors",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "fulfillment-connectors"
      ],
      "consumers": [
        "getticketstub.com",
        "agent-harness",
        "team-dashboard",
        "integration-evals"
      ],
      "trust_boundary": "normalized supplier observations",
      "semantic_authority": "normalized supplier observations",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "fulfillment-connectors",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    },
    {
      "name": "EvaluationEvidence",
      "group": "EvaluationEvidence",
      "issue": 28,
      "requirement": "SC-02.EVIDENCE",
      "owner_role": "Agent and research (shared-contracts maintainer)",
      "domain_steward": "integration-evals",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "integration-evals"
      ],
      "consumers": [
        "team-dashboard",
        "getticketstub.com"
      ],
      "trust_boundary": "sanitized proof with simulated/live separation",
      "semantic_authority": "sanitized proof with simulated/live separation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "integration-evals",
      "state": "unimplemented",
      "schema_path": null,
      "schema_version": null,
      "generated_export": null,
      "helper": null,
      "fixtures": null,
      "docs": "docs/contract-catalog.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "pending domain leaf",
      "acceptance": null
    }
  ],
  "unresolved_export_slots": [
    {
      "issue": 17,
      "slots": [
        "research request receipt",
        "research answer receipt",
        "research batch receipt"
      ],
      "export_names": null,
      "state": "pending_owner_naming",
      "producer": "event-intelligence",
      "consumers": [
        "agent-harness",
        "creative-engine"
      ]
    },
    {
      "issue": 22,
      "slots": [
        "authenticated approval verifier input",
        "verification outcome"
      ],
      "export_names": null,
      "state": "pending_application_authority_interface",
      "producer": "getticketstub.com",
      "consumers": [
        "creative-engine",
        "print-production"
      ]
    },
    {
      "issue": 23,
      "slots": [
        "handoff consumption receipt reference"
      ],
      "export_names": null,
      "state": "pending_owner_naming",
      "producer": "print-production",
      "consumers": [
        "creative-engine",
        "agent-harness"
      ]
    }
  ]
}
```

Artwork handoff describes creative inputs; ProductionBundle describes composed print outputs. ApprovalReference/ApprovalReceipt are externally issued art or asset-use approvals. OrderAuthorization is an application-issued purchase authorization. No reference, hash, scope ID or retry hint authenticates these claims.

The budget command labels inventory the reserve/settle/release/query request/result slots required by #12; final names and schemas require finance-owner review. DecisionPort is a command group with three separate required exports. Choice/Score/Noul variants remain #14 work. ResearchPackage is an unresolved alias, not a canonical export. Approval verifier and handoff consumption-receipt naming remain #22/#23 work.

See [identity rules](identity-policy.md), [privacy](privacy-policy.md), [version policy](../compatibility/version-policy.json), [requirements](requirements.json), and [consumer discovery and handoff](../compatibility/consumers.json). Historical architecture snapshots provide context; this catalog and future accepted schemas govern migration.

Foundation navigation: [CommonEnvelope schema](../schemas/CommonEnvelope/1.0.0.json), [type](../generated/CommonEnvelope_1_0_0.d.ts), [fixtures](../fixtures/CommonEnvelope.json); [EvidenceProjection schema](../schemas/EvidenceProjection/1.0.0.json), [type](../generated/EvidenceProjection_1_0_0.d.ts), [fixtures](../fixtures/EvidenceProjection.json); [runtime helpers](../tooling/runtime.mjs). Domain paths stay null until implemented.
