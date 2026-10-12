import { validateContract, parseContract, versions } from '@jevelopers/shared-contracts';
import type { EventIntelligencePackage, ResearchCorrectionRequest, ResearchInvalidation } from '@jevelopers/shared-contracts';
import { checkEventIntelligencePackage, adaptResearchPackage } from '@jevelopers/shared-contracts/research-creative';
import type { ResearchContext, ResearchFact } from '@jevelopers/shared-contracts/research-creative';
import { validateVersionedReference } from '@jevelopers/shared-contracts/operations';
import type { CorrectionHistorySnapshot, CorrectionInput, ReviewInvalidation } from '__EI_HISTORY_MODULE__';

declare const local: CorrectionHistorySnapshot;
declare const command: CorrectionInput;
declare const invalidation: ReviewInvalidation;
declare const context: ResearchContext;
const checked = checkEventIntelligencePackage(local, context);
if (checked.ok) {
  const version: '1.0.0' = checked.value.schema_version;
  const fact: ResearchFact = checked.value.facts[0];
  const ref = validateVersionedReference(checked.value.request_ref);
  void [version, fact, ref];
}
const parsed = parseContract('ResearchRequest', '{}');
const validated = validateContract('ResearchCorrectionReceipt', {});
const alias = adaptResearchPackage(local, 'canonical-alias-1.0.0');
if (alias.ok) { const migrationIsNotAccepted: false = alias.value.accepted_migration; void migrationIsNotAccepted; }
const registered: 'EventIntelligencePackage_1_0_0' = versions.EventIntelligencePackage['1.0.0'];

// Real local DTOs must not become assignable to the canonical wire contracts.
// @ts-expect-error Local snapshots omit canonical scope, references and hash domains.
const notAPackage: EventIntelligencePackage = local;
// @ts-expect-error Local correction capability is not canonical issuer authority.
const notARequest: ResearchCorrectionRequest = command;
// @ts-expect-error Local invalidation records omit canonical delivery/reference metadata.
const notAnInvalidation: ResearchInvalidation = invalidation;
void [parsed, validated, registered, notAPackage, notARequest, notAnInvalidation];
