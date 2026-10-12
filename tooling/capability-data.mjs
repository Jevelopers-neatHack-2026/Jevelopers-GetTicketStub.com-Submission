import { types } from 'node:util';
import { canonicalJson, ContractError } from './runtime.mjs';

export class CapabilityError extends Error {
  constructor(code, path = '') { super(code); this.name = 'CapabilityError'; this.code = code; this.path = path; }
}
export const fail = (code, path = '') => { throw new CapabilityError(code, path); };
export const rejected = (code, path = '') => ({ ok: false, errors: [{ code, path }] });

/** Bound traversal before canonical serialization; reject getters/proxies without invoking them. */
export function ownedData(value) {
  const queue = [{ value, depth: 0 }];
  let nodes = 0;
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index];
    if (++nodes > 20000 || item.depth > 16) fail('RESOURCE_LIMIT');
    if (typeof item.value === 'string' && item.value.length > 4096) fail('RESOURCE_LIMIT');
    if (item.value === null || typeof item.value !== 'object') continue;
    if (types.isProxy(item.value)) fail('INVALID_PAYLOAD');
    const descriptors = Object.getOwnPropertyDescriptors(item.value);
    if (Reflect.ownKeys(descriptors).length > 2001) fail('RESOURCE_LIMIT');
    for (const descriptor of Object.values(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value')) fail('INVALID_PAYLOAD');
      queue.push({ value: descriptor.value, depth: item.depth + 1 });
    }
    if (queue.length > 20000) fail('RESOURCE_LIMIT');
  }
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > 1000000) fail('RESOURCE_LIMIT');
  return JSON.parse(json);
}

export function frozen(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
export function boundary(action) {
  try { return frozen(action()); } catch (error) {
    if (error instanceof CapabilityError || error instanceof ContractError) return frozen(rejected(error.code, error.path));
    throw error;
  }
}
export function exactRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_PAYLOAD');
  return value;
}
export function utcEpoch(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail('INVALID_CLOCK', '/now');
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch) || new Date(epoch).toISOString() !== value) fail('INVALID_CLOCK', '/now');
  return epoch;
}
