import { types as utilTypes } from 'node:util';
import { createHash } from 'node:crypto';
import { addAbortListener } from 'node:events';
import { AccessPreflightError } from './access.mjs';
import { canonicalHash } from '../contracts/validation.mjs';

// CE-A01 provider-metadata adapter for the OpenRouter Images target. It performs only the two documented
// non-billable reads through an injected fetch: GET /api/v1/key (authentication) and the public image-model
// endpoint catalog. Neither read is entitlement: operation permission and quota are always reported UNKNOWN and
// must come from the separately injected capability verifier. Nothing here reads the environment, selects a
// model, follows redirects, or retries. Billable dispatch is supplied by the trusted host composition.
//
// `model_listing: 'listed'` means only that the catalog lists the pinned provider tag for the pinned model. It is not a
// profile match: prices, supported parameters and capabilities may differ from what the owner approved. A host that
// wants that comparison pins `catalog_entry_sha256` in the target configuration (the hash this module computes over
// the live entry's provider_tag, supported_parameters and pricing); a differing live entry then reports 'unknown'.
//
// Billable path obligations. With a `dispatchPort`, this module resolves the credential itself (purpose
// authorized_billable_operation, bound to the grant and the exact target, valid through the operation deadline)
// before the port runs, and passes it as `credential`. The host port must still: send exactly one request using only
// that credential, enforce the pinned provider tag / no fallbacks / the pinned profile, honor the abort `signal`
// combining runner cancellation with the bounded deadline, run the metering fence calls (recordTransportAttempt, authorizeTransport,
// assertTransportReady) in order, and never log or return the token. The credential is never placed in the
// prepared value the runner sees.
// The host must also verify that the rendered prompt matches the pinned prompt hash and, for edits, that the source
// asset bytes and media type match the pinned asset hash and MIME type; this adapter does not receive those bytes.
// Every clock read must be finite and fails closed before credential, fetch, or host-port work.

export const OPENROUTER_PREFLIGHT_SERVICE = 'openrouter';
export const OPENROUTER_PREFLIGHT_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';
export const OPENROUTER_PREFLIGHT_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';
const CATALOG_PREFIX = 'https://openrouter.ai/api/v1/images/models/';
const MODEL_ID = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;
const PROVIDER_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const hashString = (value) => typeof value === 'string' && HASH.test(value);
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 15_000;
const BILLABLE_TIMEOUT_MAX_MS = 120_000;
// Native signals need own data state and proxy-free prototypes. The native getter alone accepts
// inherited-state facades; public `aborted` shadows must not hide cancellation.
const nativeAbortSignalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;

function error(code, message) {
  return new AccessPreflightError(code, message);
}

function readClock(now) {
  let value;
  try { value = now(); } catch { value = undefined; }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw error('adapter_unavailable', 'The clock option must return a finite number of milliseconds.');
  }
  return value;
}

function remainingUntil(deadlineAt, now) {
  const remaining = Date.parse(deadlineAt) - readClock(now);
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw error('preflight_deadline_passed', 'The approved operation deadline has passed.');
  }
  return remaining;
}

function nativeAbortSignalState(value) {
  if (value === null || typeof value !== 'object') return undefined;
  try {
    // isProxy itself invokes no traps. Check every node before reflecting on it: Object.create(proxy)
    // is not a Proxy, but Node's getter otherwise follows that hostile prototype for its state reads.
    const prototypes = [];
    for (let current = value; current !== null; current = Object.getPrototypeOf(current)) {
      if (utilTypes.isProxy(current)) return undefined;
      if (current !== value) prototypes.push(current);
    }
    // Node's getter reads JS storage rather than an unspoofable private slot. Give it our own receiver,
    // forwarding only the candidate's own data descriptors, never inherited values or caller accessors.
    // The getter selects its opaque keys; no Node-private symbol name is part of this adapter's contract.
    const readKeys = new Set();
    const receiver = new Proxy(value, { get(target, key) {
      readKeys.add(key);
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    } });
    const aborted = nativeAbortSignalAborted?.call(receiver);
    if (typeof aborted !== 'boolean') return undefined;
    // A facade may shadow copied state while still inheriting a real signal. Native state must belong
    // to this receiver alone; ordinary subclass prototypes carry methods, not another signal's storage.
    for (const prototype of prototypes) {
      for (const key of readKeys) if (Object.hasOwn(prototype, key)) return undefined;
    }
    return aborted;
  } catch {
    return undefined;
  }
}

function isNativeAbortSignal(value) {
  return nativeAbortSignalState(value) !== undefined;
}

function runnerCancellationSignal(input) {
  let signal;
  try {
    const metering = input.metering;
    if (!metering || typeof metering !== 'object' || Array.isArray(metering)) {
      throw new TypeError('invalid metering context');
    }
    signal = metering.signal;
  } catch {
    throw error('invalid_abort_signal', 'Billable dispatch requires a native runner cancellation signal.');
  }
  if (!isNativeAbortSignal(signal)) {
    throw error('invalid_abort_signal', 'Billable dispatch requires a native runner cancellation signal.');
  }
  return signal;
}

function assertTransportSignalCurrent(deadlineAt, callerSignal, signal, now) {
  // Timers cannot abort while a synchronous caller getter is running. Read the finite clock after
  // callbacks, then recheck cancellation in case this injected clock also aborted the operation.
  remainingUntil(deadlineAt, now);
  const callerAborted = nativeAbortSignalState(callerSignal);
  const transportAborted = nativeAbortSignalState(signal);
  if (callerAborted === undefined || transportAborted === undefined) {
    throw error('invalid_abort_signal', 'The runner cancellation signal is not a native AbortSignal.');
  }
  if (callerAborted || transportAborted) {
    throw error('preflight_deadline_passed', 'Cancellation or the approved operation deadline stopped dispatch.');
  }
}

function boundedTransportSignal(deadlineAt, callerSignal, now) {
  const callerAbortedBeforeComposition = nativeAbortSignalState(callerSignal);
  if (callerAbortedBeforeComposition === undefined) {
    throw error('invalid_abort_signal', 'A native runner cancellation signal is required for billable dispatch.');
  }
  if (callerAbortedBeforeComposition) {
    throw error('preflight_deadline_passed', 'Cancellation or the approved operation deadline stopped dispatch.');
  }
  const remaining = remainingUntil(deadlineAt, now);
  const deadlineSignal = AbortSignal.timeout(Math.min(Math.max(1, Math.ceil(remaining)), BILLABLE_TIMEOUT_MAX_MS));
  let signal;
  try {
    signal = AbortSignal.any([callerSignal, deadlineSignal]);
    // Some supported Node runtimes follow composite sources lazily. Observe our own
    // signal now so native cancellation remains visible despite public caller shadows,
    // including after the host returns without installing its own abort listener.
    // The one-shot observation ends at caller cancellation or the bounded deadline.
    addAbortListener(signal, () => {});
  }
  catch { throw error('invalid_abort_signal', 'The runner cancellation signal is not a native AbortSignal.'); }
  assertTransportSignalCurrent(deadlineAt, callerSignal, signal, now);
  return signal;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function targetBinding(target, scope) {
  return {
    service: target.service,
    endpoint: target.endpoint,
    model: target.model,
    sdk_name: target.sdk.name,
    sdk_version: target.sdk.version,
    configuration_sha256: target.configuration_sha256,
    account_ref: scope.account_ref,
    project_ref: scope.project_ref,
  };
}

function capturePrepareBinding(input) {
  let cellId;
  let sourceTarget;
  let targetHash;
  let target;
  let scope;
  let grantRef;
  let deadlineAt;
  let hasConfiguration;
  let configurationHash;
  let pinnedConfigurationHash;
  try {
    cellId = input.cell_id;
    sourceTarget = input.target;
    const sourceScope = input.scope;
    if (!isRecord(sourceScope)) throw new TypeError('scope');
    const scopeValues = {
      tenant_id: sourceScope.tenant_id,
      project_id: sourceScope.project_id,
      budget_scope_id: sourceScope.budget_scope_id,
      account_ref: sourceScope.account_ref,
      project_ref: sourceScope.project_ref,
    };
    if (Object.values(scopeValues).some((value) => typeof value !== 'string' || !SAFE_REF.test(value))) {
      throw new TypeError('scope references');
    }
    scope = deepFreeze(structuredClone({ ...sourceScope, ...scopeValues }));
    grantRef = input.grant_ref;
    deadlineAt = input.deadline_at;
    hasConfiguration = Object.hasOwn(input, 'configuration');
    if (hasConfiguration) configurationHash = canonicalHash(input.configuration);
  } catch {
    throw error('credential_unavailable', 'Billable preparation bindings could not be captured safely.');
  }
  try {
    // Bind exactly the fields validated and consumed by this adapter. Unread target annotations must not affect
    // authorization, while every field that can change the provider request remains part of the digest.
    targetHash = targetContentDigest(cellId, sourceTarget);
    target = freezeTargetCopy(cellId, sourceTarget, targetHash);
    pinnedConfigurationHash = canonicalHash(target.configuration);
  } catch (cause) {
    if (cause instanceof AccessPreflightError) throw cause;
    throw error('unsupported_image_configuration', 'OpenRouter target must be a canonical JSON pin.');
  }
  if (hasConfiguration && configurationHash !== pinnedConfigurationHash) {
    throw error('credential_unavailable', 'Billable configuration does not match the pinned target configuration.');
  }
  let hostExtras;
  let authorizationHash;
  const hasAuthorization = Object.hasOwn(input, 'authorization_evidence');
  try {
    const { target: liveTarget, scope: liveScope, configuration: liveConfiguration, signal: callerSignal, ...extras } = input;
    hostExtras = deepFreeze(structuredClone(extras));
    authorizationHash = canonicalHash(hostExtras.authorization_evidence ?? null);
    if (canonicalHash(input.authorization_evidence ?? null) !== authorizationHash) throw new TypeError('evidence copy');
  } catch {
    throw error('credential_unavailable', 'Billable preparation evidence could not be copied safely.');
  }
  const matchesTarget = (candidate) => {
    try {
      if (!isRecord(candidate)) return false;
      const cell = candidate.cell_id;
      const currentTarget = candidate.target;
      return targetContentDigest(cell, currentTarget) === targetHash;
    }
    catch { return false; }
  };
  const matches = (candidate) => {
    try {
      if (!isRecord(candidate)) return false;
      const currentCell = candidate.cell_id;
      const currentGrant = candidate.grant_ref;
      const currentDeadline = candidate.deadline_at;
      const currentScope = candidate.scope;
      const currentHasConfiguration = Object.hasOwn(candidate, 'configuration');
      const currentConfiguration = currentHasConfiguration ? candidate.configuration : undefined;
      const currentTarget = candidate.target;
      if (!isRecord(currentScope)) return false;
      const currentScopeValues = {
        tenant_id: currentScope.tenant_id,
        project_id: currentScope.project_id,
        budget_scope_id: currentScope.budget_scope_id,
        account_ref: currentScope.account_ref,
        project_ref: currentScope.project_ref,
      };
      return currentCell === cellId
        && currentGrant === grantRef
        && currentDeadline === deadlineAt
        && currentScopeValues.tenant_id === scope.tenant_id
        && currentScopeValues.project_id === scope.project_id
        && currentScopeValues.budget_scope_id === scope.budget_scope_id
        && currentScopeValues.account_ref === scope.account_ref
        && currentScopeValues.project_ref === scope.project_ref
        && Object.hasOwn(candidate, 'authorization_evidence') === hasAuthorization
        && canonicalHash(candidate.authorization_evidence ?? null) === authorizationHash
        && currentHasConfiguration === hasConfiguration
        && (!hasConfiguration || canonicalHash(currentConfiguration) === pinnedConfigurationHash)
        && targetContentDigest(currentCell, currentTarget) === targetHash;
    } catch { return false; }
  };
  const hostInput = Object.freeze({ ...hostExtras, cell_id: cellId, target, scope, grant_ref: grantRef, deadline_at: deadlineAt,
    ...(Object.hasOwn(input, 'configuration') ? { configuration: target.configuration } : {}) });
  return { cellId, sourceTarget, target, targetHash, scope, grantRef, deadlineAt, hasConfiguration,
    pinnedConfigurationHash, matches, matchesTarget, hostInput, authorizationHash, hasAuthorization };
}

/** The catalog URL for an explicit author/slug model id. Segments are encoded; nothing else is interpolated. */
export function openRouterCatalogEndpoint(modelId) {
  const match = typeof modelId === 'string' ? MODEL_ID.exec(modelId) : null;
  if (!match) throw error('unsupported_image_configuration', 'OpenRouter model id must be an explicit author/slug.');
  return `${CATALOG_PREFIX}${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}/endpoints`;
}

/**
 * Validate that a preflight target is an exact OpenRouter Images pin for one of the two image cells.
 * Generation and edit remain separate cells: edit alone carries the pinned source asset, and the pinned
 * profile hash is the owner-approved digest of the exact adapter profile (model, provider tag, capabilities,
 * descriptors, configuration). Nothing is defaulted.
 */
export function validateOpenRouterImageTarget(cellId, target) {
  if (cellId !== 'image_generation' && cellId !== 'image_edit') {
    throw error('unsupported_image_configuration', 'OpenRouter image targets exist only for the two image cells.');
  }
  if (!target || target.service !== OPENROUTER_PREFLIGHT_SERVICE || target.sdk?.name !== 'native-fetch'
    || target.sdk?.version !== process.versions.node) {
    throw error('unsupported_image_configuration', 'OpenRouter image preflight requires service openrouter and the actual pinned Node native-fetch runtime version.');
  }
  if (target.endpoint !== OPENROUTER_PREFLIGHT_IMAGES_ENDPOINT || typeof target.model !== 'string' || !MODEL_ID.test(target.model)) {
    throw error('unsupported_image_configuration', 'OpenRouter endpoint and explicit author/slug model must match the pin.');
  }
  const config = target.configuration;
  const required = ['prompt_template_ref', 'prompt_template_sha256', 'provider_tag', 'profile_sha256',
    ...(cellId === 'image_edit' ? ['asset_ref', 'asset_sha256', 'asset_mime'] : [])];
  // Optional pin of the expected live catalog entry (see the header). It is part of the configuration, so the
  // target's canonical configuration hash binds it.
  const allowed = [...required, 'catalog_entry_sha256'];
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(config, key))
    || typeof config.prompt_template_ref !== 'string' || !ID.test(config.prompt_template_ref)
    || !hashString(config.prompt_template_sha256) || !hashString(config.profile_sha256)
    || (Object.hasOwn(config, 'catalog_entry_sha256') && !hashString(config.catalog_entry_sha256))
    || typeof config.provider_tag !== 'string' || !PROVIDER_TAG.test(config.provider_tag)) {
    throw error('unsupported_image_configuration', 'OpenRouter configuration must pin the prompt, provider tag, and profile hash for exactly this cell.');
  }
  if (cellId === 'image_edit' && (typeof config.asset_ref !== 'string' || !ID.test(config.asset_ref)
    || !hashString(config.asset_sha256) || !['image/png', 'image/jpeg', 'image/webp'].includes(config.asset_mime))) {
    throw error('unsupported_image_configuration', 'Edit requires a pinned reference asset reference, digest, and image media type.');
  }
}

/**
 * Re-validates a target and returns a canonical digest over exactly the fields the binding uses. Dispatch accepts a
 * separately allocated target with the same canonical contents; the source object reference is retained only to
 * consume prepared state if that original object is later mutated. Fields the validator and binding never read are
 * not hashed; anything that cannot be validated or hashed fails closed.
 */
function targetContentDigest(cellId, target) {
  try {
    validateOpenRouterImageTarget(cellId, target);
    return canonicalHash({ service: target.service, endpoint: target.endpoint, model: target.model,
      sdk: { name: target.sdk.name, version: target.sdk.version }, configuration: target.configuration,
      configuration_sha256: target.configuration_sha256 });
  } catch {
    throw error('unsupported_image_configuration', 'The OpenRouter image target changed or cannot be canonically hashed.');
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

/**
 * The host never receives the caller's live target: it gets a deep-frozen structured clone, so a caller mutating its
 * object while the host awaits (and restoring it before the digest check) cannot change what the host acts on. The
 * clone keeps non-JSON extra fields (Date, NaN, undefined); a target holding something structuredClone cannot copy
 * (a function, a symbol value) fails closed, and so does a clone whose binding digest differs from the original's.
 */
function freezeTargetCopy(cellId, target, digestOfTarget) {
  let copy;
  try {
    copy = deepFreeze(structuredClone(target));
    if (targetContentDigest(cellId, copy) !== digestOfTarget) throw new TypeError('target copy');
  } catch {
    throw error('unsupported_image_configuration', 'The OpenRouter image target cannot be copied for the host port.');
  }
  return copy;
}

function safeCredentialEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.ref !== 'string' || !SAFE_REF.test(value.ref)
    || typeof value.sha256 !== 'string' || !HASH.test(value.sha256)
    || typeof value.pinned_revision !== 'string' || !SAFE_REF.test(value.pinned_revision)
    || !value.independent_review || typeof value.independent_review.ref !== 'string'
    || !SAFE_REF.test(value.independent_review.ref) || typeof value.independent_review.sha256 !== 'string'
    || !HASH.test(value.independent_review.sha256)) {
    throw error('credential_unavailable', 'Credential identity evidence is not independently pinned.');
  }
}

function snapshotCredentialResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw error('credential_unavailable', 'Trusted credential resolver did not return a response object.');
  }
  const decision = value.decision;
  const evidenceMode = value.evidence_mode;
  if (decision !== 'resolved' || evidenceMode !== 'live') {
    throw error('credential_unavailable', 'Trusted credential resolver did not confirm this provider scope.');
  }
  // Capture each resolver-owned field once. Only these captured scalars and copied nested records
  // are validated or used after callback-capable evidence/clock reads; never freeze the port's object.
  const token = value.token;
  const expiresAt = value.expires_at;
  const sourceBinding = value.binding;
  const sourceEvidence = value.evidence;
  if (!sourceBinding || typeof sourceBinding !== 'object' || Array.isArray(sourceBinding)
    || !sourceEvidence || typeof sourceEvidence !== 'object' || Array.isArray(sourceEvidence)) {
    throw error('credential_unavailable', 'Credential binding and pinned evidence must be response records.');
  }
  const bindingFields = Object.freeze(Object.keys(sourceBinding));
  const binding = Object.freeze({ service: sourceBinding.service, account_ref: sourceBinding.account_ref,
    project_ref: sourceBinding.project_ref, target_binding_sha256: sourceBinding.target_binding_sha256,
    grant_ref: sourceBinding.grant_ref });
  const sourceReview = sourceEvidence.independent_review;
  if (!sourceReview || typeof sourceReview !== 'object' || Array.isArray(sourceReview)) {
    throw error('credential_unavailable', 'Credential evidence must include an independent review.');
  }
  const evidence = Object.freeze({ ref: sourceEvidence.ref, sha256: sourceEvidence.sha256,
    pinned_revision: sourceEvidence.pinned_revision,
    independent_review: Object.freeze({ ref: sourceReview.ref, sha256: sourceReview.sha256 }) });
  return Object.freeze({ decision, evidence_mode: evidenceMode, token, expires_at: expiresAt,
    binding, binding_fields: bindingFields, evidence });
}

async function resolveCredential(credentialPort, { purpose = 'read_only_account_check', scope, target, grantRef, deadlineAt, now }) {
  try {
    if (!SAFE_REF.test(scope.account_ref) || !SAFE_REF.test(scope.project_ref)) {
      throw error('credential_unavailable', 'Provider account and project references must be safe opaque IDs.');
    }
    const binding = Object.freeze(targetBinding(target, scope));
    const expectedBindingHash = digest(Buffer.from(JSON.stringify(binding), 'utf8'));
    const request = Object.freeze({
      service: OPENROUTER_PREFLIGHT_SERVICE,
      purpose,
      account_ref: scope.account_ref,
      project_ref: scope.project_ref,
      target_binding: binding,
      ...(grantRef ? { grant_ref: grantRef } : {}),
    });
    const resolved = snapshotCredentialResponse(await credentialPort.resolveCredential(request));
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)
      || resolved.decision !== 'resolved' || resolved.evidence_mode !== 'live') {
      throw error('credential_unavailable', 'Trusted credential resolver did not confirm this provider scope.');
    }
    const allowedBindingFields = ['service', 'account_ref', 'project_ref', 'target_binding_sha256', ...(grantRef ? ['grant_ref'] : [])];
    if (!resolved.binding || resolved.binding_fields.some((key) => !allowedBindingFields.includes(key))
      || resolved.binding.service !== OPENROUTER_PREFLIGHT_SERVICE
      || resolved.binding.account_ref !== scope.account_ref || resolved.binding.project_ref !== scope.project_ref
      || resolved.binding.target_binding_sha256 !== expectedBindingHash
      || (grantRef && resolved.binding.grant_ref !== grantRef)) {
      throw error('credential_unavailable', 'Credential identity does not match the requested provider account and project.');
    }
    if (typeof resolved.token !== 'string' || resolved.token.trim().length === 0 || /[\r\n]/.test(resolved.token)) {
      throw error('credential_unavailable', 'Trusted credential resolver did not return a usable bearer token.');
    }
    safeCredentialEvidence(resolved.evidence);
    const checkedAt = readClock(now);
    const expiresAt = Date.parse(resolved.expires_at);
    const deadline = deadlineAt ? Date.parse(deadlineAt) : undefined;
    if (deadlineAt && (!Number.isFinite(deadline) || deadline <= checkedAt)) {
      throw error('preflight_deadline_passed', 'The approved operation deadline passed during credential resolution.');
    }
    if (typeof resolved.expires_at !== 'string' || !Number.isFinite(expiresAt)
      || expiresAt <= checkedAt || (deadlineAt && expiresAt < deadline)) {
      throw error('credential_unavailable', 'Scoped credential is expired or will not remain valid through the operation deadline.');
    }
    return resolved.token;
  } catch (cause) {
    if (cause instanceof AccessPreflightError && ['adapter_unavailable', 'preflight_deadline_passed'].includes(cause.code)) throw cause;
    throw error('credential_unavailable', 'Credential provider did not return a usable access token.');
  }
}

async function boundedJson(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_METADATA_BYTES) {
    try { await response.body?.cancel(); } catch { /* nothing provider-specific leaves the adapter */ }
    return undefined;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return undefined;
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > MAX_METADATA_BYTES) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Authentication result of the non-billable key read. Balance, limits and usage are never retained. */
function mapKeyStatus(status) {
  if (status === 200) return 'confirmed';
  if (status === 401) return 'denied';
  return 'unknown';
}

function catalogEntries(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (isRecord(data) && Array.isArray(data.endpoints)) return data.endpoints;
  if (Array.isArray(payload?.endpoints)) return payload.endpoints;
  return undefined;
}

async function metadataFetch(fetchImpl, url, headers) {
  return fetchImpl(url, {
    method: 'GET',
    headers,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
  });
}

/**
 * OpenRouter Images access adapter. `fetchImpl` is required (no global default) and `credentialPort` must be a
 * trusted account/project-bound resolver. `inspect` is the only built-in operation; `prepare` and `dispatch`
 * exist only if the host passes a trusted `dispatchPort` that performs the one authorized billable request, so
 * this module never sends a paid request by itself. The built-in catalog check is not entitlement.
 */
export function createOpenRouterImagesAdapter({ credentialPort, fetchImpl, dispatchPort, now = Date.now }) {
  if (typeof now !== 'function') {
    throw error('adapter_unavailable', 'The clock option must be a function returning a finite number of milliseconds.');
  }
  readClock(now);
  if (!credentialPort || credentialPort.evidence_mode !== 'live' || typeof credentialPort.resolveCredential !== 'function') {
    throw error('credential_unavailable', 'A trusted account/project-bound credential resolver is required.');
  }
  if (typeof fetchImpl !== 'function') {
    throw error('adapter_unavailable', 'An explicit fetch implementation is required; no global transport is used.');
  }
  if (dispatchPort !== undefined && (!dispatchPort || typeof dispatchPort.dispatch !== 'function'
    || (dispatchPort.prepare !== undefined && typeof dispatchPort.prepare !== 'function'))) {
    throw error('adapter_unavailable', 'The billable dispatch port must provide dispatch and optionally prepare.');
  }
  const adapter = {
    evidence_mode: 'live',

    async inspect({ run_id, cell_id, target, scope }) {
      validateOpenRouterImageTarget(cell_id, target);
      readClock(now);
      const token = await resolveCredential(credentialPort, { scope, target, now }).catch((cause) => {
        if (cause instanceof AccessPreflightError && cause.code === 'adapter_unavailable') throw cause;
        throw error('credential_unavailable', 'Read-only account authentication could not be checked.');
      });
      const catalogUrl = openRouterCatalogEndpoint(target.model);
      let keyStatus;
      let catalogStatus;
      let catalogPayload;
      try {
        const keyResponse = await metadataFetch(fetchImpl, OPENROUTER_PREFLIGHT_KEY_ENDPOINT,
          { authorization: `Bearer ${token}`, accept: 'application/json' });
        keyStatus = keyResponse.status;
        if (keyResponse.ok) {
          // Only the documented object shape is checked; limit, remaining credit, and usage are not retained.
          const keyPayload = await boundedJson(keyResponse);
          if (!isRecord(keyPayload?.data)) keyStatus = 0;
        } else {
          try { await keyResponse.body?.cancel(); } catch { /* ignore */ }
        }
        // The catalog is public: the bearer token is deliberately not sent to it.
        const catalogResponse = await metadataFetch(fetchImpl, catalogUrl, { accept: 'application/json' });
        catalogStatus = catalogResponse.status;
        if (catalogResponse.ok) catalogPayload = await boundedJson(catalogResponse);
        else { try { await catalogResponse.body?.cancel(); } catch { /* ignore */ } }
      } catch {
        throw error('access_probe_unavailable', 'Read-only provider access check failed.');
      }
      const authentication = mapKeyStatus(keyStatus);
      let modelListing = 'unknown';
      let catalogEntryDigest = null;
      let listingReason;
      if (catalogStatus === 200) {
        const entries = catalogEntries(catalogPayload);
        if (entries) {
          const entry = entries.find((candidate) => isRecord(candidate) && candidate.provider_tag === target.configuration.provider_tag);
          modelListing = entry ? 'listed' : 'not_listed';
          if (entry) {
            try {
              catalogEntryDigest = canonicalHash({ provider_tag: entry.provider_tag,
                supported_parameters: entry.supported_parameters ?? null, pricing: entry.pricing ?? null });
            } catch { catalogEntryDigest = null; }
            // A pinned entry hash upgrades 'listed' from tag presence to an exact comparison; any difference (or an
            // entry that cannot be hashed) fails closed as 'unknown', never as 'listed'.
            const expectedEntry = target.configuration.catalog_entry_sha256;
            if (expectedEntry !== undefined && catalogEntryDigest !== expectedEntry) {
              modelListing = 'unknown';
              listingReason = 'catalog_entry_mismatch';
            }
          }
        }
      } else if (catalogStatus === 404) {
        modelListing = 'not_listed';
      }
      const binding = targetBinding(target, scope);
      return {
        evidence_mode: 'live',
        target: binding,
        authentication,
        model_listing: modelListing,
        // Catalog presence and a valid key are not entitlement: only the capability verifier can establish these.
        operation_permission: 'unknown',
        quota: 'unknown',
        checked_at: new Date(readClock(now)).toISOString(),
        evidence: {
          ref: `${run_id}:${cell_id}:openrouter-key-and-catalog`,
          sha256: digest(Buffer.from(JSON.stringify({ key_status: keyStatus, catalog_status: catalogStatus,
            model_listing: modelListing, catalog_entry_sha256: catalogEntryDigest, cell_id, target: binding,
            ...(listingReason ? { listing_reason: listingReason } : {}) }), 'utf8')),
        },
      };
    },
  };
  if (dispatchPort) {
    // The runner passes `prepared` from prepare to dispatch. Only values this adapter minted are accepted, so a
    // dispatch cannot reach the host port without a credential that was resolved for this grant and deadline.
    const preparedState = new WeakMap();
    adapter.prepare = async (input) => {
      // Snapshot top-level getters once. Keep the original object only for the post-await binding fence: a caller
      // changing a credential-bearing value while resolution or host preparation is pending fails closed.
      let args;
      try {
        if (!isRecord(input)) throw new TypeError('input');
        args = { ...input };
      } catch {
        throw error('credential_unavailable', 'Billable preparation bindings could not be captured safely.');
      }
      const callerSignal = args.signal;
      const assertNotCancelled = () => {
        if (callerSignal === undefined) return;
        const state = nativeAbortSignalState(callerSignal);
        if (state === undefined) throw error('invalid_abort_signal', 'Preparation requires a genuine non-Proxy AbortSignal.');
        if (state) throw error('preflight_deadline_passed', 'Cancellation stopped billable preparation.');
      };
      assertNotCancelled();
      const binding = capturePrepareBinding(args);
      assertNotCancelled();
      if (typeof binding.grantRef !== 'string' || !SAFE_REF.test(binding.grantRef)
        || typeof binding.deadlineAt !== 'string' || !Number.isFinite(Date.parse(binding.deadlineAt))
        || Date.parse(binding.deadlineAt) <= readClock(now)) {
        throw error('credential_unavailable', 'A billable credential needs the authorized grant reference and an unexpired operation deadline.');
      }
      const hostTarget = binding.target;
      const hostInputValues = { ...binding.hostInput, target: hostTarget, scope: binding.scope };
      if (binding.hasConfiguration) hostInputValues.configuration = hostTarget.configuration;
      else delete hostInputValues.configuration;
      const hostInput = Object.freeze(hostInputValues);
      const assertBindingsUnchanged = () => {
        if (!binding.matches(input)) {
          if (!binding.matchesTarget(input)) {
            throw error('unsupported_image_configuration', 'The OpenRouter image target changed during billable preparation.');
          }
          throw error('credential_unavailable', 'Billable preparation bindings changed while an asynchronous operation was pending.');
        }
      };
      assertNotCancelled();
      assertBindingsUnchanged();
      assertNotCancelled();
      const token = await resolveCredential(credentialPort, { purpose: 'authorized_billable_operation', scope: binding.scope,
        target: hostTarget, grantRef: binding.grantRef, deadlineAt: binding.deadlineAt, now });
      assertNotCancelled();
      assertBindingsUnchanged();
      assertNotCancelled();
      // Credential lookup is asynchronous. Recheck the clock/deadline before handing its token to host preparation.
      remainingUntil(binding.deadlineAt, now);
      assertNotCancelled();
      const prepareHost = dispatchPort.prepare;
      assertNotCancelled();
      assertBindingsUnchanged();
      assertNotCancelled();
      // Host accessors and binding getters can consume the remaining deadline synchronously.
      // Fence their elapsed time before exposing credentials; the host receives only frozen snapshots.
      remainingUntil(binding.deadlineAt, now);
      assertNotCancelled();
      const credential = Object.freeze({ token });
      const hostPrepared = prepareHost
        ? await prepareHost.call(dispatchPort, Object.freeze({ ...hostInput, credential })) : undefined;
      assertNotCancelled();
      assertBindingsUnchanged();
      assertNotCancelled();
      // Host preparation is also asynchronous. Never mint a dispatchable value after the grant's deadline.
      remainingUntil(binding.deadlineAt, now);
      assertNotCancelled();
      assertBindingsUnchanged();
      assertNotCancelled();
      const prepared = Object.freeze({ prepared: true });
      preparedState.set(prepared, { cell_id: binding.cellId, source_target: binding.sourceTarget, target: hostTarget,
        target_hash: binding.targetHash, target_digest: binding.targetHash,
        has_configuration: binding.hasConfiguration, configuration_hash: binding.pinnedConfigurationHash,
        scope: binding.scope, grant_ref: binding.grantRef, deadline_at: binding.deadlineAt, credential, hostPrepared,
        authorization_evidence: binding.hostInput.authorization_evidence, authorization_hash: binding.authorizationHash,
        has_authorization: binding.hasAuthorization });
      return prepared;
    };
    adapter.dispatch = async (input) => {
      // A single shallow snapshot prevents enumerable getters from returning one value for validation and another
      // for the host. Nested binding values are separately copied below before any callback-capable signal access.
      let args;
      try {
        if (!isRecord(input)) throw new TypeError('input');
        args = { ...input };
      } catch {
        throw error('credential_unavailable', 'The dispatch input could not be read.');
      }
      const preparedValue = args.prepared;
      const state = isRecord(preparedValue) ? preparedState.get(preparedValue) : undefined;
      let targetDigest;
      try {
        validateOpenRouterImageTarget(args.cell_id, args.target);
        targetDigest = targetContentDigest(args.cell_id, args.target);
      } catch (cause) {
        if (state && args.target === state.source_target && !preparedState.delete(preparedValue)) {
          throw error('credential_unavailable', 'Prepared credentials were already consumed.');
        }
        if (cause instanceof AccessPreflightError) throw cause;
        throw error('unsupported_image_configuration', 'The OpenRouter image target changed or cannot be validated.');
      }
      if (!state) {
        throw error('credential_unavailable', 'Prepared credentials are not bound to this grant, deadline, scope, and target.');
      }
      if (targetDigest !== state.target_digest) {
        // A changed original target consumes its identity so restoring the object cannot replay prepared work. A
        // different supplied target remains a nondestructive binding mismatch.
        if (args.target === state.source_target && !preparedState.delete(preparedValue)) {
          throw error('credential_unavailable', 'Prepared credentials were already consumed.');
        }
        throw error('unsupported_image_configuration', 'The OpenRouter image target changed after it was prepared.');
      }
      let authorizationMatches = false;
      try {
        authorizationMatches = Object.hasOwn(args, 'authorization_evidence') === state.has_authorization
          && canonicalHash(args.authorization_evidence ?? null) === state.authorization_hash;
      } catch { /* unreadable authorization evidence fails closed */ }
      if (!authorizationMatches) throw error('credential_unavailable', 'Prepared authorization evidence changed.');
      let configurationMatches = false;
      try {
        configurationMatches = Object.hasOwn(args, 'configuration') === state.has_configuration
          && (!state.has_configuration || canonicalHash(args.configuration) === state.configuration_hash);
      } catch { /* an unreadable or noncanonical configuration fails the binding fence */ }
      if (!configurationMatches) {
        throw error('credential_unavailable', 'Prepared credentials are not bound to this configuration.');
      }
      let suppliedScope;
      try {
        const scope = args.scope;
        if (!isRecord(scope)) throw new TypeError('scope');
        suppliedScope = {
          tenant_id: scope.tenant_id,
          project_id: scope.project_id,
          budget_scope_id: scope.budget_scope_id,
          account_ref: scope.account_ref,
          project_ref: scope.project_ref,
        };
      } catch { suppliedScope = undefined; }
      if (state.cell_id !== args.cell_id || state.grant_ref !== args.grant_ref || state.deadline_at !== args.deadline_at
        || !suppliedScope || suppliedScope.tenant_id !== state.scope.tenant_id
        || suppliedScope.project_id !== state.scope.project_id || suppliedScope.budget_scope_id !== state.scope.budget_scope_id
        || suppliedScope.account_ref !== state.scope.account_ref || suppliedScope.project_ref !== state.scope.project_ref) {
        throw error('credential_unavailable', 'Prepared credentials are not bound to this grant, deadline, full trusted scope, and target.');
      }
      // Check native internal cancellation state before and after composition. The checked-delete below also closes
      // reentrant signal getters: only the call that successfully consumes this exact WeakMap key may dispatch.
      const callerSignal = runnerCancellationSignal(args);
      const signal = boundedTransportSignal(state.deadline_at, callerSignal, now);
      const dispatchHost = dispatchPort.dispatch;
      // A trusted port accessor can run code too; leave authority unconsumed until the final fence.
      assertTransportSignalCurrent(state.deadline_at, callerSignal, signal, now);
      if (!preparedState.delete(preparedValue)) {
        throw error('credential_unavailable', 'Prepared credentials were already consumed.');
      }
      const hostInput = { ...args, cell_id: state.cell_id, target: state.target, scope: state.scope,
        grant_ref: state.grant_ref, deadline_at: state.deadline_at, prepared: state.hostPrepared,
        credential: state.credential, signal };
      if (state.has_authorization) hostInput.authorization_evidence = state.authorization_evidence;
      else delete hostInput.authorization_evidence;
      if (state.has_configuration) hostInput.configuration = state.target.configuration;
      else delete hostInput.configuration;
      return Reflect.apply(dispatchHost, dispatchPort, [hostInput]);
    };
  } else {
    adapter.dispatch = async () => {
      throw error('adapter_unavailable', 'No trusted OpenRouter billable dispatch port was composed.');
    };
  }
  return Object.freeze(adapter);
}
