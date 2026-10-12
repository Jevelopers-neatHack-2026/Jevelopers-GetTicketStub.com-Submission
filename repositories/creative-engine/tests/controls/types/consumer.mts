// Strict source ESM consumer only. The actual package export remains a separate failing prerequisite.
import { ApplyStore, createControlSchema, defaultDraft, hash, controlContractReference,
  assertControlContractBinding, SCHEMA_VERSIONS, type ApplyPayload, type TrustedControlState,
  type TrustedPrincipal, type ControlSchema } from '../../../src/controls/index.mjs';

const state: TrustedControlState = {
  tenant_id: 'tenant', project_id: 'project', brief_id: 'brief',
  versions: { brief: 'b1', design: 'd1', composition: 'c1' },
  available_operations: ['composition.update'], values: { name_size: 'medium', layout: 'stacked' },
  allowed_options: { name_size: ['medium', 'large'], layout: ['stacked'] },
  follow_up_answers: { q01: 'name' }, follow_up_locks: ['q01'],
};
const principal: TrustedPrincipal = { actor_id: 'actor', tenant_id: 'tenant', project_id: 'project' };
const schema: ControlSchema = createControlSchema(state, SCHEMA_VERSIONS[0]);
const draft = defaultDraft(schema);
const action: ApplyPayload = { action_version: 'creative-apply/1.0', schema_version: schema.schema_version,
  action_id: 'action', control_schema_hash: `sha256:${hash(schema)}`, tenant_id: 'tenant', project_id: 'project',
  brief_id: 'brief', expected_versions: state.versions, intent: 'apply', draft, draft_hash: hash(draft) };
const store = new ApplyStore(':memory:', () => ({ schema, can_apply: true, supported_schema_versions: SCHEMA_VERSIONS,
  permitted_asset_ids: [], dispatchable_routes: ['composition.update'] }));
const result = store.apply(principal, action);
if (result.operation_id) store.dispatch(principal, result.operation_id);
assertControlContractBinding(controlContractReference(schema), schema);
type IsAny<T> = 0 extends (1 & T) ? true : false;
const publicSchemaIsAny: IsAny<typeof schema> = false;
const publicResultIsAny: IsAny<typeof result> = false;
void [publicSchemaIsAny, publicResultIsAny];
// @ts-expect-error unsupported schema versions are not part of the public contract.
createControlSchema(state, 'creative-controls/2.0');
// @ts-expect-error Apply is not purchase authorization.
const privilegedAction: ApplyPayload = { ...action, intent: 'purchase' };
void privilegedAction;
store.close();

import { CreativeControlsAdapter, snapshotControlJson } from '../../../src/controls/index.mjs';
function useActualIntegration(adapter: CreativeControlsAdapter, actor: TrustedPrincipal, untrusted: unknown) {
  const projection = adapter.projection(actor);
  const durable = adapter.lookup(actor, 'action-fixture');
  const completion: Promise<import('../../../src/controls/index.mjs').IntegratedApplyResult> = adapter.apply(actor, untrusted);
  const safeInput: unknown = snapshotControlJson(untrusted);
  return { projection, durable, completion, safeInput };
}
void useActualIntegration;

import type { CurrentCreativeControlContext } from '../../../src/controls/index.mjs';
function hostReadPolicies(context: CurrentCreativeControlContext) {
  const denied: CurrentCreativeControlContext['policy'] = {
    can_apply: false, can_read: false, available_operations: [], permitted_asset_ids: [],
  };
  const omitted: CurrentCreativeControlContext['policy'] = {
    can_apply: true, available_operations: ['artwork.edit'], permitted_asset_ids: [],
  };
  const deniedContext: CurrentCreativeControlContext = { ...context, policy: denied };
  const compatibleContext: CurrentCreativeControlContext = { ...context, policy: omitted };
  // @ts-expect-error current read authority is a boolean, not caller-issued text.
  const invalid: CurrentCreativeControlContext['policy'] = { ...denied, can_read: 'granted' };
  return { deniedContext, compatibleContext, invalid };
}
void hostReadPolicies;
