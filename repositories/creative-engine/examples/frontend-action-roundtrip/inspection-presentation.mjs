import { projectInspectionPresentation } from '/inspection-consumer.mjs';
const $ = id => document.getElementById(id);
const referenceLabels = { edit_action_id: 'Saved edit action', inspection_action_id: 'Separate inspection action',
  brief_id: 'Brief', design_version_id: 'Saved design version', artifact_hash: 'Exact artwork hash' };
let inputs;
function show(focus = false) {
  try {
    const view = projectInspectionPresentation(inputs.cases[$('scenario').value].input);
    const failure = ['failed', 'unavailable'].includes(view.status);
    $('inspection-status').textContent = failure ? 'Saved artwork retained. Inspection requires attention.' : view.message;
    $('inspection-error').hidden = !failure; $('inspection-error').textContent = failure ? view.message : '';
    $('inspection-usage').textContent = view.usage_message; $('inspection-hold').textContent = view.hold_message;
    $('inspection-authority').textContent = view.authority_message; $('inspection-retry').textContent = view.retry_message;
    $('inspection-refs').replaceChildren();
    for (const [key, value] of Object.entries(view.references)) {
      const term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = referenceLabels[key]; detail.textContent = value; $('inspection-refs').append(term, detail);
    }
    if (focus) $(failure ? 'inspection-error' : 'inspection-status').focus();
  } catch {
    $('inspection-status').textContent = ''; $('inspection-refs').replaceChildren();
    for (const id of ['inspection-usage', 'inspection-hold', 'inspection-authority', 'inspection-retry']) $(id).textContent = '';
    $('inspection-error').hidden = false; $('inspection-error').textContent = 'Inspection presentation unavailable. Saved artwork status is unchanged.';
    if (focus) $('inspection-error').focus();
  }
}
try {
  const response = await fetch('/inspection-inputs.json');
  if (!response.ok) throw new Error('Unavailable');
  inputs = await response.json();
  for (const [key, fixture] of Object.entries(inputs.cases)) {
    // Only locally fixed labels are used; fixture prose is never rendered.
    const labels = { pending: 'Pending', acceptable: 'Ready for review', recommended: 'Repair recommendation', human: 'Human review',
      refused: 'Refusal', failure: 'Report failure', unavailable: 'Unavailable', failed: 'Inspection failed' };
    if (!Object.hasOwn(labels, key)) continue;
    const option = document.createElement('option'); option.value = key; option.textContent = labels[key]; $('scenario').append(option);
  }
  $('scenario').addEventListener('change', () => show(true)); show();
} catch { $('inspection-error').hidden = false; $('inspection-error').textContent = 'Inspection presentation unavailable. Saved artwork status is unchanged.'; }
