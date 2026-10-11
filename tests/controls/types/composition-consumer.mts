import { createCompositionControlProjection, createCompositionControlPlan, validateCompositionControlPolicy, assertCompositionCurrent, assertCompositionCompletion, COMPOSITION_APPLY_VERSION,
  type CompositionControlApply, type CreativeCompositionControlPolicy, type CreativeCompositionControlProjection, type CompositionControlDraft } from '../../../src/controls/index.mjs';
import type { CreativeCompositionRevision } from 'creative-engine/contracts/composition-authority';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const policyAny: IsAny<ReturnType<typeof validateCompositionControlPolicy>> = false;
const projectionAny: IsAny<ReturnType<typeof createCompositionControlProjection>> = false;
const planAny: IsAny<ReturnType<typeof createCompositionControlPlan>> = false;
const viewAny: IsAny<ReturnType<typeof assertCompositionCurrent>> = false;
const completionAny: IsAny<ReturnType<typeof assertCompositionCompletion>> = false;
void [policyAny, projectionAny, planAny, viewAny, completionAny];
declare const revision: CreativeCompositionRevision, policy: CreativeCompositionControlPolicy, projection: CreativeCompositionControlProjection;
const action: CompositionControlApply = { action_version: COMPOSITION_APPLY_VERSION, action_id: 'action:typed', projection_sha256: projection.projection_sha256, intent: 'apply', draft: { categories: { layout: 'stacked', layout_emphasis: 'name' }, exact: {} } };
createCompositionControlPlan({ revision, policy, projection, action });
createCompositionControlProjection({ revision, preview_bytes: new Uint8Array(), policy, principal: { actor_id:'actor',tenant_id:'tenant',project_id:'project' }, selection_revision:1, can_apply:true, now_ms:1 });
// @ts-expect-error old categories retain closed options
const wrongCategory: CompositionControlDraft = { categories: { name_size: 'giant' }, exact:{} };
// @ts-expect-error no executable action authority
const purchase: CompositionControlApply = { ...action, intent:'purchase' };
// @ts-expect-error explicit version negotiation
const unsupported: CompositionControlApply = { ...action, action_version:'creative-composition-apply/2.0' };
// @ts-expect-error exact units stay closed
const wrongUnit: CompositionControlDraft = { categories:{}, exact:{text_size:{value:'24',unit:'em'}} };
// @ts-expect-error complete layer/preview identities are required by neutral revision
const invented: CreativeCompositionRevision = { revision_id:'invented' };
void [wrongCategory,purchase,unsupported,wrongUnit,invented];
