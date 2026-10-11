<a href="https://github.com/Jevelopers-neatHack-2026/shared-contracts">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="shared-contracts — Public schemas and compatibility fixtures. TicketStub banner showing two stub halves meeting at a perforation with interlocking bracket edges." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# shared-contracts

Versioned schemas, validation and compatibility fixtures for the interfaces between TicketStub repositories.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: draft implementation candidate, no accepted release" src="https://img.shields.io/badge/status-draft%20candidate-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="docs/contract-catalog.md"><img alt="Contract catalog: implemented candidates" src="https://img.shields.io/badge/catalog-candidate-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Development](#development) · [Contracts](#contracts) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Draft implementation candidate.** [PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) proposes the implemented schemas and executable development package documented here. It remains draft and unmerged; no contract version is an accepted release, and no owner acknowledgement or consumer adoption is implied by these local checks.

Candidate package **0.8.3** contains 47 individually indexed wire names across 56 supported schema versions, generated Node ESM validators and deep readonly TypeScript bindings, pure context helpers, compatibility fixtures and offline consumer tooling. The narrow [#32 capability/print-spec proposal](docs/capability-contracts.md) adds `FulfillmentCapabilitySnapshot@1.0.0` and `PrintSpec@1.0.0` from concrete synthetic fulfillment inputs, pending independent and owner/consumer review. The nine finance families retain their 2.0.0 proposals and 1.0.0 encodings; named owners, proposed receipt/verifier names and actual producer/consumer acceptance remain pending. The GitHub repository was inspected as public on October 10, 2026; npm package `private: true` prevents registry publication. These are separate settings. No project license has been selected.

The 0.8.3 candidate repairs SC-CHK-009 and SC-CHK-010 from the whole-PR review of `d428365`: ProductionBundle binds the complete immutable handoff reference, and a rejected research request must be a failed batch member. Wire schemas and fixture encodings are unchanged. Fresh exact-candidate review and acceptance remain required.

Release remains blocked by the [fresh finance delta review](compatibility/finance-delta-findings.json), [pending owner-requested API proposals](compatibility/proposal-intake.json), and all nine real consumer adoptions. FC-001/002 remain repaired in the reviewed 2.0.0 proposal; candidate query-disposition and terminal-finality repairs now await fresh independent and finance-owner review. Partial dispatch is explicitly unsupported until a reviewed allowed-work/replan interface exists, while truthful partial grant/hold reporting remains supported. Current 1.0.0 operational finance helpers fail closed. The [checkpoint review repairs](compatibility/checkpoint-findings.json) are local contributions pending fresh exact-candidate review; passing checks are not acceptance. [Later downstream source observations](compatibility/downstream-observations.json) are separate from immutable discovery pins.

The [SC-CI-001 observation shutdown repair](compatibility/ci-findings.json) retains the failed push history and requires fresh exact-candidate Linux CI and independent review. Transport failures remain failures, with no fixture-execution credit.

- Earlier development evidence includes the [cost-intelligence proposal pin](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/blob/main/contracts.lock.json) for `@jevelopers/shared-contracts@0.3.0`, recorded in the upstream README as `proposal_only` with `adoption_accepted: false`. That earlier archive is not an accepted release or adoption of this 0.8.3 candidate.
- Remaining work is tracked in [SC-EPIC #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) and its linked SC issues, ending with the [SC-12 release gate](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). CON-01 to CON-03 remain pending in the [acceptance view](docs/architecture/ACCEPTANCE.md).

## What's here

This repository owns versioned request, result, event, error and validation contracts between independently developed repositories. Business behavior and provider implementations stay with their domain owners. See [ownership](docs/architecture/OWNERSHIP.md).

The [contract catalog](docs/contract-catalog.md) describes the implemented candidate interfaces and their ownership and acceptance requirements:

| Section | Covers |
| --- | --- |
| [Common envelope](docs/contract-catalog.md#common-envelope) | Required scope, correlation, provenance and `billing_mode` fields |
| [Domain contracts](docs/contract-catalog.md#domain-contracts) | Project request through research, creative, production, quote, authorization, usage and summary |
| [Ownership of state](docs/contract-catalog.md#ownership-of-state) | The authoritative owner of each record |
| [Financial identities and lifecycles](docs/contract-catalog.md#financial-identities-and-lifecycles) | Operation, billable attempt and transport retry; valuation and reservation states |
| [Compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance) | Minimum checks before a contract is accepted |
| [Error model](docs/contract-catalog.md#error-model) | Typed, retry-safe error fields |

## Development

Use **Node 22.23.3** for canonical generation, npm and the exact [lockfile](package-lock.json). Installed Node ESM, TypeScript and all-version fixtures were also verified on **Node 24.21.0** for consumer compatibility. The engine range retains Node 22 and permits Node 24 at that tested minimum; renderer/npm platform acceptance remains downstream. Prewarm the locked dependency cache before the isolated run. Validation uses no provider credentials and no provider calls:

```sh
export npm_config_offline=true npm_config_audit=false npm_config_fund=false
npm ci
npm run build
npm test
npm run contracts:check
npm run contracts:fixtures
npm run contracts:compat
npm run contracts:coverage -- --human
npm run docs:check
npm run generate -- --check
git diff --exit-code -- schemas generated fixtures
npm run test:installed
npm pack --dry-run
```

On an uncommitted implementation checkout, the Git diff command shows intentional candidate changes; `generate -- --check` checks byte drift independently. The exact committed candidate must reproduce cleanly before release. Every required owner/consumer flag and `contracts:consumers` are release gates; their known missing records fail explicitly. [Full validation and coverage](docs/fixture-harness.md), [consumer CI and pins](docs/consumer-handoff.md), and [release checklist/provenance](docs/release-guide.md) describe the commands and limitations. `--foundation` selects two foundation exports, `--implemented` currently selects all 47 candidates; neither means release acceptance.

Node ESM and TypeScript use the same export map. Expected scope comes from the authenticated server adapter, outside the payload:

```js
import { parseContract, checkTrustedContext, versions } from '@jevelopers/shared-contracts';
export function parseIngress(jsonFromCaller, authenticatedScope) {
  const parsed = parseContract('ProjectRequest', jsonFromCaller);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return checkTrustedContext(parsed.value, authenticatedScope);
}
console.log(Object.keys(versions.ProjectRequest)); // exact supported versions
```

```ts
import { parseContract } from '@jevelopers/shared-contracts';
import type { ProjectRequest, ContractVersionMap, TrustedContext } from '@jevelopers/shared-contracts';
export function decode(json: string): ProjectRequest | undefined {
  const result = parseContract('ProjectRequest', json);
  return result.ok ? result.value : undefined;
}
export type ProjectV1 = ContractVersionMap['ProjectRequest']['1.0.0'];
export type ServerScope = TrustedContext;
```

Structural parsing rejects duplicate JSON members, unsupported exact versions, unknown fields/enums and malformed primitives without coercion, defaults or mutation. Safe failures carry code/path/keyword and never submitted values; unknown-field paths identify their parent container. Pure semantic helpers in the [operations](docs/operations-contracts.md), [research/creative](docs/research-creative-contracts.md) and [commerce/evidence](docs/commerce-evidence-contracts.md) guides compare independently supplied domain contexts. They do not authenticate callers, issue approval, grant spending, render artwork, submit supplier orders or implement a ledger.

## Contracts

The [machine catalog](docs/contract-catalog.md) is the maintained inventory. Every named export links below to its actual schema, derived type, validator/helper, canonical fixtures and accountable domain/owner issue. Named reviewers and acknowledgements are still unassigned. The helper accepts the schema discriminator shown in its fixture; the [API/version map](generated/schema-manifest.json) records exact schema identities and bytes.

| Contract | Schema | TypeScript | Validation/helper | Examples | Accountable domain and assignment |
| --- | --- | --- | --- | --- | --- |
| FulfillmentCapabilitySnapshot | [schema](schemas/FulfillmentCapabilitySnapshot/1.0.0.json) | [types](generated/FulfillmentCapabilitySnapshot_1_0_0.d.ts) | [helper](tooling/capability.mjs) | [fixtures](fixtures/FulfillmentCapabilitySnapshot.json) | [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/32) |
| PrintSpec | [schema](schemas/PrintSpec/1.0.0.json) | [types](generated/PrintSpec_1_0_0.d.ts) | [helper](tooling/capability.mjs) | [fixtures](fixtures/PrintSpec.json) | [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/32) |
| CommonEnvelope | [schema](schemas/CommonEnvelope/1.0.0.json) | [types](generated/CommonEnvelope_1_0_0.d.ts) | [helper](tooling/runtime.mjs) | [fixtures](fixtures/CommonEnvelope.json) | [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/7) |
| EvidenceProjection | [schema](schemas/EvidenceProjection/1.0.0.json) | [types](generated/EvidenceProjection_1_0_0.d.ts) | [helper](tooling/runtime.mjs) | [fixtures](fixtures/EvidenceProjection.json) | [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/8) |
| ErrorEnvelope | [schema](schemas/ErrorEnvelope/1.0.0.json) | [types](generated/ErrorEnvelope_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/ErrorEnvelope.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/9) |
| PartialFailure | [schema](schemas/PartialFailure/1.0.0.json) | [types](generated/PartialFailure_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/PartialFailure.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/9) |
| JobStatus | [schema](schemas/JobStatus/1.0.0.json) | [types](generated/JobStatus_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/JobStatus.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/10) |
| JobProgress | [schema](schemas/JobProgress/1.0.0.json) | [types](generated/JobProgress_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/JobProgress.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/10) |
| Cancellation | [schema](schemas/Cancellation/1.0.0.json) | [types](generated/Cancellation_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/Cancellation.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/10) |
| JobCommandAcknowledgement | [schema](schemas/JobCommandAcknowledgement/1.0.0.json) | [types](generated/JobCommandAcknowledgement_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/JobCommandAcknowledgement.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/10) |
| UsageEvent | [schema](schemas/UsageEvent/1.0.0.json) | [types](generated/UsageEvent_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/UsageEvent.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/11) |
| BudgetReservation | [schema](schemas/BudgetReservation/2.0.0.json) | [types](generated/BudgetReservation_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/BudgetReservation.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| ReserveRequest | [schema](schemas/ReserveRequest/2.0.0.json) | [types](generated/ReserveRequest_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/ReserveRequest.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| ReserveResult | [schema](schemas/ReserveResult/2.0.0.json) | [types](generated/ReserveResult_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/ReserveResult.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| SettleRequest | [schema](schemas/SettleRequest/2.0.0.json) | [types](generated/SettleRequest_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/SettleRequest.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| SettleResult | [schema](schemas/SettleResult/2.0.0.json) | [types](generated/SettleResult_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/SettleResult.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| ReleaseRequest | [schema](schemas/ReleaseRequest/2.0.0.json) | [types](generated/ReleaseRequest_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/ReleaseRequest.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| ReleaseResult | [schema](schemas/ReleaseResult/2.0.0.json) | [types](generated/ReleaseResult_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/ReleaseResult.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| QueryRequest | [schema](schemas/QueryRequest/2.0.0.json) | [types](generated/QueryRequest_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/QueryRequest.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| QueryResult | [schema](schemas/QueryResult/2.0.0.json) | [types](generated/QueryResult_2_0_0.d.ts) | [helper](tooling/finance-v2.mjs) | [fixtures](fixtures/QueryResult.2_0_0.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12) |
| FinancialSummary | [schema](schemas/FinancialSummary/1.0.0.json) | [types](generated/FinancialSummary_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/FinancialSummary.json) | [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/13) |
| DecisionPortRequest | [schema](schemas/DecisionPortRequest/1.0.0.json) | [types](generated/DecisionPortRequest_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/DecisionPortRequest.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/14) |
| DecisionPortResult | [schema](schemas/DecisionPortResult/1.0.0.json) | [types](generated/DecisionPortResult_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/DecisionPortResult.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/14) |
| DecisionReceipt | [schema](schemas/DecisionReceipt/1.0.0.json) | [types](generated/DecisionReceipt_1_0_0.d.ts) | [helper](tooling/operations.mjs) | [fixtures](fixtures/DecisionReceipt.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/14) |
| ProjectRequest | [schema](schemas/ProjectRequest/1.0.0.json) | [types](generated/ProjectRequest_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ProjectRequest.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/15) |
| ResearchRequest | [schema](schemas/ResearchRequest/1.0.0.json) | [types](generated/ResearchRequest_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchRequest.json) | [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/16) |
| EventIntelligencePackage | [schema](schemas/EventIntelligencePackage/1.0.0.json) | [types](generated/EventIntelligencePackage_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/EventIntelligencePackage.json) | [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/17) |
| ResearchCorrectionRequest | [schema](schemas/ResearchCorrectionRequest/1.0.0.json) | [types](generated/ResearchCorrectionRequest_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchCorrectionRequest.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/18) |
| ResearchCorrectionReceipt | [schema](schemas/ResearchCorrectionReceipt/1.0.0.json) | [types](generated/ResearchCorrectionReceipt_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchCorrectionReceipt.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/18) |
| ResearchInvalidation | [schema](schemas/ResearchInvalidation/1.0.0.json) | [types](generated/ResearchInvalidation_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchInvalidation.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/18) |
| CreativeBrief | [schema](schemas/CreativeBrief/1.0.0.json) | [types](generated/CreativeBrief_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/CreativeBrief.json) | [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/19) |
| DesignControlSchema | [schema](schemas/DesignControlSchema/1.0.0.json) | [types](generated/DesignControlSchema_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/DesignControlSchema.json) | [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/20) |
| DesignVersion | [schema](schemas/DesignVersion/1.0.0.json) | [types](generated/DesignVersion_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/DesignVersion.json) | [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/21) |
| ApprovalReference | [schema](schemas/ApprovalReference/1.0.0.json) | [types](generated/ApprovalReference_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ApprovalReference.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22) |
| ApprovalReceipt | [schema](schemas/ApprovalReceipt/1.0.0.json) | [types](generated/ApprovalReceipt_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ApprovalReceipt.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22) |
| ArtifactHandoffManifest | [schema](schemas/ArtifactHandoffManifest/1.0.0.json) | [types](generated/ArtifactHandoffManifest_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ArtifactHandoffManifest.json) | [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/23) |
| ProductionBundle | [schema](schemas/ProductionBundle/1.0.0.json) | [types](generated/ProductionBundle_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ProductionBundle.json) | [print-production](https://github.com/Jevelopers-neatHack-2026/print-production) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/24) |
| FulfillmentQuote | [schema](schemas/FulfillmentQuote/1.0.0.json) | [types](generated/FulfillmentQuote_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/FulfillmentQuote.json) | [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/25) |
| OrderAuthorization | [schema](schemas/OrderAuthorization/1.0.0.json) | [types](generated/OrderAuthorization_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/OrderAuthorization.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/26) |
| FulfillmentStatus | [schema](schemas/FulfillmentStatus/1.0.0.json) | [types](generated/FulfillmentStatus_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/FulfillmentStatus.json) | [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/27) |
| EvaluationEvidence | [schema](schemas/EvaluationEvidence/1.0.0.json) | [types](generated/EvaluationEvidence_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/EvaluationEvidence.json) | [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/28) |
| ResearchRequestReceipt | [schema](schemas/ResearchRequestReceipt/1.0.0.json) | [types](generated/ResearchRequestReceipt_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchRequestReceipt.json) | [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/17) |
| ResearchAnswerReceipt | [schema](schemas/ResearchAnswerReceipt/1.0.0.json) | [types](generated/ResearchAnswerReceipt_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchAnswerReceipt.json) | [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/17) |
| ResearchBatchReceipt | [schema](schemas/ResearchBatchReceipt/1.0.0.json) | [types](generated/ResearchBatchReceipt_1_0_0.d.ts) | [helper](tooling/research-creative.mjs) | [fixtures](fixtures/ResearchBatchReceipt.json) | [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/17) |
| ApprovalVerificationRequest | [schema](schemas/ApprovalVerificationRequest/1.0.0.json) | [types](generated/ApprovalVerificationRequest_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ApprovalVerificationRequest.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22) |
| ApprovalVerificationOutcome | [schema](schemas/ApprovalVerificationOutcome/1.0.0.json) | [types](generated/ApprovalVerificationOutcome_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ApprovalVerificationOutcome.json) | [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22) |
| ArtifactConsumptionReceipt | [schema](schemas/ArtifactConsumptionReceipt/1.0.0.json) | [types](generated/ArtifactConsumptionReceipt_1_0_0.d.ts) | [helper](tooling/commerce-evidence.mjs) | [fixtures](fixtures/ArtifactConsumptionReceipt.json) | [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine) / [owner issue](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/23) |

Retained finance 1.0.0 artifacts and exact migration are linked in the [finance guide](docs/finance-v2-contracts.md). The [identity policy](docs/identity-policy.md), [privacy policy](docs/privacy-policy.md), [version/deprecation policy](compatibility/version-policy.json) and [canonical schema ADR](docs/adr/0001-canonical-schemas.md) govern these candidates. [Migration/rollback and aliases](docs/consumer-handoff.md) require reviewed adapters and exact producer/shared/consumer pins; existing local types remain until their owner agrees. Current and previous **accepted** majors are retained by policy, but no previous accepted major exists. Candidate retained-encoding fixtures do not fabricate historical adoption. The [dependency handoff](docs/dependency-handoff.md) separates implementation artifacts and closure evidence while retaining every authoritative edge.

The [installed whole-catalog driver](examples/fixture-consumer.mjs) loads the actual archive, runs all structural and independent semantic fixture adapters, roundtrips generated bindings, verifies hashes and proves false negative acceptance fails its assertions. It supplements the four focused installed examples. These package-owned representative adapters are distinct from actual downstream integrations.

The runner uses the exact checked-in [nine-row handoff manifest](compatibility/consumers.json) and pre-provisioned checkout/source/archive/acknowledgement paths. It never clones or fetches. It verifies clean consumer SHA, actual clean shared source SHA **or** archive integrity, complete package code digest, schema identity/version/bytes, fixture digest, acknowledgement provenance and a receipt bound to the package APIs observed during execution. Actual acknowledgement authenticity and downstream authority behavior require owner review. See the [handoff matrix and exact driver command](docs/consumer-handoff.md).

[Third-party notices](generated/THIRD_PARTY_NOTICES.md) preserve the actual licenses of Ajv and fast-deep-equal code bundled in validators. [Dependency provenance](generated/dependency-provenance.json) records locked versions/integrities; there are no runtime npm dependencies. Synthetic fixture assets have no real customer/provider content and establish no third-party asset rights. No tag, GitHub release, registry publication, visibility change or license choice is part of this candidate.

[Ownership](docs/architecture/OWNERSHIP.md) and [acceptance view](docs/architecture/ACCEPTANCE.md) define boundaries. [Requirements](docs/requirements.json) preserve all SC/global IDs, including ARC-01, CON-01/02/03, ART-02/04/05, FIN-02/03/04 and EVAL-01/04. The [integration-evals master tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.json) remains authoritative. [Architecture snapshot](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) and [original implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) are historical planning context. Documentation and fixture execution establish no end-to-end product acceptance.

## Docs

- [Contract catalog](docs/contract-catalog.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture section 5: shared contracts and data ownership](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md#5-shared-contracts-and-data-ownership)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Releases and versioning standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/releases-versioning.md)

## Related repositories

Related producers, consumers and coordination repositories:

- [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors): validates through injected ports and records the shared-contracts issues it waits on.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): records the earlier proposal archive described above; accepted adoption remains pending.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): hosts the master checklist that tracks CON-01 contract compatibility.
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): architecture kit and producer/consumer map.

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Schema changes need review by at least one affected producer and consumer ([compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance)). Run the development checks above and retain schema, fixture and package provenance for review. No license file is present in this repository.

### Production contract development candidate

Package 0.9.0 adds proposed production interfaces and pure checks. [Protocol and authority boundaries](docs/production-contracts.md) and [migration impact](compatibility/production-impact.json) describe the separate 24 local criteria and pending domain handoffs. The six service bindings use `@jevelopers/shared-contracts/production-operations`; commerce `ProductionContext` retains its existing meaning.

| Candidate | Schema | Types | Checks | Fixtures | Ownership |
| --- | --- | --- | --- | --- | --- |
| ProductionReference/1.0.0 | [schema](schemas/ProductionReference/1.0.0.json) | [readonly types](generated/ProductionReference_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionReference.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ProductionPolicy/1.0.0 | [schema](schemas/ProductionPolicy/1.0.0.json) | [readonly types](generated/ProductionPolicy_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionPolicy.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ProductionRuntime/1.0.0 | [schema](schemas/ProductionRuntime/1.0.0.json) | [readonly types](generated/ProductionRuntime_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionRuntime.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ProductionResource/1.0.0 | [schema](schemas/ProductionResource/1.0.0.json) | [readonly types](generated/ProductionResource_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionResource.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ArtifactRef/1.0.0 | [schema](schemas/ArtifactRef/1.0.0.json) | [readonly types](generated/ArtifactRef_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ArtifactRef.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| JobRef/1.0.0 | [schema](schemas/JobRef/1.0.0.json) | [readonly types](generated/JobRef_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/JobRef.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ComposeArtifactRequest/1.0.0 | [schema](schemas/ComposeArtifactRequest/1.0.0.json) | [readonly types](generated/ComposeArtifactRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ComposeArtifactRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| PersonalizeBatchRequest/1.0.0 | [schema](schemas/PersonalizeBatchRequest/1.0.0.json) | [readonly types](generated/PersonalizeBatchRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/PersonalizeBatchRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| InspectArtifactRequest/1.0.0 | [schema](schemas/InspectArtifactRequest/1.0.0.json) | [readonly types](generated/InspectArtifactRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/InspectArtifactRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ExportBundleRequest/1.0.0 | [schema](schemas/ExportBundleRequest/1.0.0.json) | [readonly types](generated/ExportBundleRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ExportBundleRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| CompareTemplateRequest/1.0.0 | [schema](schemas/CompareTemplateRequest/1.0.0.json) | [readonly types](generated/CompareTemplateRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/CompareTemplateRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ArtifactStatusRequest/1.0.0 | [schema](schemas/ArtifactStatusRequest/1.0.0.json) | [readonly types](generated/ArtifactStatusRequest_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ArtifactStatusRequest.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ProductionError/1.0.0 | [schema](schemas/ProductionError/1.0.0.json) | [readonly types](generated/ProductionError_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionError.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ProductionDiagnostic/1.0.0 | [schema](schemas/ProductionDiagnostic/1.0.0.json) | [readonly types](generated/ProductionDiagnostic_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionDiagnostic.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| TemplateSpec/1.0.0 | [schema](schemas/TemplateSpec/1.0.0.json) | [readonly types](generated/TemplateSpec_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/TemplateSpec.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/35) |
| PersonalizationSchema/1.0.0 | [schema](schemas/PersonalizationSchema/1.0.0.json) | [readonly types](generated/PersonalizationSchema_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/PersonalizationSchema.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| Composition/1.0.0 | [schema](schemas/Composition/1.0.0.json) | [readonly types](generated/Composition_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/Composition.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/35) |
| CompatibilityReport/1.0.0 | [schema](schemas/CompatibilityReport/1.0.0.json) | [readonly types](generated/CompatibilityReport_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/CompatibilityReport.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| PreflightReport/1.0.0 | [schema](schemas/PreflightReport/1.0.0.json) | [readonly types](generated/PreflightReport_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/PreflightReport.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| ArtifactFile/2.0.0 | [schema](schemas/ArtifactFile/2.0.0.json) | [readonly types](generated/ArtifactFile_2_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ArtifactFile.2_0_0.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/37) |
| ProductionBundle/2.0.0 | [schema](schemas/ProductionBundle/2.0.0.json) | [readonly types](generated/ProductionBundle_2_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionBundle.2_0_0.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/37) |
| ProductionBundleDetached/1.0.0 | [schema](schemas/ProductionBundleDetached/1.0.0.json) | [readonly types](generated/ProductionBundleDetached_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionBundleDetached.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/37) |
| ProductionBundleRef/1.0.0 | [schema](schemas/ProductionBundleRef/1.0.0.json) | [readonly types](generated/ProductionBundleRef_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionBundleRef.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| RowResult/1.0.0 | [schema](schemas/RowResult/1.0.0.json) | [readonly types](generated/RowResult_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/RowResult.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| BatchResult/1.0.0 | [schema](schemas/BatchResult/1.0.0.json) | [readonly types](generated/BatchResult_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/BatchResult.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| ArtifactManifestStatus/1.0.0 | [schema](schemas/ArtifactManifestStatus/1.0.0.json) | [readonly types](generated/ArtifactManifestStatus_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ArtifactManifestStatus.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
| CsvDialect/1.0.0 | [schema](schemas/CsvDialect/1.0.0.json) | [readonly types](generated/CsvDialect_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/CsvDialect.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| CsvMapping/1.0.0 | [schema](schemas/CsvMapping/1.0.0.json) | [readonly types](generated/CsvMapping_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/CsvMapping.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| CsvCheckpoint/1.0.0 | [schema](schemas/CsvCheckpoint/1.0.0.json) | [readonly types](generated/CsvCheckpoint_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/CsvCheckpoint.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) |
| ProductionExecutionPins/1.0.0 | [schema](schemas/ProductionExecutionPins/1.0.0.json) | [readonly types](generated/ProductionExecutionPins_1_0_0.d.ts) | [pure checks](tooling/production-operations.mjs) | [synthetic fixtures](fixtures/ProductionExecutionPins.json) | [owner leaf](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/34) |
