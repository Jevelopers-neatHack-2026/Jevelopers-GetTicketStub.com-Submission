import { assertRenderableSchema, defaultDraft, activeQuestions, canonical } from '/schema.mjs';
import { applyErrorMessage, historyErrorMessage } from './messages.mjs';
import { projectApplyResult, projectCounters, projectHistoryList, projectHistoryResult } from '/public-result.mjs';
const $ = id => document.getElementById(id);
let schema, draft, lastAction, operationId, operationStatus, historySelection, pending = false;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Request unavailable');
  return response.json();
}
function counter(data) { const counts = projectCounters(data); if (counts) $('counters').textContent = `Jobs: ${counts.jobs} · JEV calls: ${counts.jev_calls} · Image calls: ${counts.image_calls}`; }
function error(message) { $('error').textContent = message; $('error').hidden = false; $('error').focus(); }
function result(data) {
  counter(data);
  data = projectApplyResult(data);
  $('error').hidden = true;
  if (data.operation_id && data.operation_id !== operationId) {
    operationId = data.operation_id; operationStatus = 'unknown';
  }
  if (data.status) operationStatus = data.status;
  if (!data.ok) $('cancel').disabled = ['completed', 'cancelled'].includes(operationStatus) || (!operationId && !lastAction);
  if (!data.ok) {
    $('status').textContent = operationId ? `Apply did not complete. Existing operation: ${operationId}.` : 'Apply did not complete. Operation reference unavailable. Retry last Apply to recover its identity.';
    error(applyErrorMessage(data)); return;
  }
  $('status').textContent = data.acknowledgment_only ? `Existing operation acknowledged: ${operationId}. No approval or purchase was created.` : data.code === 'cancelled' ? 'Operation cancelled. No approval or purchase was created.' :
    `${data.code === 'replayed' ? 'Existing operation returned' : data.code === 'completed' ? 'Artwork revision saved' : data.code === 'ready' ? 'Typed handoff ready' : 'Apply accepted'}: ${operationId}. No approval or purchase was created.`;
  if (data.result?.design_version) refreshHistory();
  $('draft-state').textContent = data.acknowledgment_only ? 'Existing operation acknowledged. Validate handoff to review its current typed handoff.' : data.status === 'completed' ? 'Revision saved. Refresh controls to review the current version before drafting another edit.' : data.code === 'cancelled' ? 'Operation cancelled. Make a new draft selection to Apply again.' : 'Draft submitted. Retry or cancel the existing operation.';
  $('cancel').disabled = data.code === 'cancelled' || data.status === 'completed'; $('handoff').disabled = data.code === 'cancelled' || data.status === 'completed';
  if (data.result?.design_version) { const design = data.result.design_version; $('artifact').hidden = false; $('artifact').textContent = `Saved version ${design.design_version_id} · exact artwork ${design.artifact.content_hash} · backend job ${data.backend_job_id}`;
    $('artwork-preview').src = `/api/artifact?design_version_id=${encodeURIComponent(design.design_version_id)}`; $('artwork-preview').hidden = false; }
}
function dirty() {
  lastAction = undefined; $('retry').disabled = true;
  $('draft-state').textContent = 'Draft updated. Apply changes to submit.'; $('apply').disabled = pending;
  $('error').hidden = true;
}
function selectField(item, value, onChange, locked = false) {
  const wrapper = document.createElement('div'); wrapper.className = 'field'; wrapper.id = `field-${item.id}`;
  const label = document.createElement('label'); label.htmlFor = item.id; label.textContent = item.label;
  const select = document.createElement('select'); select.id = item.id; select.name = item.id; select.disabled = locked;
  for (const option of item.options) { const element = document.createElement('option'); element.value = option.value; element.textContent = option.label; select.append(element); }
  select.value = value; select.addEventListener('change', () => onChange(select.value));
  wrapper.append(label, select);
  if (locked) { const note = document.createElement('p'); note.id = `lock-${item.id}`; note.className = 'hint'; note.textContent = 'Locked by the current brief.'; select.setAttribute('aria-describedby', note.id); wrapper.append(note); }
  return wrapper;
}
function questions() {
  document.querySelectorAll('[data-question]').forEach(el => el.remove());
  const active = activeQuestions(schema, draft);
  for (const key of Object.keys(draft.answers)) if (!active.some(q => q.id === key)) delete draft.answers[key];
  for (const q of active) {
    draft.answers[q.id] ??= q.default_value;
    const field = selectField(q, draft.answers[q.id], value => { draft.answers[q.id] = value; dirty(); }, q.locked);
    field.dataset.question = 'true'; field.querySelector('select').required = q.required; $('fields').append(field);
  }
}
async function refresh() {
  try {
    const data = await api('/api/schema'); schema = assertRenderableSchema(data.schema); draft = defaultDraft(schema);
    // Keep an already accepted operation available for cancellation after refresh.
    lastAction = undefined;
    $('fields').replaceChildren(Object.assign(document.createElement('legend'), { textContent: 'Draft selections' }));
    for (const c of schema.controls) $('fields').append(selectField(c, draft.selections[c.id], value => { draft.selections[c.id] = value; questions(); dirty(); }, c.locked));
    questions(); $('draft-state').textContent = 'No draft changes.'; $('apply').disabled = true;
    $('retry').disabled = true; $('handoff').disabled = !operationId || ['completed', 'cancelled'].includes(operationStatus); $('cancel').disabled = !operationId || ['completed', 'cancelled'].includes(operationStatus);
    $('error').hidden = true; $('status').textContent = operationId ? `Controls refreshed. Existing operation: ${operationId}.` : 'No operation submitted.'; counter(data);
    refreshHistory();
    $('versions').textContent = `${schema.schema_version} · brief ${schema.expected_versions.brief} · design ${schema.expected_versions.design} · composition ${schema.expected_versions.composition}`;
  } catch { error('Controls unavailable. Try Refresh controls.'); }
}
async function apply(retry = false) {
  if (pending) return;
  const restoreRetryFocus = retry && document.activeElement === $('retry');
  pending = true; $('apply').disabled = true; $('retry').disabled = true;
  $('fields').disabled = true; $('refresh').disabled = true;
  try {
    if (!retry && !lastAction) {
      const digestHex = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('');
      lastAction = { action_version: `creative-apply/${schema.schema_version.split('/')[1]}`, schema_version: schema.schema_version,
        action_id: `action_${crypto.randomUUID()}`, tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id,
        expected_versions: schema.expected_versions, intent: 'apply', draft: structuredClone(draft),
        control_schema_hash: `sha256:${await digestHex(schema)}`, draft_hash: await digestHex(draft) };
    }
    $('cancel').disabled = false;
    result(await api('/api/apply', lastAction));
  } catch { error('Response unavailable. Retry last Apply to recover the same operation identity.'); }
  finally { pending = false; $('retry').disabled = !lastAction; $('fields').disabled = false; $('refresh').disabled = false;
    if (restoreRetryFocus && $('error').hidden && !$('retry').disabled) $('retry').focus();
  }
}
$('controls').addEventListener('submit', event => { event.preventDefault(); apply(); });
$('retry').addEventListener('click', () => apply(true));
$('refresh').addEventListener('click', refresh);
for (const [id, path] of [['handoff', '/api/dispatch'], ['cancel', '/api/cancel']]) $(id).addEventListener('click', async () => {
  try { result(await api(path, id === 'cancel' && lastAction ? { action_id: lastAction.action_id } : { operation_id: operationId })); } catch { error('Response unavailable. Operation status remains unknown.'); }
});
async function refreshHistory() {
  try {
    const data = projectHistoryList(await api('/api/history'));
    if (!data) { $('history-section').hidden = true; return; }
    historySelection = data.selection; $('history-version').replaceChildren();
    for (const item of data.items) { const option = document.createElement('option'); option.value = item.design_version_id; option.textContent = `${item.design_version_id} · ${item.artifact.content_hash}`; $('history-version').append(option); }
    $('history-section').hidden = false;
  } catch { $('history-section').hidden = true; }
}
for (const id of ['compare-history', 'restore-history']) $(id).addEventListener('click', async () => {
  try {
    const body = { design_version_id: $('history-version').value };
    if (id === 'restore-history') { body.expected_selection_revision = historySelection.revision; body.action_id = `restore_${crypto.randomUUID()}`; }
    const response = await api(id === 'restore-history' ? '/api/restore' : '/api/compare', body); counter(response);
    const data = projectHistoryResult(response, id === 'restore-history');
    if (!data.ok) return error(historyErrorMessage(data));
    $('history-result').textContent = id === 'restore-history' ? `Selected saved artwork ${data.result.design_version_id}. No image call or approval created.` : `Compared exact hashes ${data.result.left} and ${data.result.right}.`;
    if (id === 'restore-history') { $('artwork-preview').src = `/api/artifact?design_version_id=${encodeURIComponent(data.result.design_version_id)}`; $('artwork-preview').hidden = false; await refresh(); }
  } catch { error('Version operation unavailable.'); }
});
refresh();
