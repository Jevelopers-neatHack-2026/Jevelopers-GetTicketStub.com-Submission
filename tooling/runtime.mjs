import { createHash } from 'node:crypto';
import * as validators from '../generated/validators.mjs';
import { versions, primitiveValidators } from '../generated/registry.mjs';

const failure = (code, path, keyword) => ({ ok: false, errors: [{ code, path, ...(keyword ? { keyword } : {}) }] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');

export class ContractError extends Error {
  constructor(code, path = '') {
    super(code);
    this.name = 'ContractError';
    this.code = code;
    this.path = path;
  }
}

/** Reject values that JSON would silently discard or rewrite. No data is included in errors. */
export function canonicalJson(value) {
  const ancestors = new Set();
  function encode(input, path, depth) {
    if (input === null) return 'null';
    if (typeof input === 'boolean') return String(input);
    if (typeof input === 'number') {
      if (!Number.isFinite(input) || (Number.isInteger(input) && !Number.isSafeInteger(input))) throw new ContractError('NON_CANONICAL_NUMBER', path);
      return JSON.stringify(input === 0 ? 0 : input);
    }
    if (typeof input === 'string') {
      if (!input.isWellFormed()) throw new ContractError('INVALID_UNICODE', path);
      return JSON.stringify(input);
    }
    if (typeof input !== 'object') throw new ContractError('NON_JSON_VALUE', path);
    if (depth >= 64) throw new ContractError('RESOURCE_LIMIT', path);
    if (ancestors.has(input)) throw new ContractError('CYCLIC_VALUE', path);
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) throw new ContractError('NON_JSON_VALUE', path);
    if (Object.getOwnPropertySymbols(input).length) throw new ContractError('NON_JSON_VALUE', path);
    ancestors.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Object.keys(descriptors).filter(key => key !== 'length' || !Array.isArray(input));
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw new ContractError('NON_JSON_VALUE', path);
    }
    let result;
    if (Array.isArray(input)) {
      if (keys.length !== input.length || keys.some((key, index) => key !== String(index))) throw new ContractError('NON_JSON_VALUE', path);
      result = '[' + input.map((item, index) => encode(item, path + '/' + index, depth + 1)).join(',') + ']';
    } else {
      result = '{' + keys.sort().map(key => {
        if (!key.isWellFormed()) throw new ContractError('INVALID_UNICODE', path);
        return JSON.stringify(key) + ':' + encode(descriptors[key].value, path + '/' + pointer(key), depth + 1);
      }).join(',') + '}';
    }
    ancestors.delete(input);
    return result;
  }
  return encode(value, '', 0);
}

export function hashBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new ContractError('INVALID_BYTES');
  return 'sha256:' + createHash('sha256').update(bytes).digest('hex');
}

export function hashManifest(value) {
  return hashBytes(new TextEncoder().encode(canonicalJson(value)));
}

export function validateContract(contract, value) {
  if (typeof contract !== 'string' || !Object.hasOwn(versions, contract)) return failure('UNKNOWN_CONTRACT', '/contract');
  try { canonicalJson(value); } catch (error) {
    if (error instanceof ContractError) return failure(error.code, '');
    throw error;
  }
  if (!object(value)) return failure('INVALID_PAYLOAD', '');
  if (typeof value.schema_version !== 'string') return failure('INVALID_PAYLOAD', '/schema_version');
  if (!Object.hasOwn(versions[contract], value.schema_version)) return failure('UNSUPPORTED_VERSION', '/schema_version');
  const exportName = versions[contract][value.schema_version];
  const validate = validators[exportName];
  if (validate(value)) return { ok: true, value };
  return { ok: false, errors: validate.errors.map(error => ({
    code: 'INVALID_PAYLOAD',
    path: error.instancePath + (error.keyword === 'required' ? '/' + pointer(error.params.missingProperty) : ''),
    keyword: error.keyword
  })) };
}

export function validateContractVersion(contract, version, value) {
  if (typeof contract !== 'string' || !Object.hasOwn(versions, contract)) return failure('UNKNOWN_CONTRACT', '/contract');
  if (typeof version !== 'string' || !Object.hasOwn(versions[contract], version)) return failure('UNSUPPORTED_VERSION', '/schema_version');
  if (object(value) && typeof value.schema_version === 'string' && value.schema_version !== version) return failure('UNSUPPORTED_VERSION', '/schema_version');
  return validateContract(contract, value);
}

export function parseContractVersion(contract, version, json) {
  return parseContract(contract, json, version);
}

export function parseContract(contract, json, expectedVersion) {
  if (typeof json !== 'string') return failure('MALFORMED_JSON', '');
  let value;
  try { value = JSON.parse(json); } catch (error) {
    if (error instanceof SyntaxError) return failure('MALFORMED_JSON', '');
    throw error;
  }
  // JSON.parse accepts duplicate members by discarding earlier values. Reject that loss.
  const tokens = json.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g);
  let cursor = 0;
  function uniqueMembers(depth = 0) {
    const token = tokens[cursor++];
    if ((token === '{' || token === '[') && depth >= 64) throw new ContractError('RESOURCE_LIMIT');
    if (token === '{') {
      const keys = new Set();
      while (tokens[cursor] !== '}') {
        const key = JSON.parse(tokens[cursor++]);
        if (keys.has(key)) throw new ContractError('MALFORMED_JSON');
        keys.add(key);
        cursor++;
        uniqueMembers(depth + 1);
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
    } else if (token === '[') {
      while (tokens[cursor] !== ']') {
        uniqueMembers(depth + 1);
        if (tokens[cursor] !== ',') break;
        cursor++;
      }
      cursor++;
    }
  }
  try { uniqueMembers(); } catch (error) {
    if (error instanceof ContractError) return failure(error.code === 'RESOURCE_LIMIT' ? 'RESOURCE_LIMIT' : 'MALFORMED_JSON', '');
    throw error;
  }
  return expectedVersion === undefined ? validateContract(contract, value) : validateContractVersion(contract, expectedVersion, value);
}

export function validatePrimitive(name, value) {
  if (typeof name !== 'string' || !Object.hasOwn(primitiveValidators, name)) return failure('UNKNOWN_CONTRACT', '');
  return validators[primitiveValidators[name]](value) ? { ok: true, value } : failure('INVALID_PAYLOAD', '');
}

/** Expectations must come from the authenticated downstream adapter, never the payload. */
export function checkTrustedContext(value, expected) {
  try { canonicalJson(expected); } catch (error) {
    if (error instanceof ContractError) return failure('INVALID_TRUST_CONTEXT', '');
    throw error;
  }
  if (!object(expected) || typeof expected.tenant_id !== 'string' || typeof expected.project_id !== 'string') return failure('INVALID_TRUST_CONTEXT', '');
  const allowed = ['tenant_id', 'project_id', 'design_id', 'design_version_id', 'artifact_id', 'order_id'];
  if (Object.keys(expected).some(key => !allowed.includes(key))) return failure('INVALID_TRUST_CONTEXT', '');
  for (const key of allowed) {
    if (Object.hasOwn(expected, key)) {
      if (typeof expected[key] !== 'string' || !validators[primitiveValidators.TenantId](expected[key])) return failure('INVALID_TRUST_CONTEXT', '/' + key);
      if (!object(value) || !Object.hasOwn(value, key) || value[key] !== expected[key]) return failure('SCOPE_MISMATCH', '/' + key);
    }
  }
  return { ok: true, value };
}

/** Only public opaque IDs, fixed vocabularies and public source revisions survive. */
export function projectEvidence(source) {
  const own = (input, key) => {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  };
  if (!object(source)) return failure('INVALID_PAYLOAD', '');
  const component = own(source, 'component');
  if (!object(component)) return failure('INVALID_PAYLOAD', '/component');
  const projection = {
    contract: 'EvidenceProjection', schema_version: '1.0.0', policy_version: '1.0.0',
    evidence_id: own(source, 'evidence_id'), environment: own(source, 'environment'), billing_mode: own(source, 'billing_mode'),
    outcome: own(source, 'outcome'),
    component: { name: own(component, 'name'), source_revision: own(component, 'source_revision') }
  };
  return validateContract('EvidenceProjection', projection);
}
