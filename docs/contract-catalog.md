# Contract Catalog

This is the maintained inventory. The JSON record below is consumed by `contracts:inventory`. Foundation candidates are implemented locally and await owner review. Operations leaves #9-14 now have local candidates; all planned domain leaves now have local candidates. Paths and versions remain null until artifacts exist; no planned export counts as an implementation.

| Export | Leaf | Producers | Consumers | State |
| --- | --- | --- | --- | --- |
| CommonEnvelope | #7 SC-04 | shared-contracts | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence, team-dashboard, integration-evals, getticketstub.com | foundation_candidate |
| EvidenceProjection | #8 SC-11 | shared-contracts | integration-evals, team-dashboard, getticketstub.com | foundation_candidate |
| ErrorEnvelope | #9 SC-08.ERROR | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence | getticketstub.com, agent-harness, team-dashboard, integration-evals | operations_candidate |
| PartialFailure | #9 SC-08.ERROR | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors, cost-intelligence | getticketstub.com, agent-harness, team-dashboard, integration-evals | operations_candidate |
| JobStatus | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | operations_candidate |
| JobProgress | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | operations_candidate |
| Cancellation | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | operations_candidate |
| JobCommandAcknowledgement | #10 SC-08.JOB | agent-harness | getticketstub.com, event-intelligence, creative-engine, team-dashboard, integration-evals | operations_candidate |
| UsageEvent | #11 SC-06.USAGE | agent-harness, event-intelligence, creative-engine, print-production, fulfillment-connectors | cost-intelligence, integration-evals | operations_candidate |
| BudgetReservation | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| ReserveRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| ReserveResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| SettleRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| SettleResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| ReleaseRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| ReleaseResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| QueryRequest | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| QueryResult | #12 SC-06.RESERVATION | cost-intelligence, agent-harness, event-intelligence, creative-engine | cost-intelligence, agent-harness, event-intelligence, creative-engine | operations_candidate |
| FinancialSummary | #13 SC-06.SUMMARY | cost-intelligence | team-dashboard, getticketstub.com, integration-evals | operations_candidate |
| DecisionPortRequest | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | operations_candidate |
| DecisionPortResult | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | operations_candidate |
| DecisionReceipt | #14 SC-05 | agent-harness, event-intelligence, creative-engine | agent-harness, event-intelligence, creative-engine, integration-evals | operations_candidate |
| ProjectRequest | #15 SC-02.PROJECT | getticketstub.com | agent-harness | research_creative_candidate |
| ResearchRequest | #16 SC-02.RESEARCH | agent-harness | event-intelligence | research_creative_candidate |
| EventIntelligencePackage | #17 SC-02.RESEARCH-PACKAGE | event-intelligence | creative-engine, agent-harness, getticketstub.com, integration-evals | research_creative_candidate |
| ResearchCorrectionRequest | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | research_creative_candidate |
| ResearchCorrectionReceipt | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | research_creative_candidate |
| ResearchInvalidation | #18 SC-02.RESEARCH-EVENTS | getticketstub.com, event-intelligence | event-intelligence, creative-engine, agent-harness, integration-evals | research_creative_candidate |
| CreativeBrief | #19 SC-02.BRIEF | creative-engine | agent-harness, creative-engine | research_creative_candidate |
| DesignControlSchema | #20 SC-02.CONTROLS | creative-engine | getticketstub.com | research_creative_candidate |
| DesignVersion | #21 SC-02.DESIGN | creative-engine | getticketstub.com, print-production, agent-harness, integration-evals | research_creative_candidate |
| ApprovalReference | #22 SC-07.APPROVAL | getticketstub.com | creative-engine, print-production, event-intelligence, agent-harness, integration-evals | commerce_evidence_candidate |
| ApprovalReceipt | #22 SC-07.APPROVAL | getticketstub.com | creative-engine, print-production, event-intelligence, agent-harness, integration-evals | commerce_evidence_candidate |
| ArtifactHandoffManifest | #23 SC-07.HANDOFF | creative-engine | print-production, getticketstub.com, agent-harness, integration-evals | commerce_evidence_candidate |
| ProductionBundle | #24 SC-07.PRODUCTION | print-production | getticketstub.com, fulfillment-connectors, agent-harness, integration-evals | commerce_evidence_candidate |
| FulfillmentQuote | #25 SC-07.QUOTE | fulfillment-connectors | getticketstub.com, agent-harness | commerce_evidence_candidate |
| OrderAuthorization | #26 SC-07.ORDER-AUTH | getticketstub.com | agent-harness, fulfillment-connectors | commerce_evidence_candidate |
| FulfillmentStatus | #27 SC-08.FULFILLMENT | fulfillment-connectors | getticketstub.com, agent-harness, team-dashboard, integration-evals | commerce_evidence_candidate |
| EvaluationEvidence | #28 SC-02.EVIDENCE | integration-evals | team-dashboard, getticketstub.com | commerce_evidence_candidate |

| FulfillmentCapabilitySnapshot | #32 SC-CAP | fulfillment-connectors | print-production, getticketstub.com, agent-harness, integration-evals | producer_proposal_pending_review |
| PrintSpec | #32 SC-CAP | fulfillment-connectors | print-production, getticketstub.com, agent-harness, integration-evals | producer_proposal_pending_review |

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
      "state": "operations_candidate",
      "schema_path": "schemas/ErrorEnvelope/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ErrorEnvelope_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/ErrorEnvelope.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/PartialFailure/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/PartialFailure_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/PartialFailure.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/JobStatus/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/JobStatus_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/JobStatus.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/JobProgress/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/JobProgress_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/JobProgress.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/Cancellation/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/Cancellation_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/Cancellation.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/JobCommandAcknowledgement/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/JobCommandAcknowledgement_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/JobCommandAcknowledgement.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/UsageEvent/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/UsageEvent_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/UsageEvent.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/BudgetReservation/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/BudgetReservation_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/BudgetReservation.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/BudgetReservation/1.0.0.json",
          "generated_export": "generated/BudgetReservation_1_0_0.d.ts",
          "fixtures": "fixtures/BudgetReservation.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/BudgetReservation/2.0.0.json",
          "generated_export": "generated/BudgetReservation_2_0_0.d.ts",
          "fixtures": "fixtures/BudgetReservation.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/ReserveRequest/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/ReserveRequest_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/ReserveRequest.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/ReserveRequest/1.0.0.json",
          "generated_export": "generated/ReserveRequest_1_0_0.d.ts",
          "fixtures": "fixtures/ReserveRequest.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/ReserveRequest/2.0.0.json",
          "generated_export": "generated/ReserveRequest_2_0_0.d.ts",
          "fixtures": "fixtures/ReserveRequest.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/ReserveResult/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/ReserveResult_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/ReserveResult.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/ReserveResult/1.0.0.json",
          "generated_export": "generated/ReserveResult_1_0_0.d.ts",
          "fixtures": "fixtures/ReserveResult.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/ReserveResult/2.0.0.json",
          "generated_export": "generated/ReserveResult_2_0_0.d.ts",
          "fixtures": "fixtures/ReserveResult.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/SettleRequest/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/SettleRequest_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/SettleRequest.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/SettleRequest/1.0.0.json",
          "generated_export": "generated/SettleRequest_1_0_0.d.ts",
          "fixtures": "fixtures/SettleRequest.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/SettleRequest/2.0.0.json",
          "generated_export": "generated/SettleRequest_2_0_0.d.ts",
          "fixtures": "fixtures/SettleRequest.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/SettleResult/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/SettleResult_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/SettleResult.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/SettleResult/1.0.0.json",
          "generated_export": "generated/SettleResult_1_0_0.d.ts",
          "fixtures": "fixtures/SettleResult.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/SettleResult/2.0.0.json",
          "generated_export": "generated/SettleResult_2_0_0.d.ts",
          "fixtures": "fixtures/SettleResult.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/ReleaseRequest/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/ReleaseRequest_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/ReleaseRequest.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/ReleaseRequest/1.0.0.json",
          "generated_export": "generated/ReleaseRequest_1_0_0.d.ts",
          "fixtures": "fixtures/ReleaseRequest.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/ReleaseRequest/2.0.0.json",
          "generated_export": "generated/ReleaseRequest_2_0_0.d.ts",
          "fixtures": "fixtures/ReleaseRequest.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/ReleaseResult/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/ReleaseResult_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/ReleaseResult.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/ReleaseResult/1.0.0.json",
          "generated_export": "generated/ReleaseResult_1_0_0.d.ts",
          "fixtures": "fixtures/ReleaseResult.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/ReleaseResult/2.0.0.json",
          "generated_export": "generated/ReleaseResult_2_0_0.d.ts",
          "fixtures": "fixtures/ReleaseResult.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/QueryRequest/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/QueryRequest_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/QueryRequest.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/QueryRequest/1.0.0.json",
          "generated_export": "generated/QueryRequest_1_0_0.d.ts",
          "fixtures": "fixtures/QueryRequest.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/QueryRequest/2.0.0.json",
          "generated_export": "generated/QueryRequest_2_0_0.d.ts",
          "fixtures": "fixtures/QueryRequest.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/QueryResult/2.0.0.json",
      "schema_version": "2.0.0",
      "generated_export": "generated/QueryResult_2_0_0.d.ts",
      "helper": "tooling/finance-v2.mjs",
      "fixtures": "fixtures/QueryResult.2_0_0.json",
      "docs": "docs/finance-v2-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
      "acceptance": null,
      "versions": [
        {
          "schema_version": "1.0.0",
          "schema_path": "schemas/QueryResult/1.0.0.json",
          "generated_export": "generated/QueryResult_1_0_0.d.ts",
          "fixtures": "fixtures/QueryResult.json",
          "helper": "tooling/operations.mjs",
          "docs": "docs/operations-contracts.md",
          "semantic_profile": "legacy_candidate_no_v2_guarantees"
        },
        {
          "schema_version": "2.0.0",
          "schema_path": "schemas/QueryResult/2.0.0.json",
          "generated_export": "generated/QueryResult_2_0_0.d.ts",
          "fixtures": "fixtures/QueryResult.2_0_0.json",
          "helper": "tooling/finance-v2.mjs",
          "docs": "docs/finance-v2-contracts.md",
          "semantic_profile": "cumulative_v2_proposal"
        }
      ],
      "protocol_status": "finance_v2_proposal_pending_owner_rereview"
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
      "state": "operations_candidate",
      "schema_path": "schemas/FinancialSummary/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/FinancialSummary_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/FinancialSummary.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/DecisionPortRequest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/DecisionPortRequest_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/DecisionPortRequest.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/DecisionPortResult/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/DecisionPortResult_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/DecisionPortResult.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "operations_candidate",
      "schema_path": "schemas/DecisionReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/DecisionReceipt_1_0_0.d.ts",
      "helper": "tooling/operations.mjs",
      "fixtures": "fixtures/DecisionReceipt.json",
      "docs": "docs/operations-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public projection stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/ProjectRequest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ProjectRequest_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ProjectRequest.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchRequest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchRequest_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchRequest.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/EventIntelligencePackage/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/EventIntelligencePackage_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/EventIntelligencePackage.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchCorrectionRequest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchCorrectionRequest_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchCorrectionRequest.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchCorrectionReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchCorrectionReceipt_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchCorrectionReceipt.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchInvalidation/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchInvalidation_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchInvalidation.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/CreativeBrief/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/CreativeBrief_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/CreativeBrief.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/DesignControlSchema/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/DesignControlSchema_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/DesignControlSchema.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "research_creative_candidate",
      "schema_path": "schemas/DesignVersion/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/DesignVersion_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/DesignVersion.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ApprovalReference/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ApprovalReference_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ApprovalReference.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ApprovalReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ApprovalReceipt_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ApprovalReceipt.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ArtifactHandoffManifest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ArtifactHandoffManifest_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ArtifactHandoffManifest.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ProductionBundle/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ProductionBundle_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ProductionBundle.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/FulfillmentQuote/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/FulfillmentQuote_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/FulfillmentQuote.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/OrderAuthorization/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/OrderAuthorization_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/OrderAuthorization.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/FulfillmentStatus/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/FulfillmentStatus_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/FulfillmentStatus.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
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
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/EvaluationEvidence/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/EvaluationEvidence_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/EvaluationEvidence.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null
    },
    {
      "name": "ResearchRequestReceipt",
      "group": "ResearchRequestReceipt",
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
        "agent-harness",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "immutable research receipt; no authority or provider execution",
      "semantic_authority": "event-intelligence observation; application retains authentication/permission authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "event-intelligence",
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchRequestReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchRequestReceipt_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchRequestReceipt.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_EI_handoff_pending_owner_review"
    },
    {
      "name": "ResearchAnswerReceipt",
      "group": "ResearchAnswerReceipt",
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
        "agent-harness",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "immutable research receipt; no authority or provider execution",
      "semantic_authority": "event-intelligence observation; application retains authentication/permission authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "event-intelligence",
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchAnswerReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchAnswerReceipt_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchAnswerReceipt.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_EI_handoff_pending_owner_review"
    },
    {
      "name": "ResearchBatchReceipt",
      "group": "ResearchBatchReceipt",
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
        "agent-harness",
        "creative-engine",
        "integration-evals"
      ],
      "trust_boundary": "immutable research receipt; no authority or provider execution",
      "semantic_authority": "event-intelligence observation; application retains authentication/permission authority",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "event-intelligence",
      "state": "research_creative_candidate",
      "schema_path": "schemas/ResearchBatchReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ResearchBatchReceipt_1_0_0.d.ts",
      "helper": "tooling/research-creative.mjs",
      "fixtures": "fixtures/ResearchBatchReceipt.json",
      "docs": "docs/research-creative-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_EI_handoff_pending_owner_review"
    },
    {
      "name": "ApprovalVerificationRequest",
      "group": "ApprovalVerificationRequest",
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
      "trust_boundary": "Comparison against externally authenticated current records; never issuer/service authority",
      "semantic_authority": "application authenticates current approval and revocation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ApprovalVerificationRequest/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ApprovalVerificationRequest_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ApprovalVerificationRequest.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_creative_interface_pending_owner_review"
    },
    {
      "name": "ApprovalVerificationOutcome",
      "group": "ApprovalVerificationOutcome",
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
      "trust_boundary": "Comparison against externally authenticated current records; never issuer/service authority",
      "semantic_authority": "application authenticates current approval and revocation",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "getticketstub.com",
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ApprovalVerificationOutcome/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ApprovalVerificationOutcome_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ApprovalVerificationOutcome.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_creative_interface_pending_owner_review"
    },
    {
      "name": "ArtifactConsumptionReceipt",
      "group": "ArtifactConsumptionReceipt",
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
      "trust_boundary": "Comparison against externally authenticated current records; never issuer/service authority",
      "semantic_authority": "approved artwork inputs; consumption receipt naming pending",
      "lifecycle": "versioned immutable wire record; domain owner controls transitions",
      "field_steward": "creative-engine",
      "state": "commerce_evidence_candidate",
      "schema_path": "schemas/ArtifactConsumptionReceipt/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/ArtifactConsumptionReceipt_1_0_0.d.ts",
      "helper": "tooling/commerce-evidence.mjs",
      "fixtures": "fixtures/ArtifactConsumptionReceipt.json",
      "docs": "docs/commerce-evidence-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification; public evidence stays allowlisted",
      "acceptance": null,
      "naming_status": "proposed_from_creative_interface_pending_owner_review"
    },
    {
      "name": "FulfillmentCapabilitySnapshot",
      "group": "FulfillmentCapabilitySnapshot",
      "issue": 32,
      "requirement": "SC-CAP",
      "owner_role": "shared-contracts canonical maintainer",
      "domain_steward": "fulfillment-connectors",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "fulfillment-connectors"
      ],
      "consumers": [
        "print-production",
        "getticketstub.com",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "untrusted supplier attribution; authenticated scope supplied separately",
      "semantic_authority": "supplier capability declarations; geometry requires separate evidence; no eligibility or authority issuance",
      "lifecycle": "immutable product specification or captured capability value; material changes require domain revalidation",
      "field_steward": "fulfillment-connectors; print-production reviews geometry",
      "state": "producer_proposal_pending_review",
      "schema_path": "schemas/FulfillmentCapabilitySnapshot/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/FulfillmentCapabilitySnapshot_1_0_0.d.ts",
      "helper": "tooling/capability.mjs",
      "fixtures": "fixtures/FulfillmentCapabilitySnapshot.json",
      "docs": "docs/capability-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification",
      "acceptance": null
    },
    {
      "name": "PrintSpec",
      "group": "PrintSpec",
      "issue": 32,
      "requirement": "SC-CAP",
      "owner_role": "shared-contracts canonical maintainer",
      "domain_steward": "fulfillment-connectors",
      "named_owner": null,
      "reviewer": null,
      "owner_acknowledgement": null,
      "producers": [
        "fulfillment-connectors"
      ],
      "consumers": [
        "print-production",
        "getticketstub.com",
        "agent-harness",
        "integration-evals"
      ],
      "trust_boundary": "untrusted supplier attribution; authenticated scope supplied separately",
      "semantic_authority": "supplier capability declarations; geometry requires separate evidence; no eligibility or authority issuance",
      "lifecycle": "immutable product specification or captured capability value; material changes require domain revalidation",
      "field_steward": "fulfillment-connectors; print-production reviews geometry",
      "state": "producer_proposal_pending_review",
      "schema_path": "schemas/PrintSpec/1.0.0.json",
      "schema_version": "1.0.0",
      "generated_export": "generated/PrintSpec_1_0_0.d.ts",
      "helper": "tooling/capability.mjs",
      "fixtures": "fixtures/PrintSpec.json",
      "docs": "docs/capability-contracts.md",
      "version_policy": "compatibility/version-policy.json",
      "field_classification": "schema x-classification",
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
      "export_names": [
        "ResearchRequestReceipt",
        "ResearchAnswerReceipt",
        "ResearchBatchReceipt"
      ],
      "state": "locally_implemented_proposals_pending_owner_review",
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
      "export_names": [
        "ApprovalVerificationRequest",
        "ApprovalVerificationOutcome"
      ],
      "state": "locally_implemented_proposal_pending_owner_review",
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
      "export_names": [
        "ArtifactConsumptionReceipt"
      ],
      "state": "locally_implemented_proposal_pending_owner_review",
      "producer": "print-production",
      "consumers": [
        "creative-engine",
        "agent-harness"
      ]
    }
  ],
  "interfaces": [
    {
      "name": "DecisionPort",
      "issue": 14,
      "requirement": "SC-05",
      "kind": "injected_contract_only_port",
      "state": "operations_candidate",
      "generated_export": "generated/operations.d.ts",
      "helper": "tooling/operations.mjs",
      "request_contract": "DecisionPortRequest",
      "result_contract": "DecisionPortResult",
      "fixtures": "fixtures/DecisionPortRequest.json",
      "docs": "docs/operations-contracts.md",
      "acceptance": null
    }
  ]
}
```

Artwork handoff describes creative inputs; ProductionBundle describes composed print outputs. ApprovalReference/ApprovalReceipt are externally issued art or asset-use approvals. OrderAuthorization is an application-issued purchase authorization. No reference, hash, scope ID or retry hint authenticates these claims.

The budget command labels inventory the reserve/settle/release/query request/result slots required by #12; final names and schemas require finance-owner review. DecisionPort is a command group with three separate required exports. Choice/Score/Noul variants remain #14 work. ResearchPackage is an unresolved alias, not a canonical export. Approval verifier and handoff consumption-receipt naming remain #22/#23 work.

See [identity rules](identity-policy.md), [privacy](privacy-policy.md), [version policy](../compatibility/version-policy.json), [requirements](requirements.json), and [consumer discovery and handoff](../compatibility/consumers.json). Historical architecture snapshots provide context; this catalog and future accepted schemas govern migration.

Foundation navigation: [CommonEnvelope schema](../schemas/CommonEnvelope/1.0.0.json), [type](../generated/CommonEnvelope_1_0_0.d.ts), [fixtures](../fixtures/CommonEnvelope.json); [EvidenceProjection schema](../schemas/EvidenceProjection/1.0.0.json), [type](../generated/EvidenceProjection_1_0_0.d.ts), [fixtures](../fixtures/EvidenceProjection.json); [runtime helpers](../tooling/runtime.mjs). Domain paths stay null until implemented.

Operations navigation: [contracts and helper guide](operations-contracts.md), [installed consumer example](../examples/operations-consumer.mjs), [generated port API](../generated/operations.d.ts). Each operations entry above has a real schema, declaration and fixture path; owner acknowledgement remains null.

Research and creative navigation: [contract and migration guide](research-creative-contracts.md), [installed consumer](../examples/research-creative-consumer.mjs), [generated context API](../generated/research-creative.d.ts). ResearchRequestReceipt, ResearchAnswerReceipt and ResearchBatchReceipt are separately indexed proposals grounded in EI's receipt handoff; final names and acceptance remain pending.

Commerce/evidence navigation: [guide](commerce-evidence-contracts.md), [installed consumer](../examples/commerce-evidence-consumer.mjs), [generated context API](../generated/commerce-evidence.d.ts). Canonical wire exports now exist for every catalog slot; genuine owner/naming/consumer acceptance remains pending.
