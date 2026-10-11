import { createHash } from 'node:crypto';
import { AccessPreflightError } from './access.mjs';
import { canonicalHash } from '../contracts/validation.mjs';

// CE-A01 provider-metadata adapter for the OpenRouter Images target. It performs only the two documented
// non-billable reads through an injected fetch: GET /api/v1/key (authentication) and the public image-model
// endpoint catalog. Neither read is entitlement: operation permission and quota are always reported UNKNOWN and
// must come from the separately injected capability verifier. Nothing here reads the environment, selects a
// model, follows redirects, or retries. Billable dispatch is supplied by the trusted host composition.

export const OPENROUTER_PREFLIGHT_SERVICE = 'openrouter';
export const OPENROUTER_PREFLIGHT_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';
export const OPENROUTER_PREFLIGHT_KEY_ENDPOINT = 'https://openrouter.ai/api/v1/key';
const CATALOG_PREFIX = 'https://openrouter.ai/api/v1/images/models/';
const MODEL_ID = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;
const PROVIDER_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/;
const HASH = /^sha256:[a-f0-9]{64}$/;
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const METADATA_TIMEOUT_MS = 15_000;

function error(code, message) {
  return new AccessPreflightError(code, message);
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
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || Object.keys(config).some((key) => !required.includes(key)) || required.some((key) => !Object.hasOwn(config, key))
    || typeof config.prompt_template_ref !== 'string' || !ID.test(config.prompt_template_ref)
    || !HASH.test(config.prompt_template_sha256) || !HASH.test(config.profile_sha256)
    || typeof config.provider_tag !== 'string' || !PROVIDER_TAG.test(config.provider_tag)) {
    throw error('unsupported_image_configuration', 'OpenRouter configuration must pin the prompt, provider tag, and profile hash for exactly this cell.');
  }
  if (cellId === 'image_edit' && (typeof config.asset_ref !== 'string' || !ID.test(config.asset_ref)
    || !HASH.test(config.asset_sha256) || !['image/png', 'image/jpeg', 'image/webp'].includes(config.asset_mime))) {
    throw error('unsupported_image_configuration', 'Edit requires a pinned reference asset reference, digest, and image media type.');
  }
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

async function resolveCredential(credentialPort, { scope, target }) {
  try {
    if (!SAFE_REF.test(scope.account_ref) || !SAFE_REF.test(scope.project_ref)) {
      throw error('credential_unavailable', 'Provider account and project references must be safe opaque IDs.');
    }
    const binding = targetBinding(target, scope);
    const resolved = await credentialPort.resolveCredential({
      service: OPENROUTER_PREFLIGHT_SERVICE,
      purpose: 'read_only_account_check',
      account_ref: scope.account_ref,
      project_ref: scope.project_ref,
      target_binding: binding,
    });
    const expectedBindingHash = digest(Buffer.from(JSON.stringify(binding), 'utf8'));
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)
      || resolved.decision !== 'resolved' || resolved.evidence_mode !== 'live') {
      throw error('credential_unavailable', 'Trusted credential resolver did not confirm this provider scope.');
    }
    if (!resolved.binding || Object.keys(resolved.binding).some((key) => !['service', 'account_ref', 'project_ref', 'target_binding_sha256'].includes(key))
      || resolved.binding.service !== OPENROUTER_PREFLIGHT_SERVICE
      || resolved.binding.account_ref !== scope.account_ref || resolved.binding.project_ref !== scope.project_ref
      || resolved.binding.target_binding_sha256 !== expectedBindingHash) {
      throw error('credential_unavailable', 'Credential identity does not match the requested provider account and project.');
    }
    if (typeof resolved.token !== 'string' || resolved.token.trim().length === 0 || /[\r\n]/.test(resolved.token)) {
      throw error('credential_unavailable', 'Trusted credential resolver did not return a usable bearer token.');
    }
    safeCredentialEvidence(resolved.evidence);
    if (typeof resolved.expires_at !== 'string' || !Number.isFinite(Date.parse(resolved.expires_at))
      || Date.parse(resolved.expires_at) <= Date.now()) {
      throw error('credential_unavailable', 'Scoped credential is expired.');
    }
    return resolved.token;
  } catch {
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
export function createOpenRouterImagesAdapter({ credentialPort, fetchImpl, dispatchPort }) {
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
      const token = await resolveCredential(credentialPort, { scope, target }).catch(() => {
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
        checked_at: new Date().toISOString(),
        evidence: {
          ref: `${run_id}:${cell_id}:openrouter-key-and-catalog`,
          sha256: digest(Buffer.from(JSON.stringify({ key_status: keyStatus, catalog_status: catalogStatus,
            model_listing: modelListing, catalog_entry_sha256: catalogEntryDigest, cell_id, target: binding }), 'utf8')),
        },
      };
    },
  };
  if (dispatchPort) {
    adapter.dispatch = async (input) => {
      validateOpenRouterImageTarget(input.cell_id, input.target);
      return dispatchPort.dispatch(input);
    };
    if (dispatchPort.prepare) {
      adapter.prepare = async (input) => {
        validateOpenRouterImageTarget(input.cell_id, input.target);
        return dispatchPort.prepare(input);
      };
    }
  } else {
    adapter.dispatch = async () => {
      throw error('adapter_unavailable', 'No trusted OpenRouter billable dispatch port was composed.');
    };
  }
  return Object.freeze(adapter);
}
