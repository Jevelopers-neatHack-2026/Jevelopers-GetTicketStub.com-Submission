import { createHash, randomUUID } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { createScopedReuseStore, getScopedReuseBindingPort } from '../../cache/reuse/store.mjs';
import { beginLocalBoundary, localBoundaryEffectiveNow } from '../../private/boundary-guard.mjs';
import { issueCorrectionCacheBindingCapability } from './cache-binding-capability.mjs';
import { createCorrectionHistoryStore, getCorrectionHistoryBindingPort, ReviewHistoryError } from './store.mjs';

const SCOPES = new WeakMap();
const DELAYS = Object.freeze([2, 4, 8, 12, 20, 30, 40]);
const MAX_OPERATION_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_JSON_DEPTH = 32;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

function fail(code) {
  throw new ReviewHistoryError(code);
}

function isRecord(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function ownRecord(value, allowed, required = []) {
  if (!isRecord(value)) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      output[key] = descriptor.value;
    }
    if (required.some((key) => !Object.hasOwn(output, key))) return null;
    return output;
  } catch { return null; }
}

function cloneJson(value, depth = 0, seen = new Set()) {
  if (depth > MAX_JSON_DEPTH) fail('REVIEW_INVALID');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || utilTypes.isProxy(value) || seen.has(value)) fail('REVIEW_INVALID');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
      const keys = Reflect.ownKeys(value);
      if (!Number.isSafeInteger(length) || length < 0 || length > 256 || keys.length !== length + 1 || !keys.includes('length')) fail('REVIEW_INVALID');
      const output = [];
      for (let i = 0; i < length; i += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('REVIEW_INVALID');
        output.push(cloneJson(descriptor.value, depth + 1, seen));
      }
      return Object.freeze(output);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail('REVIEW_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) fail('REVIEW_INVALID');
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('REVIEW_INVALID');
      output[key] = cloneJson(descriptor.value, depth + 1, seen);
    }
    return Object.freeze(output);
  } finally { seen.delete(value); }
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableEqual(left, right) {
  return canonical(left) === canonical(right);
}

function validString(value, maximum = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validSignal(signal) {
  if (signal === undefined) return;
  try {
    if (utilTypes.isProxy(signal)) fail('REVIEW_INVALID');
    if (!ABORTED_GETTER) fail('REVIEW_INVALID');
    Reflect.apply(ABORTED_GETTER, signal, []);
  } catch { fail('REVIEW_INVALID'); }
}

function createDeadline(signal, timeoutMs) {
  validSignal(signal);
  const controller = new AbortController();
  let closed = false;
  const abortFromCaller = () => controller.abort();
  if (signal !== undefined) {
    if (Reflect.apply(ABORTED_GETTER, signal, [])) controller.abort();
    else Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', abortFromCaller, { once: true }]);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (signal !== undefined) Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', abortFromCaller]);
    },
  };
}

function runBounded(task, signal, timeoutMs) {
  const deadline = createDeadline(signal, timeoutMs);
  let abortListener;
  const aborted = new Promise((resolve, reject) => {
    abortListener = () => reject(new ReviewHistoryError('REVIEW_ABORTED'));
    if (deadline.signal.aborted) abortListener();
    else deadline.signal.addEventListener('abort', abortListener, { once: true });
  });
  const work = Promise.resolve().then(() => task(deadline.signal));
  // A timed-out host callback may settle later. Keep the task's own cleanup attached;
  // every inner mutating path rechecks the aborted signal at its actual commit gate.
  work.then(() => deadline.close(), () => deadline.close()).catch(() => {});
  return Promise.race([work, aborted]).finally(() => {
    deadline.close();
    deadline.signal.removeEventListener('abort', abortListener);
  });
}

function sleepAbortable(delayMs, signal) {
  if (signal.aborted) return Promise.reject(new ReviewHistoryError('REVIEW_ABORTED'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new ReviewHistoryError('REVIEW_ABORTED'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

function cleanCacheInput(value) {
  const source = ownRecord(value, new Set([
    'identity', 'contentHash', 'pins', 'facts', 'observation', 'freshnessTtlMs', 'expiresAtMs',
  ]), ['identity', 'contentHash', 'pins', 'facts', 'observation']);
  if (!source) fail('REVIEW_INVALID');
  const clean = Object.create(null);
  for (const key of ['identity', 'contentHash', 'pins', 'facts', 'observation', 'freshnessTtlMs', 'expiresAtMs']) {
    if (Object.hasOwn(source, key)) clean[key] = cloneJson(source[key]);
  }
  return Object.freeze(clean);
}

function evidenceRefs(items) {
  if (!Array.isArray(items)) return Object.freeze([]);
  const refs = new Set();
  for (const item of items) {
    if (!item || typeof item.evidenceId !== 'string') continue;
    refs.add(item.evidenceId);
  }
  return Object.freeze([...refs].sort());
}

function projectedValue(value) {
  return typeof value === 'string' ? value : canonical(value);
}

function projectionCandidate(candidate) {
  return Object.freeze({
    status: candidate.originStatus,
    value: projectedValue(candidate.value),
    supportRefs: evidenceRefs(candidate.sourceEvidence),
  });
}

function projectHistory(snapshot) {
  const fields = Object.create(null);
  for (const fieldName of ['event_name', 'event_date', 'venue', 'event_status']) {
    const field = snapshot.fields[fieldName];
    if (!field) fail('REVIEW_INTEGRITY');
    const supportRefs = evidenceRefs(field.sourceEvidence ?? []);
    if (field.status === 'missing') {
      fields[fieldName] = Object.freeze({ status: 'missing', supportRefs });
    } else if (field.status === 'conflicting') {
      const candidates = field.candidates?.map(projectionCandidate);
      if (!candidates || candidates.length < 2) fail('REVIEW_INTEGRITY');
      fields[fieldName] = Object.freeze({ status: 'conflicting', candidates: Object.freeze(candidates) });
    } else if (field.status === 'customer_supplied') {
      if (!Object.hasOwn(field, 'value')) fail('REVIEW_INTEGRITY');
      const sourceCandidates = field.sourceCandidates?.map(projectionCandidate);
      fields[fieldName] = Object.freeze({
        status: 'customer_supplied',
        value: projectedValue(field.value),
        ...(supportRefs.length ? { supportRefs } : {}),
        ...(sourceCandidates?.length ? { candidates: Object.freeze(sourceCandidates) } : {}),
      });
    } else if (field.status === 'sourced' || field.status === 'inferred') {
      if (!Object.hasOwn(field, 'value')) fail('REVIEW_INTEGRITY');
      fields[fieldName] = Object.freeze({ status: field.status, value: projectedValue(field.value), supportRefs });
    } else fail('REVIEW_INTEGRITY');
  }
  return Object.freeze(fields);
}

function scopeRecord(scope) {
  const value = SCOPES.get(scope);
  if (!value) fail('REVIEW_DENIED');
  return value;
}

function bindingForCache(binding) {
  return Object.freeze({
    bindingId: binding.bindingId,
    eventId: binding.eventId,
    historyVersionId: binding.historyVersionId,
    historyContentHash: binding.historyContentHash,
    historyProjectionHash: binding.historyProjectionHash,
    operationId: binding.operationId,
    profileRef: binding.profileRef,
    cacheVersion: binding.cacheVersion,
    scopeKind: binding.scopeKind,
    cacheBindingHash: binding.cacheBindingHash,
    identity: binding.identity,
    pins: binding.pins,
    cacheSourceContentHash: binding.cacheSourceContentHash,
    cacheExpiresAtMs: binding.cacheExpiresAtMs,
    historyExpiresAtMs: binding.historyExpiresAtMs,
    expiresAtMs: binding.expiresAtMs,
  });
}

function isBusy(error) {
  return error?.code === 'REVIEW_BUSY' || error?.code === 'REUSE_BUSY';
}

function correctionResult(snapshot, replayed = false) {
  return Object.freeze({ snapshot, replayed, invalidations: snapshot.invalidations });
}

/**
 * Owns a correction-history store and a scoped cache store behind one private facade.
 * The underlying stores and their bound participant ports never escape this module.
 */
export function createCorrectionCacheBinding(options) {
  const config = ownRecord(options, new Set(['history', 'cache', 'authorizeBoundary', 'operationTimeoutMs']), ['history', 'cache', 'authorizeBoundary']);
  if (!config || typeof config.authorizeBoundary !== 'function') fail('REVIEW_INVALID');
  const operationTimeoutMs = config.operationTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(operationTimeoutMs) || operationTimeoutMs < 1 || operationTimeoutMs > MAX_OPERATION_TIMEOUT_MS) fail('REVIEW_INVALID');
  const history = createCorrectionHistoryStore(config.history);
  const cache = createScopedReuseStore(config.cache);
  const capability = issueCorrectionCacheBindingCapability();
  const historyPort = getCorrectionHistoryBindingPort(history, capability);
  const cachePort = getScopedReuseBindingPort(cache, capability);

  async function pairedContexts(scope, request, eventId, historyAction, cacheAction, field, signal) {
    const scopes = scopeRecord(scope);
    if (signal.aborted) fail('REVIEW_ABORTED');
    const historyContext = await historyPort.context(scopes.historyScope, request, eventId, historyAction, field);
    try {
      if (signal.aborted) fail('REVIEW_ABORTED');
      const cacheContext = await cachePort.context(scopes.cacheScope, request, cacheAction, capability);
      if (signal.aborted) fail('REVIEW_ABORTED');
      if (historyContext.info.tenantId !== cacheContext.tenantId || historyContext.actorId !== cacheContext.actorId) fail('REVIEW_DENIED');
      return { scopes, historyContext, cacheContext };
    } catch (error) {
      historyPort.disposeContext(historyContext);
      throw error;
    }
  }

  async function findCompletedBind(context, operation) {
    const rows = await historyPort.bindings(context);
    const binding = rows.find((row) => row.operationId === operation.operationId);
    if (!binding || binding.bindingId !== operation.bindingId) fail('REVIEW_INTEGRITY');
    if (binding.expiresAtMs <= historyPort.now()) fail('REVIEW_EXPIRED');
    return Object.freeze({ status: 'bound', cacheVersion: binding.cacheVersion,
      historyVersionId: binding.historyVersionId, expiresAt: new Date(binding.expiresAtMs).toISOString(), replayed: true });
  }

  async function bindPrivateProfile(scope, eventId, inputValue, request, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => {
      const input = ownRecord(inputValue, new Set(['idempotencyKey', 'profile']), ['idempotencyKey', 'profile']);
      if (!input || !validString(input.idempotencyKey, 180)) fail('REVIEW_INVALID');
      const profile = cleanCacheInput(input.profile);
      const { scopes, historyContext, cacheContext } = await pairedContexts(scope, request, eventId,
        'read_history', 'private_profile.write', undefined, signal);
      let preflightToken;
      try {
        const operationInput = Object.freeze({
          eventId: historyContext.eventId,
          identity: profile.identity,
          pins: profile.pins,
          cacheSourceContentHash: profile.contentHash,
          profile,
        });
        const bindHead = await historyPort.preflightBindHead(historyContext, input.idempotencyKey,
          operationInput, request);
        if (signal.aborted) fail('REVIEW_ABORTED');
        const historyExpiresAtMs = bindHead.expiresAtMs;
        const effectiveProfile = Object.freeze({ ...profile,
          expiresAtMs: Math.min(profile.expiresAtMs ?? historyExpiresAtMs, historyExpiresAtMs) });
        const projection = projectHistory(bindHead.snapshot);
        const projectionHash = sha256(canonical(projection));
        const projectedProfile = Object.freeze({ ...effectiveProfile, facts: projection });
        // Check cache limits against the facts that will be stored, while preserving the caller input schema.
        const historyBindingPreflight = Object.freeze({
          eventId: historyContext.eventId,
          historyVersionId: bindHead.snapshot.versionId,
          historyContentHash: bindHead.snapshot.contentHash,
          historyProjectionHash: projectionHash,
          historyExpiresAtMs,
        });
        preflightToken = await cachePort.validateProfileInput(scopes.cacheScope, request,
          projectedProfile, signal, capability, profile.facts, historyBindingPreflight);
        if (signal.aborted) fail('REVIEW_ABORTED');
        const operation = await historyPort.beginOperation(historyContext, {
          kind: 'bind', operationKey: input.idempotencyKey, normalizedInput: operationInput,
          baseVersionId: bindHead.snapshot.versionId,
          baseContentHash: bindHead.snapshot.contentHash,
          action: 'record_downstream_reference',
        }, request, signal);
        if (operation.replayed) return findCompletedBind(historyContext, operation);
        if (signal.aborted) fail('REVIEW_ABORTED');
        const pendingRead = Object.freeze({
          operationId: operation.operationId,
          fence: operation.fence,
          kind: operation.kind,
          phase: operation.phase,
          baseVersionId: operation.baseVersionId,
          baseContentHash: operation.baseContentHash,
          targetVersionId: operation.targetVersionId,
          targetContentHash: operation.targetContentHash,
        });
        const baseSnapshot = await historyPort.readVersion(historyContext, operation.baseVersionId, request, 'read_history', pendingRead);
        if (signal.aborted) fail('REVIEW_ABORTED');
        if (baseSnapshot.versionId !== bindHead.snapshot.versionId
          || baseSnapshot.contentHash !== bindHead.snapshot.contentHash
          || Date.parse(baseSnapshot.expiresAt) !== historyExpiresAtMs) fail('REVIEW_VERSION_CONFLICT');
        const fence = await historyPort.prepareFence(historyContext);
        try {
          const binding = Object.freeze({
            bindingId: operation.bindingId,
            eventId: historyContext.eventId,
            historyVersionId: baseSnapshot.versionId,
            historyContentHash: baseSnapshot.contentHash,
            historyProjectionHash: projectionHash,
            historyExpiresAtMs,
          });
          const stored = await cachePort.putProfile(scopes.cacheScope, request,
            Object.freeze({ ...effectiveProfile, facts: projection }),
            binding, operation, (commit, time) => fence.run(operation.operationId, operation.fence,
              ['pending_bind'], commit, time.now, time.effectiveNow, signal, time.boundaryToken),
            signal, capability, preflightToken);
          if (signal.aborted) fail('REVIEW_ABORTED');
          if (stored.status !== 'stored' || stored.scopeKind !== 'tenant_private'
            || stored.cacheSourceContentHash !== profile.contentHash
            || !stableEqual(stored.identity, profile.identity) || !stableEqual(stored.pins, profile.pins)) fail('REVIEW_INTEGRITY');
          await historyPort.addCacheProfile(historyContext, operation, {
            profileRef: stored.profileRef,
            cacheVersion: stored.version,
            scopeKind: stored.scopeKind,
            identity: stored.identity,
            pins: stored.pins,
            cacheBindingHash: stored.bindingHash,
            cacheSourceContentHash: stored.cacheSourceContentHash,
            historyProjectionHash: projectionHash,
            cacheExpiresAtMs: stored.expiresAtMs,
            historyExpiresAtMs,
          });
          await historyPort.finishOperation(historyContext, operation);
          return Object.freeze({ status: 'bound', cacheVersion: stored.version,
            historyVersionId: baseSnapshot.versionId,
            expiresAt: new Date(Math.min(stored.expiresAtMs, historyExpiresAtMs)).toISOString(),
            replayed: stored.replayed === true });
        } finally { fence.close(); }
      } finally {
        if (preflightToken) cachePort.disposePreflight(preflightToken, capability);
        historyPort.disposeContext(historyContext);
      }
    }, call?.signal, operationTimeoutMs);
  }

  async function runRevision(scope, inputValue, request, kind, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => {
      const allowed = kind === 'correction'
        ? new Set(['eventId', 'baseVersionId', 'baseContentHash', 'field', 'value', 'idempotencyKey', 'retentionHandle'])
        : new Set(['eventId', 'baseVersionId', 'baseContentHash', 'sourceFacts', 'idempotencyKey', 'retentionHandle']);
      const raw = ownRecord(inputValue, allowed, kind === 'correction'
        ? ['eventId', 'baseVersionId', 'baseContentHash', 'field', 'value', 'idempotencyKey', 'retentionHandle']
        : ['eventId', 'baseVersionId', 'baseContentHash', 'sourceFacts', 'idempotencyKey', 'retentionHandle']);
      if (!raw || !validString(raw.eventId, 180) || !validString(raw.baseVersionId, 180)
        || !/^[a-f0-9]{64}$/.test(raw.baseContentHash) || !validString(raw.idempotencyKey, 180)
        || !raw.retentionHandle || typeof raw.retentionHandle !== 'object' || utilTypes.isProxy(raw.retentionHandle)) fail('REVIEW_INVALID');
      const value = kind === 'correction' ? cloneJson(raw.value) : cloneJson(raw.sourceFacts);
      const cleanInput = Object.freeze({
        eventId: raw.eventId,
        baseVersionId: raw.baseVersionId,
        baseContentHash: raw.baseContentHash,
        ...(kind === 'correction' ? { field: raw.field, value } : { sourceFacts: value }),
        idempotencyKey: raw.idempotencyKey,
        retentionHandle: raw.retentionHandle,
      });
      const normalizedInput = Object.freeze({
        eventId: raw.eventId,
        baseVersionId: raw.baseVersionId,
        baseContentHash: raw.baseContentHash,
        ...(kind === 'correction' ? { field: raw.field, value } : { sourceFacts: value }),
        idempotencyKey: raw.idempotencyKey,
      });
      const action = kind === 'correction' ? 'apply_correction' : 'refresh_source_facts';
      const { scopes, historyContext } = await pairedContexts(scope, request, raw.eventId,
        action, 'cache.invalidate', kind === 'correction' ? raw.field : undefined, signal);
      let revisionPlan;
      try {
        historyPort.validateOperationInput(historyContext, kind, cleanInput);
        const prepared = await historyPort.prepareRevision(historyContext, {
          kind,
          operationKey: raw.idempotencyKey,
          normalizedInput,
          baseVersionId: raw.baseVersionId,
          baseContentHash: raw.baseContentHash,
          action,
          ...(kind === 'correction' ? { field: raw.field } : {}),
        }, cleanInput, request, signal);
        if (prepared.mode === 'replay') {
          const snapshot = await historyPort.readOperationResult(historyContext, prepared.operation, request, action, signal);
          return correctionResult(snapshot, true);
        }
        if (prepared.mode === 'prepared') revisionPlan = prepared.plan;
        const operation = await historyPort.beginOperation(historyContext, {
          kind, operationKey: raw.idempotencyKey, normalizedInput,
          baseVersionId: raw.baseVersionId, baseContentHash: raw.baseContentHash,
          action, ...(kind === 'correction' ? { field: raw.field } : {}),
          ...(revisionPlan ? { preparedRevision: revisionPlan } : {}),
        }, request, signal);
        if (operation.replayed) {
          const snapshot = await historyPort.readOperationResult(historyContext, operation, request, action, signal);
          return correctionResult(snapshot, true);
        }
        if (signal.aborted) fail('REVIEW_ABORTED');
        const revised = await historyPort.applyOperation(historyContext, operation, cleanInput, request, signal, revisionPlan);
        if (signal.aborted) fail('REVIEW_ABORTED');
        const targetOperation = Object.freeze({ ...operation,
          targetVersionId: revised.snapshot.versionId,
          targetContentHash: revised.snapshot.contentHash,
        });
        const fence = await historyPort.prepareFence(historyContext);
        try {
          const bindings = await historyPort.bindings(historyContext, operation.baseVersionId, operation.baseContentHash);
          for (const binding of bindings) {
            if (signal.aborted) fail('REVIEW_ABORTED');
            const cacheBinding = bindingForCache(binding);
            const localResult = await cachePort.invalidate(scopes.cacheScope, request, cacheBinding, targetOperation,
              (commit, time) => fence.run(operation.operationId, operation.fence,
                ['history_committed', 'cache_invalidating'], commit, time.now, time.effectiveNow, signal,
                time.boundaryToken), signal, capability);
            if (!localResult.locallyIneligible || localResult.profileRef !== binding.profileRef
              || !Array.isArray(localResult.eventIds) || localResult.eventIds.length < 1) fail('REVIEW_INTEGRITY');
            await historyPort.markInvalidated(historyContext, targetOperation, binding);
          }
          await historyPort.finishOperation(historyContext, targetOperation);
        } finally { fence.close(); }
        const snapshot = await historyPort.readOperationResult(historyContext, targetOperation, request, action, signal);
        return correctionResult(snapshot, revised.replayed);
      } finally {
        if (revisionPlan) historyPort.disposeRevisionPlan(revisionPlan);
        historyPort.disposeContext(historyContext);
      }
    }, call?.signal, operationTimeoutMs);
  }

  async function getPrivateProfile(scope, eventId, request, lookupValue, use = 'cache_read', callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => {
      const lookup = ownRecord(lookupValue, new Set(['identity', 'contentHash', 'pins']), ['identity', 'contentHash', 'pins']);
      if (!lookup || !/^[a-f0-9]{64}$/.test(lookup.contentHash) || !validString(use, 80)) fail('REVIEW_INVALID');
      const cleanLookup = cloneJson(lookup);
      const { historyContext, cacheContext } = await pairedContexts(scope, request, eventId,
        'read_history', 'private_profile.read', undefined, signal);
      try {
        const delays = DELAYS;
        for (let attempt = 0; ; attempt += 1) {
          if (signal.aborted) fail('REVIEW_ABORTED');
          const head = await historyPort.readHead(historyContext, request, 'read_history');
          const expectedProjectionHash = sha256(canonical(projectHistory(head.snapshot)));
          const bindings = await historyPort.bindings(historyContext, head.snapshot.versionId, head.snapshot.contentHash);
          const matches = bindings.filter((binding) => stableEqual(binding.identity, cleanLookup.identity)
            && stableEqual(binding.pins, cleanLookup.pins)
            && binding.cacheSourceContentHash === cleanLookup.contentHash
            && binding.historyProjectionHash === expectedProjectionHash);
          if (matches.length !== 1) return Object.freeze({ status: 'miss' });
          const binding = matches[0];
          if (Math.max(historyPort.now(), cachePort.now()) >= binding.expiresAtMs) {
            return Object.freeze({ status: 'unavailable', reason: 'expired' });
          }
          const candidate = await cachePort.loadCandidate(scopeRecord(scope).cacheScope,
            request, bindingForCache(binding), use, signal, capability);
          const historyFence = await historyPort.prepareFence(historyContext);
          let cacheDatabase;
          try {
            cacheDatabase = await cachePort.prepareReadDatabase(capability);
            const permissions = candidate.payload.permissions ?? [];
            const boundaryInput = Object.freeze({
              request,
              tenantId: historyContext.info.tenantId,
              actorId: historyContext.actorId,
              eventId: historyContext.eventId,
              action: 'private_profile.read',
              field: null,
              details: Object.freeze({
                bindingId: binding.bindingId,
                profileRef: binding.profileRef,
                historyVersionId: binding.historyVersionId,
                historyContentHash: binding.historyContentHash,
                historyProjectionHash: binding.historyProjectionHash,
                identity: binding.identity,
                pins: binding.pins,
                cacheSourceContentHash: binding.cacheSourceContentHash,
                permissionReferences: permissions,
                permissionValidUntilMs: candidate.permissionState.validUntilMs ?? null,
                cacheExpiresAtMs: binding.cacheExpiresAtMs,
                historyExpiresAtMs: binding.historyExpiresAtMs,
              }),
            });
            const boundaryToken = beginLocalBoundary(config.authorizeBoundary, boundaryInput, () => fail('REVIEW_DENIED'));
            const nowMs = boundaryToken.nowMs;
            const effectiveNowMs = localBoundaryEffectiveNow(boundaryToken);
            if (!Number.isSafeInteger(effectiveNowMs) || effectiveNowMs < nowMs) fail('REVIEW_DENIED');
            if (effectiveNowMs >= binding.expiresAtMs || (candidate.permissionState.validUntilMs !== undefined
              && effectiveNowMs >= candidate.permissionState.validUntilMs)) return Object.freeze({ status: 'unavailable', reason: 'expired' });
            const expected = Object.freeze({
              bindingHash: binding.bindingHash,
              referenceHash: binding.referenceHash,
              sealed: binding.sealed,
              versionId: binding.historyVersionId,
              contentHash: binding.historyContentHash,
              nowMs,
              effectiveNowMs,
              permissionValidUntilMs: candidate.permissionState.validUntilMs ?? null,
              boundaryToken,
              signal,
            });
            try {
              const result = historyFence.read(expected,
                () => cachePort.finalRead(cacheDatabase, candidate, nowMs, effectiveNowMs, capability, boundaryToken));
              if (signal.aborted) fail('REVIEW_ABORTED');
              const finalDisclosureNow = localBoundaryEffectiveNow(boundaryToken);
              if (!Number.isSafeInteger(finalDisclosureNow) || finalDisclosureNow < effectiveNowMs) fail('REVIEW_DENIED');
              if (finalDisclosureNow >= binding.expiresAtMs || (candidate.permissionState.validUntilMs !== undefined
                && finalDisclosureNow >= candidate.permissionState.validUntilMs)) {
                return Object.freeze({ status: 'unavailable', reason: 'expired' });
              }
              return result;
            } catch (error) {
              if (!isBusy(error) || attempt >= delays.length) throw error;
            }
          } finally {
            historyFence.close();
            cacheDatabase?.close();
          }
          await sleepAbortable(delays[attempt], signal);
        }
      } finally {
        historyPort.disposeContext(historyContext);
      }
    }, call?.signal, operationTimeoutMs);
  }

  async function scopeForAuthenticatedRequest(request, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => {
      const historyScope = await history.scopeForAuthenticatedRequest(request);
      if (signal.aborted) fail('REVIEW_ABORTED');
      const cacheScope = await cache.scopeForAuthenticatedRequest(request);
      if (signal.aborted) fail('REVIEW_ABORTED');
      const scope = Object.freeze(Object.create(null));
      SCOPES.set(scope, Object.freeze({ historyScope, cacheScope }));
      return scope;
    }, call?.signal, operationTimeoutMs);
  }

  async function createHistory(scope, input, request, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => history.createHistory(scopeRecord(scope).historyScope,
      input, request, { signal }), call?.signal, operationTimeoutMs);
  }

  async function getHistory(scope, eventId, request, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    return runBounded(async (signal) => {
      const scopes = scopeRecord(scope);
      const context = await historyPort.context(scopes.historyScope, request, eventId, 'read_history');
      try {
        const result = await historyPort.readHead(context, request, 'read_history');
        if (signal.aborted) fail('REVIEW_ABORTED');
        return result.snapshot;
      } finally { historyPort.disposeContext(context); }
    }, call?.signal, operationTimeoutMs);
  }

  async function dispatchPendingInvalidations(scope, request, maximum = 20, callOptions = undefined) {
    const call = ownRecord(callOptions, new Set(['signal']));
    if (callOptions !== undefined && !call) fail('REVIEW_INVALID');
    const scopes = scopeRecord(scope);
    return runBounded((signal) => cache.dispatchPendingInvalidations(scopes.cacheScope, request, maximum,
      'tenant_private', signal), call?.signal, operationTimeoutMs);
  }

  async function outboxSnapshot(scope, request) {
    const scopes = scopeRecord(scope);
    return cache.outboxSnapshot(scopes.cacheScope, request, 'tenant_private');
  }

  const api = Object.freeze({
    scopeForAuthenticatedRequest,
    createHistory,
    getHistory,
    bindPrivateProfile,
    applyCorrection: (scope, input, request, callOptions) => runRevision(scope, input, request, 'correction', callOptions),
    refreshSources: (scope, input, request, callOptions) => runRevision(scope, input, request, 'source_refresh', callOptions),
    getPrivateProfile,
    dispatchPendingInvalidations,
    outboxSnapshot,
  });
  return api;
}
