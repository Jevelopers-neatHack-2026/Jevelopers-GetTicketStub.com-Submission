/** Outcome wording shared by the browser and actual local API fixture checks. */
const messages = {
  validation: 'Invalid Apply request. Refresh controls and review the draft before applying.',
  unknown_field: 'Unsupported action fields. Refresh controls before applying.',
  invalid_intent: 'Unsupported action. Only explicit Apply changes are allowed.',
  unsupported_version: 'Unsupported controls version. Refresh controls before applying.',
  stale_version: 'These controls are stale. Refresh controls and review the current version before applying.',
  stale_schema: 'These controls have changed. Refresh controls and review the current options before applying.',
  permission: 'Permission denied. The application must provide current authorized project access.',
  invalid_value: 'Unsupported selection. Refresh controls and choose an allowed option.',
  locked: 'This field is locked. Refresh controls to review the current locks.',
  unknown_control: 'Unknown control. Refresh controls before applying.',
  unavailable: 'Apply outcome unavailable. An attempt may have been dispatched, and a reservation may remain held. Check the existing operation before retrying.',
  failed: 'Apply failed. An attempt may have been dispatched. Check the existing operation and usage evidence before retrying.',
  action_conflict: 'This Apply identity belongs to a different draft. Make a new selection before applying.',
  conflict: 'Another operation is pending. Resolve it before applying another draft.',
  cancelled: 'This operation is cancelled. It cannot be handed off.',
};
export function applyErrorMessage(data) {
  const code = data?.code;
  if (code === 'unavailable' && !data.backend_error &&
      ['creative.composition.consume/1', 'creative.compound.consume/1'].includes(data.pending_bridge)) {
    return 'Handoff unavailable. Required composition integration is pending; this action did not dispatch an image or reserve funds.';
  }
  // Only recognized string codes select local text. Never coerce or render an
  // unknown upstream value or backend message, including prototype names.
  return typeof code === 'string' && Object.hasOwn(messages, code) ? messages[code] :
    'Apply did not complete. Dispatch and reservation status are not confirmed here. Check the existing operation before retrying.';
}


// History reads and selection changes have their own recovery instructions.
// Render only fixed local text, never a backend error message or unknown code.
const historyMessages = {
  stale_version: 'Saved selection is stale. Refresh controls and review the current version before restoring.',
  stale_schema: 'Saved version context has changed. Refresh controls and review current versions.',
  permission: 'Permission denied. Refresh controls and confirm current authorized project access before comparing or restoring saved versions.',
  permission_denied: 'Permission denied. Refresh controls and confirm current authorized project access before comparing or restoring saved versions.',
  not_found: 'Saved version is unavailable. Refresh controls and choose a current saved version.',
};
export function historyErrorMessage(data) {
  const code = data.error?.code;
  return Object.hasOwn(historyMessages, code) ? historyMessages[code] :
    'Version operation did not complete. Refresh controls and review current versions and access before retrying.';
}
