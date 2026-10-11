import { prepareInspectionRequest, projectInspectionPresentation, type InspectionPresentationInput, type InspectionRequestPreparation } from '../../../src/controls/index.mjs';
import type { CreativeApiRequest } from 'creative-engine/api/v1';
const prepared: InspectionRequestPreparation = prepareInspectionRequest({
  current_brief: { brief_id: 'b', brief_hash: 'sha256:fixture', tenant_id: 't', project_id: 'p' },
  current_selection: { revision: 2, design_version_id: 'd', design_hash: 'sha256:fixture' },
  saved_design: { logical_operation_id: 'edit', design_version_id: 'd', brief_id: 'b', brief_hash: 'sha256:fixture', tenant_id: 't', project_id: 'p', design_hash: 'sha256:fixture', artifact: { content_hash: 'sha256:fixture' } },
  edit_action_id: 'edit', inspection_action_id: 'inspect',
});
// Exact operation fragment is assignable to the actual public API declaration.
const fragment: Pick<CreativeApiRequest, 'operation' | 'action_id' | 'payload'> = prepared.request;
const fixture: InspectionPresentationInput = { schema_version: 'controls-inspection-presentation/1.0', evidence_mode: 'local-input-fixture',
  references: { edit_action_id: 'e', inspection_action_id: 'i', brief_id: 'b', design_version_id: 'd', artifact_hash: 'sha256:fixture' },
  status: 'failed', report: null, usage: { completeness: 'unknown', hold: 'held' } };
const view = projectInspectionPresentation(fixture);
// @ts-expect-error recommendations do not expose repair dispatch or approval authority.
view.startRepair();
// @ts-expect-error inspection identity and payload are immutable.
prepared.request.payload.design_version_id = 'different';
void fragment;
