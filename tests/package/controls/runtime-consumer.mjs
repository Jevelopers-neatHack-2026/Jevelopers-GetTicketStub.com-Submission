import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ApplyStore,
  CreativeControlsAdapter,
  SCHEMA_VERSIONS,
  createControlSchema,
  defaultDraft,
  hash,
  prepareInspectionRequest,
  projectInspectionPresentation,
} from 'creative-engine/controls';

assert.equal(typeof CreativeControlsAdapter, 'function');
assert.equal(typeof prepareInspectionRequest, 'function');
assert.equal(typeof projectInspectionPresentation, 'function');

const principal = { actor_id: 'package_actor', tenant_id: 'package_tenant', project_id: 'package_project' };
const state = {
  tenant_id: principal.tenant_id,
  project_id: principal.project_id,
  brief_id: 'package_brief',
  versions: { brief: 'brief_v1', design: 'design_v1', composition: 'composition_v1' },
  available_operations: ['composition.update', 'artwork.edit'],
  values: { name_size: 'medium', layout: 'centered', logo_position: 'top', style: 'calm' },
  follow_up_answers: { q01: 'balanced' },
  follow_up_locks: [],
  allowed_options: {
    name_size: ['small', 'medium', 'large'],
    layout: ['centered', 'stacked'],
    logo_position: ['top', 'bottom'],
    style: ['calm', 'vibrant'],
  },
  locks: ['logo_position'],
  logo_asset_id: 'package_approved_logo',
  can_apply: true,
  permitted_asset_ids: ['package_approved_logo'],
  dispatchable_routes: ['composition.update'],
};
const schema = createControlSchema(state, SCHEMA_VERSIONS[1]);
const draft = defaultDraft(schema);
draft.selections.c01 = 'large';
const body = {
  action_version: 'creative-apply/1.1',
  schema_version: schema.schema_version,
  action_id: 'package_action',
  tenant_id: principal.tenant_id,
  project_id: principal.project_id,
  brief_id: schema.brief_id,
  expected_versions: schema.expected_versions,
  control_schema_hash: `sha256:${hash(schema)}`,
  intent: 'apply',
  draft,
  draft_hash: hash(draft),
};
const directory = mkdtempSync(join(tmpdir(), 'creative-controls-installed-package-'));
let store;
try {
  const database = join(directory, 'outbox.sqlite');
  const projection = () => ({
    schema,
    can_apply: true,
    supported_schema_versions: SCHEMA_VERSIONS,
    permitted_asset_ids: state.permitted_asset_ids,
    dispatchable_routes: state.dispatchable_routes,
  });
  store = new ApplyStore(database, projection);
  const accepted = store.apply(principal, body);
  assert.equal(accepted.code, 'accepted');
  assert.ok(accepted.operation_id);
  assert.equal(store.dispatch(principal, accepted.operation_id).code, 'ready');
  assert.equal(store.apply(principal, body).code, 'replayed');
  store.close();

  store = new ApplyStore(database, projection);
  assert.equal(store.apply(principal, body).code, 'replayed');
  assert.equal(store.dispatch(principal, accepted.operation_id).code, 'replayed');
  assert.deepEqual(store.counts(), { jobs: 1, image_calls: 0, jev_calls: 0 });
  console.log(JSON.stringify({
    entrypoint: import.meta.resolve('creative-engine/controls'),
    sqlite_replay: 'passed across store restart',
    counters: store.counts(),
    approval: false,
    purchase: false,
  }));
} finally {
  store?.close();
  rmSync(directory, { recursive: true, force: true });
}
