const policies = new WeakMap();
const requests = new WeakMap();

function deny() {
  return new Error('trusted action policy unavailable');
}

function opaque() {
  return Object.freeze(Object.create(null));
}

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function capabilitySet(values) {
  if (!Array.isArray(values) && !(values instanceof Set)) throw new TypeError('capability list required');
  const copy = [...values];
  if (copy.some((item) => typeof item !== 'string' || item.length === 0 || item.length > 128 || !isWellFormed(item))) {
    throw new TypeError('non-empty capability names required');
  }
  return new Set(copy);
}

export function createTrustedActionPolicy({
  allowedCapabilities,
  maxBillableUnits,
  approvalRequiredCapabilities = [],
  approvedCapabilities = [],
} = {}) {
  const allowed = capabilitySet(allowedCapabilities);
  const required = capabilitySet(approvalRequiredCapabilities);
  const approved = capabilitySet(approvedCapabilities);
  if (!Number.isSafeInteger(maxBillableUnits) || maxBillableUnits < 0) throw new TypeError('non-negative billable-unit limit required');
  if ([...required, ...approved].some((capability) => !allowed.has(capability))) throw new TypeError('approval capabilities must also be allowed');
  const policy = opaque();
  policies.set(policy, Object.freeze({ allowed, required, approved, maxBillableUnits }));
  return policy;
}

export function createActionRequest(capability, billableUnits = 0) {
  if (typeof capability !== 'string' || capability.length === 0 || capability.length > 128 || !isWellFormed(capability)) {
    throw new TypeError('action capability required');
  }
  if (!Number.isSafeInteger(billableUnits) || billableUnits < 0) throw new TypeError('non-negative billable units required');
  const request = opaque();
  requests.set(request, Object.freeze({ capability, billableUnits }));
  return request;
}

export function authorizeAction(policy, request) {
  const trustedPolicy = policies.get(policy);
  const action = requests.get(request);
  if (!trustedPolicy || !action) throw deny();
  let denialReason = null;
  if (!trustedPolicy.allowed.has(action.capability)) denialReason = 'capability_not_allowed';
  else if (action.billableUnits > trustedPolicy.maxBillableUnits) denialReason = 'budget_limit_exceeded';
  else if (trustedPolicy.required.has(action.capability) && !trustedPolicy.approved.has(action.capability)) denialReason = 'approval_not_valid';
  return Object.freeze({ allowed: denialReason === null, denialReason });
}

export function optionalInjectionSignal(text, classifier) {
  if (typeof text !== 'string' || typeof classifier !== 'function') return null;
  try {
    const result = classifier(text);
    return typeof result === 'boolean' ? result : null;
  } catch {
    return null;
  }
}
