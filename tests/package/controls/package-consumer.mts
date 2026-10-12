import {
  ApplyStore,
  CreativeControlsAdapter,
  SCHEMA_VERSIONS,
  createControlSchema,
  defaultDraft,
  hash,
  prepareInspectionRequest,
  projectInspectionPresentation,
  type ApplyPayload,
  type ControlSchema,
  type TrustedControlState,
  type TrustedPrincipal,
} from 'creative-engine/controls';
import * as apiV1 from 'creative-engine/api/v1';
import * as contracts from 'creative-engine/contracts';
import * as creativeContracts from 'creative-engine/contracts/creative/v1';
import * as decisionContracts from 'creative-engine/contracts/decision-port/v1';
import * as meteringContracts from 'creative-engine/contracts/metering';
import * as handoffContracts from 'creative-engine/contracts/approval-handoff';
import * as preflight from 'creative-engine/preflight';
import * as planning from 'creative-engine/planning';
import * as versions from 'creative-engine/versions';
import * as models from 'creative-engine/models';
import * as telemetry from 'creative-engine/telemetry';

const state: TrustedControlState = {
  tenant_id: 'consumer_tenant',
  project_id: 'consumer_project',
  brief_id: 'consumer_brief',
  versions: { brief: 'b1', design: 'd1', composition: 'c1' },
  available_operations: ['composition.update'],
  values: { name_size: 'medium', layout: 'centered', logo_position: 'top', style: 'calm' },
  allowed_options: {
    name_size: ['medium', 'large'],
    layout: ['centered', 'stacked'],
    logo_position: ['top'],
    style: ['calm', 'vibrant'],
  },
  follow_up_answers: { q01: 'balanced' },
};
const principal: TrustedPrincipal = {
  actor_id: 'consumer_actor', tenant_id: state.tenant_id, project_id: state.project_id,
};
const schema: ControlSchema = createControlSchema(state, SCHEMA_VERSIONS[1]);
const draft = defaultDraft(schema);
draft.selections.c01 = 'large';
const action: ApplyPayload = {
  action_version: 'creative-apply/1.1',
  schema_version: schema.schema_version,
  action_id: 'consumer_action',
  control_schema_hash: `sha256:${hash(schema)}`,
  tenant_id: principal.tenant_id,
  project_id: principal.project_id,
  brief_id: schema.brief_id,
  expected_versions: schema.expected_versions,
  intent: 'apply',
  draft,
  draft_hash: hash(draft),
};
const store = new ApplyStore(':memory:', () => ({
  schema,
  can_apply: true,
  supported_schema_versions: SCHEMA_VERSIONS,
  permitted_asset_ids: [],
  dispatchable_routes: ['composition.update'],
}));
const accepted = store.apply(principal, action);
if (accepted.operation_id) store.dispatch(principal, accepted.operation_id);
const adapterConstructor: typeof CreativeControlsAdapter = CreativeControlsAdapter;
const inspectionFunctions: [typeof prepareInspectionRequest, typeof projectInspectionPresentation] = [
  prepareInspectionRequest, projectInspectionPresentation,
];
void [apiV1, contracts, creativeContracts, decisionContracts, meteringContracts, handoffContracts,
  preflight, planning, versions, models, telemetry, adapterConstructor, inspectionFunctions];
store.close();

// @ts-expect-error unsupported schema versions are not part of the public type contract.
createControlSchema(state, 'creative-controls/2.0');
// @ts-expect-error Apply cannot carry purchase authorization.
const privilegedAction: ApplyPayload = { ...action, intent: 'purchase' };
void privilegedAction;

// Additive projection/Apply consumer: legacy declarations above stay closed.
import { COMPOSITION_APPLY_VERSION, createCompositionControlPlan, assertCompositionCurrent,
  type CompositionControlApply, type CreativeCompositionControlProjection } from 'creative-engine/controls';
type CompositionIsAny<T> = 0 extends (1 & T) ? true : false;
const checkedProjectionType: CompositionIsAny<ReturnType<typeof assertCompositionCurrent>> = false;
const checkedPlanType: CompositionIsAny<ReturnType<typeof createCompositionControlPlan>> = false;
declare const exactProjection: CreativeCompositionControlProjection;
const exactAction: CompositionControlApply = { action_version: COMPOSITION_APPLY_VERSION, action_id:'installed:apply', intent:'apply', projection_sha256:exactProjection.projection_sha256, draft:{categories:{name_size:'large'},exact:{}} };
// @ts-expect-error closed original category values
const badComposition: CompositionControlApply = {...exactAction,draft:{categories:{logo_position:'middle'},exact:{}}};
// @ts-expect-error Apply never authorizes purchase
const badAuthority: CompositionControlApply = {...exactAction,intent:'purchase'};
void [checkedProjectionType,checkedPlanType,exactAction,badComposition,badAuthority];
