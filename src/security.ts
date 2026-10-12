import type { ProviderMode, TrustedScope } from "./types.js";

export type SecurityErrorCode =
  | "invalid_scope"
  | "reference_unavailable"
  | "provider_payload_policy_invalid"
  | "mode_mismatch"
  | "server_secret_unavailable"
  | "provider_operation_failed"
  | "asset_policy_invalid"
  | "asset_url_rejected"
  | "asset_host_rejected"
  | "asset_address_rejected"
  | "asset_peer_mismatch"
  | "asset_redirect_rejected"
  | "asset_too_large"
  | "asset_type_rejected"
  | "asset_response_invalid"
  | "asset_timeout"
  | "asset_retrieval_failed"
  | "asset_approval_mismatch"
  | "refresh_changed_approval"
  | "retention_policy_invalid"
  | "retention_unavailable"
  | "callback_disabled"
  | "callback_invalid"
  | "callback_oversized"
  | "callback_verification_failed"
  | "callback_verification_unavailable"
  | "callback_replayed"
  | "callback_unavailable"
  | "internal_failure";

const SAFE_MESSAGES: Readonly<Record<SecurityErrorCode, string>> = {
  invalid_scope: "The trusted scope did not pass validation.",
  reference_unavailable: "The scoped reference is unavailable.",
  provider_payload_policy_invalid: "The provider payload did not match its reviewed field policy.",
  mode_mismatch: "The requested provider mode is not available for this operation.",
  server_secret_unavailable: "The server credential is unavailable for this provider mode.",
  provider_operation_failed: "The provider operation failed.",
  asset_policy_invalid: "The approved asset retrieval policy is invalid.",
  asset_url_rejected: "The asset URL did not pass security validation.",
  asset_host_rejected: "The asset host is not approved.",
  asset_address_rejected: "The asset host resolved to a prohibited network address.",
  asset_peer_mismatch: "The asset transport connected to an unapproved address.",
  asset_redirect_rejected: "The asset redirect did not pass security validation.",
  asset_too_large: "The asset exceeded the configured size limit.",
  asset_type_rejected: "The asset type is not approved.",
  asset_response_invalid: "The asset response did not pass validation.",
  asset_timeout: "The asset request exceeded its time limit.",
  asset_retrieval_failed: "The approved asset could not be retrieved.",
  asset_approval_mismatch: "The retrieved asset does not match its approved identity.",
  refresh_changed_approval: "Refreshing asset access changed approved artifact facts.",
  retention_policy_invalid: "The personal-data retention policy is invalid.",
  retention_unavailable: "The personal-data retention operation is unavailable.",
  callback_disabled: "Callback verification is unavailable and unverified hints are disabled.",
  callback_invalid: "The callback did not pass validation.",
  callback_oversized: "The callback exceeded the configured body limit.",
  callback_verification_failed: "The callback could not be authenticated.",
  callback_verification_unavailable: "The documented callback verifier is unavailable.",
  callback_replayed: "The callback has already been observed.",
  callback_unavailable: "The callback replay boundary is unavailable.",
  internal_failure: "The security operation failed."
};

const SAFE_REFERENCE_PATTERN = /^diag-[A-Za-z0-9][A-Za-z0-9._:-]{0,122}$/;
const SAFE_CALLBACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPAQUE_TEXT_LIMIT = 512;
const SUPPORTED_ASSET_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REDACTED = "[REDACTED]";
const SECURITY_ERROR_CODES = new Set(Object.keys(SAFE_MESSAGES));
const genuineSecurityErrors = new WeakSet<object>();

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;

export class SecurityBoundaryError extends Error {
  readonly code: SecurityErrorCode;
  readonly diagnosticReference: string;
  readonly safeMessage: string;

  constructor(code: SecurityErrorCode, diagnosticReference: string) {
    const safeCode = typeof code === "string" && SECURITY_ERROR_CODES.has(code) ? code : "internal_failure";
    const safeReference = typeof diagnosticReference === "string" && SAFE_REFERENCE_PATTERN.test(diagnosticReference)
      ? diagnosticReference
      : "diag-unavailable";
    super(SAFE_MESSAGES[safeCode]);
    this.name = "SecurityBoundaryError";
    this.code = safeCode;
    this.diagnosticReference = safeReference;
    this.safeMessage = SAFE_MESSAGES[safeCode];
    genuineSecurityErrors.add(this);
    Object.freeze(this);
  }

  toJSON(): { code: SecurityErrorCode; safeMessage: string; diagnosticReference: string } {
    return {
      code: this.code,
      safeMessage: this.safeMessage,
      diagnosticReference: this.diagnosticReference
    };
  }
}

function failure(code: SecurityErrorCode, diagnosticReference?: unknown): SecurityBoundaryError {
  const reference = typeof diagnosticReference === "string" && SAFE_REFERENCE_PATTERN.test(diagnosticReference)
    ? diagnosticReference
    : "diag-unavailable";
  return new SecurityBoundaryError(code, reference);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Copy a plain data record without invoking accessors. Proxies that cannot be
 * inspected safely fail closed through the caller's fixed security error. */
function snapshotRecord(
  value: unknown,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) throw new Error();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    throw failure(code, diagnosticReference);
  }
}

function snapshotStringArray(
  value: unknown,
  maxLength: number,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): string[] {
  try {
    if (!Array.isArray(value)) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor !== undefined && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maxLength) throw new Error();
    const result: string[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || typeof descriptor.value !== "string") throw new Error();
      result.push(descriptor.value);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (length as number)) throw new Error();
    }
    return result;
  } catch {
    throw failure(code, diagnosticReference);
  }
}

function snapshotDataArray(
  value: unknown,
  maxLength: number,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): unknown[] {
  try {
    if (!Array.isArray(value)) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor !== undefined && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maxLength) throw new Error();
    const result: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new Error();
      result.push(descriptor.value);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (length as number)) throw new Error();
    }
    return result;
  } catch {
    throw failure(code, diagnosticReference);
  }
}

function captureMethod(
  target: unknown,
  key: PropertyKey,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): (...args: never[]) => unknown {
  try {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) throw new Error();
    let current: object | null = target as object;
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") throw new Error();
        const method = descriptor.value as (...args: never[]) => unknown;
        return (...args: never[]) => Reflect.apply(method, target, args);
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    throw failure(code, diagnosticReference);
  }
  throw failure(code, diagnosticReference);
}

/** Allocate a standalone copy of the exact typed-array view (including Buffer
 * and offset views), without dispatching overridable slice/set methods. */
function copyBytes(
  value: unknown,
  maxBytes: number,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): Uint8Array {
  try {
    if (!(value instanceof Uint8Array) || typedArrayByteLengthGetter === undefined ||
      typedArrayBufferGetter === undefined || typedArrayByteOffsetGetter === undefined) throw new Error();
    const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
    const byteOffset = Reflect.apply(typedArrayByteOffsetGetter, value, []) as number;
    const buffer = Reflect.apply(typedArrayBufferGetter, value, []) as ArrayBufferLike;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxBytes) throw new Error();
    const exactView = new Uint8Array(buffer, byteOffset, byteLength);
    const copy = new Uint8Array(byteLength);
    Uint8Array.prototype.set.call(copy, exactView);
    return copy;
  } catch {
    throw failure(code, diagnosticReference);
  }
}

function byteLengthOf(value: unknown, code: SecurityErrorCode, diagnosticReference?: unknown): number {
  try {
    if (!(value instanceof Uint8Array) || typedArrayByteLengthGetter === undefined) throw new Error();
    const byteLength = Reflect.apply(typedArrayByteLengthGetter, value, []) as number;
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new Error();
    return byteLength;
  } catch {
    throw failure(code, diagnosticReference);
  }
}

function isUint8Array(value: unknown): value is Uint8Array {
  try {
    return value instanceof Uint8Array;
  } catch {
    return false;
  }
}

function hasSafeOpaqueText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= OPAQUE_TEXT_LIMIT &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function trustedScopeSnapshot(value: unknown, diagnosticReference?: unknown): TrustedScope {
  const scope = snapshotRecord(value, "invalid_scope", diagnosticReference);
  if (!hasSafeOpaqueText(scope.tenantId) || !hasSafeOpaqueText(scope.projectId)) {
    throw failure("invalid_scope", diagnosticReference);
  }
  return Object.freeze({ tenantId: scope.tenantId, projectId: scope.projectId });
}

function validMode(value: unknown): value is ProviderMode {
  return value === "simulated" || value === "sandbox";
}

function validIdentifier(value: unknown): value is string {
  return hasSafeOpaqueText(value);
}

export interface EncryptedScopedRecord {
  readonly tenantId: string;
  readonly projectId: string;
  readonly ciphertext: Uint8Array;
  readonly keyVersion: string;
}

export interface EncryptedScopedReferenceStore {
  /** The store must apply both scope predicates before returning any encrypted bytes. */
  get(reference: string, trustedScope: TrustedScope): Promise<EncryptedScopedRecord | undefined>;
}

export interface ScopedDecryptor<T> {
  decrypt(
    ciphertext: Uint8Array,
    context: { readonly trustedScope: TrustedScope; readonly keyVersion: string; readonly purpose: string }
  ): Promise<T>;
}

export async function resolveEncryptedScopedReference<T>(input: {
  readonly reference: unknown;
  readonly trustedScope: unknown;
  readonly purpose: unknown;
  readonly store: EncryptedScopedReferenceStore;
  readonly decryptor: ScopedDecryptor<T>;
  readonly diagnosticReference?: unknown;
}): Promise<T> {
  const fields = snapshotRecord(input, "reference_unavailable");
  const diagnosticReference = fields.diagnosticReference;
  const scope = trustedScopeSnapshot(fields.trustedScope, diagnosticReference);
  const reference = fields.reference;
  const purpose = fields.purpose;
  if (!validIdentifier(reference) || !validIdentifier(purpose)) {
    throw failure("reference_unavailable", diagnosticReference);
  }
  const get = captureMethod(fields.store, "get", "reference_unavailable", diagnosticReference);
  const decrypt = captureMethod(fields.decryptor, "decrypt", "reference_unavailable", diagnosticReference);

  let record: EncryptedScopedRecord | undefined;
  try {
    record = await Reflect.apply(get, undefined, [reference, scope]) as EncryptedScopedRecord | undefined;
  } catch {
    throw failure("reference_unavailable", diagnosticReference);
  }
  let stored: Record<string, unknown>;
  let ciphertext: Uint8Array;
  try {
    stored = snapshotRecord(record, "reference_unavailable", diagnosticReference);
    ciphertext = copyBytes(stored.ciphertext, 20 * 1024 * 1024, "reference_unavailable", diagnosticReference);
  } catch {
    throw failure("reference_unavailable", diagnosticReference);
  }
  if (
    stored.tenantId !== scope.tenantId || stored.projectId !== scope.projectId ||
    ciphertext.byteLength === 0 || !validIdentifier(stored.keyVersion)
  ) {
    throw failure("reference_unavailable", diagnosticReference);
  }

  try {
    return await Reflect.apply(decrypt, undefined, [ciphertext, {
      trustedScope: scope,
      keyVersion: stored.keyVersion,
      purpose
    }]);
  } catch {
    throw failure("reference_unavailable", diagnosticReference);
  }
}

export type ProviderFieldSelection = true | ProviderArraySelection | ProviderObjectSelection;

export interface ProviderArraySelection {
  readonly $each: ProviderFieldSelection;
}

export interface ProviderObjectSelection {
  readonly [field: string]: ProviderFieldSelection;
}

function validSelectionKey(key: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) &&
    key !== "__proto__" && key !== "prototype" && key !== "constructor";
}

function projectValue(
  value: unknown,
  selection: ProviderFieldSelection,
  depth: number,
  diagnosticReference?: unknown
): unknown {
  if (depth > 12) throw failure("provider_payload_policy_invalid", diagnosticReference);
  if (selection === true) {
    if (
      value === null || typeof value === "string" || typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      if (typeof value === "string" && value.length > 8192) {
        throw failure("provider_payload_policy_invalid", diagnosticReference);
      }
      return value;
    }
    throw failure("provider_payload_policy_invalid", diagnosticReference);
  }

  const selectionFields = snapshotRecord(selection, "provider_payload_policy_invalid", diagnosticReference);
  const selectionKeys = Object.keys(selectionFields);
  if (selectionKeys.length === 1 && selectionKeys[0] === "$each") {
    const valueItems = snapshotDataArray(value, 1000, "provider_payload_policy_invalid", diagnosticReference);
    const eachSelection = selectionFields.$each as ProviderFieldSelection;
    const projected: unknown[] = [];
    for (const item of valueItems) projected.push(projectValue(item, eachSelection, depth + 1, diagnosticReference));
    return Object.freeze(projected);
  }
  if (value === null) return null;
  let valueFields: Record<string, unknown>;
  try {
    valueFields = snapshotRecord(value, "provider_payload_policy_invalid", diagnosticReference);
  } catch {
    throw failure("provider_payload_policy_invalid", diagnosticReference);
  }
  if (!isRecord(value)) {
    if (value === null) return null;
    throw failure("provider_payload_policy_invalid", diagnosticReference);
  }

  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of selectionKeys) {
    if (!validSelectionKey(key)) throw failure("provider_payload_policy_invalid", diagnosticReference);
    if (!Object.hasOwn(valueFields, key)) continue;
    projected[key] = projectValue(valueFields[key], selectionFields[key] as ProviderFieldSelection, depth + 1, diagnosticReference);
  }
  return Object.freeze(projected);
}

/** Project only explicitly reviewed fields; nested objects and arrays need nested selections. */
export function minimizeProviderPayload<T = Readonly<Record<string, unknown>>>(input: {
  readonly value: unknown;
  readonly fields: ProviderFieldSelection;
  readonly diagnosticReference?: unknown;
}): T {
  const fields = snapshotRecord(input, "provider_payload_policy_invalid");
  const diagnosticReference = fields.diagnosticReference;
  const value = snapshotRecord(fields.value, "provider_payload_policy_invalid", diagnosticReference);
  return projectValue(value, fields.fields as ProviderFieldSelection, 0, diagnosticReference) as T;
}

export interface ServerSecretLease {
  readonly secret: string;
  readonly version: string;
  readonly mode: ProviderMode;
}

export interface ServerSecretSource {
  /** Resolve from a server-side secret manager on each operation; do not cache across rotation. */
  load(input: { readonly providerId: string; readonly secretReference: string; readonly mode: ProviderMode }): Promise<ServerSecretLease | undefined>;
}

export interface ServerSecretContext {
  readonly secret: string;
  readonly version: string;
  readonly mode: ProviderMode;
}

export async function withServerSecret<T>(input: {
  readonly providerId: unknown;
  readonly secretReference: unknown;
  readonly mode: unknown;
  readonly source: ServerSecretSource;
  readonly use: (context: ServerSecretContext) => Promise<T>;
  readonly diagnosticReference?: unknown;
}): Promise<T> {
  const fields = snapshotRecord(input, "server_secret_unavailable");
  const diagnosticReference = fields.diagnosticReference;
  const mode = fields.mode;
  const providerId = fields.providerId;
  const secretReference = fields.secretReference;
  if (!validMode(mode)) throw failure("mode_mismatch", diagnosticReference);
  if (!validIdentifier(providerId) || !validIdentifier(secretReference)) {
    throw failure("server_secret_unavailable", diagnosticReference);
  }
  const load = captureMethod(fields.source, "load", "server_secret_unavailable", diagnosticReference);
  const use = fields.use;
  if (typeof use !== "function") throw failure("server_secret_unavailable", diagnosticReference);

  let leaseRaw: unknown;
  try {
    leaseRaw = await Reflect.apply(load, undefined, [Object.freeze({ providerId, secretReference, mode })]);
  } catch {
    throw failure("server_secret_unavailable", diagnosticReference);
  }
  let lease: Record<string, unknown>;
  try {
    lease = snapshotRecord(leaseRaw, "server_secret_unavailable", diagnosticReference);
  } catch {
    throw failure("server_secret_unavailable", diagnosticReference);
  }
  if (
    typeof lease.secret !== "string" || lease.secret.length === 0 ||
    lease.secret.length > 65536 || !validIdentifier(lease.version) || lease.mode !== mode
  ) {
    throw failure("server_secret_unavailable", diagnosticReference);
  }

  try {
    return await Reflect.apply(use, undefined, [Object.freeze({ secret: lease.secret, version: lease.version, mode })]) as T;
  } catch {
    throw failure("provider_operation_failed", diagnosticReference);
  }
}

export function isPublicIPAddress(value: string): boolean {
  const ipv4 = parseIPv4(value);
  if (ipv4 !== undefined) return isPublicIPv4(ipv4);
  const ipv6 = parseIPv6(value);
  if (ipv6 === undefined) return false;
  return isPublicIPv6(ipv6);
}

function parseIPv4(value: string): readonly number[] | undefined {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return undefined;
  const parts = value.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
  return parts;
}

function isPublicIPv4(parts: readonly number[]): boolean {
  const [a, b, c] = parts;
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b !== undefined && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIPv6(value: string): bigint | undefined {
  if (!value.includes(":") || value.includes("%") || value.startsWith("[") || value.endsWith("]")) return undefined;
  let text = value.toLowerCase();
  const embeddedV4 = text.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  let v4Groups: string[] = [];
  if (embeddedV4 !== null) {
    const octets = parseIPv4(embeddedV4[1] ?? "");
    if (octets === undefined) return undefined;
    const [a, b, c, d] = octets;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return undefined;
    v4Groups = [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
    text = text.slice(0, text.length - (embeddedV4[1]?.length ?? 0)) + v4Groups.join(":");
    if (text.endsWith(":")) text = text.slice(0, -1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const leftText = halves[0] ?? "";
  const rightText = halves.length === 2 ? (halves[1] ?? "") : "";
  const left = leftText === "" ? [] : leftText.split(":");
  const right = rightText === "" ? [] : rightText.split(":");
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return undefined;
  if (halves.length === 2 && missing < 1) return undefined;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) => Number.parseInt(part, 16));
  if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) return undefined;
  let result = 0n;
  for (const part of groups) result = (result << 16n) | BigInt(part);
  return result;
}

function ipv6Prefix(value: bigint, prefix: bigint, bits: number): boolean {
  return value >> BigInt(128 - bits) === prefix;
}

function isPublicIPv6(value: bigint): boolean {
  if (!ipv6Prefix(value, 0x1n, 3)) return false;
  if (ipv6Prefix(value, 0x100080n, 23)) return false;
  if (ipv6Prefix(value, 0x20010db8n, 32)) return false;
  if (ipv6Prefix(value, 0x2002n, 16)) return false;
  if (ipv6Prefix(value, 0x3fff0n, 20)) return false;
  return true;
}

function canonicalIp(value: string): string | undefined {
  const ipv4 = parseIPv4(value);
  if (ipv4 !== undefined) return ipv4.join(".");
  const ipv6 = parseIPv6(value);
  if (ipv6 === undefined) return undefined;
  const groups: string[] = [];
  for (let index = 7; index >= 0; index -= 1) {
    groups.push(((ipv6 >> BigInt(index * 16)) & 0xffffn).toString(16));
  }
  return groups.join(":");
}

export type SafeAssetMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface SafeAssetPolicy {
  readonly allowedHosts: readonly string[];
  readonly allowedMimeTypes: readonly SafeAssetMimeType[];
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
}

export interface AssetResolver {
  resolve(hostname: string, signal: AbortSignal): Promise<readonly string[]>;
}

export interface AssetRequest {
  readonly mode: ProviderMode;
  readonly trustedScope: TrustedScope;
  readonly url: string;
  readonly hostname: string;
  readonly connectTo: readonly string[];
  readonly tlsServerName: string;
  readonly redirect: "manual";
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly method: "GET";
}

export interface AssetResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly connectedAddress: string;
  readonly body?: Uint8Array | AsyncIterable<Uint8Array>;
}

export interface AssetTransport {
  /** Must connect only to `connectTo`, preserve TLS verification for `tlsServerName`, and never auto-follow redirects. */
  request(input: AssetRequest): Promise<AssetResponse>;
}

export interface RetrievedAsset {
  readonly bytes: Uint8Array;
  readonly contentType: SafeAssetMimeType;
  readonly sha256: string;
  readonly byteLength: number;
  readonly finalHost: string;
  readonly redirectCount: number;
}

function normalizeDnsHostname(hostname: string): string | undefined {
  const normalized = hostname.toLowerCase();
  if (
    normalized.length < 1 || normalized.length > 253 || normalized.endsWith(".") ||
    normalized.includes(":") || normalized.startsWith("[") || normalized.endsWith("]") ||
    parseIPv4(normalized) !== undefined
  ) return undefined;
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) =>
    label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  )) return undefined;
  return normalized;
}

function snapshotAssetPolicy(value: unknown, diagnosticReference?: unknown): SafeAssetPolicy {
  const fields = snapshotRecord(value, "asset_policy_invalid", diagnosticReference);
  const allowedHosts = snapshotStringArray(fields.allowedHosts, 100, "asset_policy_invalid", diagnosticReference);
  const allowedMimeTypes = snapshotStringArray(fields.allowedMimeTypes, 3, "asset_policy_invalid", diagnosticReference);
  const maxBytes = fields.maxBytes;
  const timeoutMs = fields.timeoutMs;
  const maxRedirects = fields.maxRedirects;
  if (
    allowedHosts.length === 0 || allowedMimeTypes.length === 0 ||
    allowedMimeTypes.some((type) => !SUPPORTED_ASSET_TYPES.has(type)) ||
    !Number.isSafeInteger(maxBytes) || (maxBytes as number) < 1 || (maxBytes as number) > 20 * 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 || (timeoutMs as number) > 30_000 ||
    !Number.isSafeInteger(maxRedirects) || (maxRedirects as number) < 0 || (maxRedirects as number) > 5
  ) {
    throw failure("asset_policy_invalid", diagnosticReference);
  }
  return Object.freeze({
    allowedHosts: Object.freeze(allowedHosts),
    allowedMimeTypes: Object.freeze(allowedMimeTypes as SafeAssetMimeType[]),
    maxBytes: maxBytes as number,
    timeoutMs: timeoutMs as number,
    maxRedirects: maxRedirects as number
  });
}

function normalizedAllowedHosts(policy: SafeAssetPolicy, diagnosticReference?: unknown): Set<string> {
  const hostsInput = snapshotStringArray(policy.allowedHosts, 100, "asset_policy_invalid", diagnosticReference);
  if (hostsInput.length === 0) throw failure("asset_policy_invalid", diagnosticReference);
  const hosts = new Set<string>();
  for (const host of hostsInput) {
    if (typeof host !== "string") throw failure("asset_policy_invalid", diagnosticReference);
    const normalized = normalizeDnsHostname(host);
    if (normalized === undefined || normalized !== host.toLowerCase()) {
      throw failure("asset_policy_invalid", diagnosticReference);
    }
    hosts.add(normalized);
  }
  const policyFields = snapshotRecord(policy, "asset_policy_invalid", diagnosticReference);
  const allowedMimeTypes = snapshotStringArray(policyFields.allowedMimeTypes, 3, "asset_policy_invalid", diagnosticReference);
  if (allowedMimeTypes.length === 0 || allowedMimeTypes.some((type) => !SUPPORTED_ASSET_TYPES.has(type)) ||
    !Number.isSafeInteger(policyFields.maxBytes) || (policyFields.maxBytes as number) < 1 || (policyFields.maxBytes as number) > 20 * 1024 * 1024 ||
    !Number.isSafeInteger(policyFields.timeoutMs) || (policyFields.timeoutMs as number) < 1 || (policyFields.timeoutMs as number) > 30_000 ||
    !Number.isSafeInteger(policyFields.maxRedirects) || (policyFields.maxRedirects as number) < 0 || (policyFields.maxRedirects as number) > 5) {
    throw failure("asset_policy_invalid", diagnosticReference);
  }
  return hosts;
}

function parseApprovedAssetUrl(value: unknown, hosts: ReadonlySet<string>, diagnosticReference?: unknown): URL {
  if (typeof value !== "string" || value.length < 1 || value.length > 8192) {
    throw failure("asset_url_rejected", diagnosticReference);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw failure("asset_url_rejected", diagnosticReference);
  }
  if (
    parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
    parsed.hash !== "" || (parsed.port !== "" && parsed.port !== "443")
  ) {
    throw failure("asset_url_rejected", diagnosticReference);
  }
  const hostname = normalizeDnsHostname(parsed.hostname);
  if (hostname === undefined || !hosts.has(hostname)) {
    throw failure("asset_host_rejected", diagnosticReference);
  }
  return parsed;
}

function snapshotAssetHeaders(value: unknown, diagnosticReference?: unknown): Readonly<Record<string, string>> {
  const raw = snapshotRecord(value, "asset_response_invalid", diagnosticReference);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(raw)) {
    const normalized = key.toLowerCase();
    if (!/^[a-z0-9-]{1,128}$/.test(key) || typeof raw[key] !== "string" || Object.hasOwn(result, normalized)) {
      throw failure("asset_response_invalid", diagnosticReference);
    }
    result[normalized] = raw[key] as string;
  }
  return Object.freeze(result);
}

function header(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  return headers[name];
}

function hasValidMagic(bytes: Uint8Array, contentType: SafeAssetMimeType): boolean {
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

async function collectAssetBody(
  body: unknown,
  maxBytes: number,
  signal: AbortSignal,
  diagnosticReference?: unknown
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (body === undefined) throw failure("asset_response_invalid", diagnosticReference);
  try {
    const chunksIterable = (async function* (): AsyncGenerator<unknown> {
      if (isUint8Array(body)) {
        const length = byteLengthOf(body, "asset_response_invalid", diagnosticReference);
        if (length > maxBytes) throw failure("asset_too_large", diagnosticReference);
        yield copyBytes(body, maxBytes, "asset_response_invalid", diagnosticReference);
        return;
      }
      const iteratorMethod = captureMethod(body, Symbol.asyncIterator, "asset_response_invalid", diagnosticReference);
      const iterator = Reflect.apply(iteratorMethod, undefined, []) as unknown;
      const next = captureMethod(iterator, "next", "asset_response_invalid", diagnosticReference);
      while (true) {
        let stepRaw: unknown;
        try {
          stepRaw = await Reflect.apply(next, undefined, []);
        } catch {
          throw failure("asset_retrieval_failed", diagnosticReference);
        }
        const step = snapshotRecord(stepRaw, "asset_response_invalid", diagnosticReference);
        if (step.done === true) return;
        if (step.done !== false) throw failure("asset_response_invalid", diagnosticReference);
        const chunkLength = byteLengthOf(step.value, "asset_response_invalid", diagnosticReference);
        if (byteLength + chunkLength > maxBytes) throw failure("asset_too_large", diagnosticReference);
        yield copyBytes(step.value, maxBytes, "asset_response_invalid", diagnosticReference);
      }
    })();
    for await (const chunk of chunksIterable) {
      if (signal.aborted) throw failure("asset_timeout", diagnosticReference);
      const ownedChunk = copyBytes(chunk, maxBytes, "asset_response_invalid", diagnosticReference);
      byteLength += ownedChunk.byteLength;
      if (byteLength > maxBytes) throw failure("asset_too_large", diagnosticReference);
      chunks.push(ownedChunk);
    }
  } catch (error) {
    if (error instanceof SecurityBoundaryError) throw error;
    if (signal.aborted) throw failure("asset_timeout", diagnosticReference);
    throw failure("asset_retrieval_failed", diagnosticReference);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function sha256(bytes: Uint8Array, diagnosticReference?: unknown): Promise<string> {
  try {
    const copy = copyBytes(bytes, 20 * 1024 * 1024, "asset_approval_mismatch", diagnosticReference);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
    const hex = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    return `sha256:${hex}`;
  } catch {
    throw failure("asset_retrieval_failed", diagnosticReference);
  }
}

function throwIfAborted(signal: AbortSignal, diagnosticReference?: unknown): void {
  if (signal.aborted) throw failure("asset_timeout", diagnosticReference);
}

async function retrieveWithinDeadline(input: {
  readonly url: unknown;
  readonly mode: ProviderMode;
  readonly trustedScope: TrustedScope;
  readonly policy: SafeAssetPolicy;
  readonly hosts: ReadonlySet<string>;
  readonly resolve: (hostname: string, signal: AbortSignal) => Promise<readonly string[]>;
  readonly request: (request: AssetRequest) => Promise<AssetResponse>;
  readonly signal: AbortSignal;
  readonly diagnosticReference?: unknown;
}): Promise<RetrievedAsset> {
  let current = parseApprovedAssetUrl(input.url, input.hosts, input.diagnosticReference);
  let redirectCount = 0;

  while (true) {
    throwIfAborted(input.signal, input.diagnosticReference);
    const hostname = normalizeDnsHostname(current.hostname);
    if (hostname === undefined || !input.hosts.has(hostname)) throw failure("asset_host_rejected", input.diagnosticReference);

    let answers: readonly string[];
    try {
      answers = await input.resolve(hostname, input.signal);
    } catch {
      if (input.signal.aborted) throw failure("asset_timeout", input.diagnosticReference);
      throw failure("asset_retrieval_failed", input.diagnosticReference);
    }
    throwIfAborted(input.signal, input.diagnosticReference);
    let answerSnapshot: string[];
    try {
      answerSnapshot = snapshotStringArray(answers, 32, "asset_address_rejected", input.diagnosticReference);
    } catch {
      throw failure("asset_address_rejected", input.diagnosticReference);
    }
    if (answerSnapshot.length === 0) {
      throw failure("asset_address_rejected", input.diagnosticReference);
    }
    const addresses = answerSnapshot.map((address) => canonicalIp(address));
    if (addresses.some((address) => address === undefined || !isPublicIPAddress(address))) {
      throw failure("asset_address_rejected", input.diagnosticReference);
    }
    const pinnedAddresses = [...new Set(addresses as string[])];
    const request: AssetRequest = Object.freeze({
      mode: input.mode,
      trustedScope: input.trustedScope,
      url: current.toString(),
      hostname,
      connectTo: Object.freeze(pinnedAddresses),
      tlsServerName: hostname,
      redirect: "manual",
      signal: input.signal,
      maxBytes: input.policy.maxBytes,
      method: "GET"
    });

    let response: AssetResponse;
    try {
      response = await input.request(request);
    } catch {
      if (input.signal.aborted) throw failure("asset_timeout", input.diagnosticReference);
      throw failure("asset_retrieval_failed", input.diagnosticReference);
    }
    throwIfAborted(input.signal, input.diagnosticReference);
    let responseFields: Record<string, unknown>;
    let responseHeaders: Readonly<Record<string, string>>;
    try {
      responseFields = snapshotRecord(response, "asset_response_invalid", input.diagnosticReference);
      responseHeaders = snapshotAssetHeaders(responseFields.headers, input.diagnosticReference);
    } catch {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    const status = responseFields.status;
    const connectedValue = responseFields.connectedAddress;
    let body = responseFields.body;
    if (isUint8Array(body)) {
      const bodyLength = byteLengthOf(body, "asset_response_invalid", input.diagnosticReference);
      if (bodyLength > input.policy.maxBytes) throw failure("asset_too_large", input.diagnosticReference);
      body = copyBytes(body, input.policy.maxBytes, "asset_response_invalid", input.diagnosticReference);
    }
    if (!Number.isInteger(status)) {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    const connectedAddress = typeof connectedValue === "string" ? canonicalIp(connectedValue) : undefined;
    if (
      connectedAddress === undefined || !isPublicIPAddress(connectedAddress) ||
      !pinnedAddresses.includes(connectedAddress)
    ) {
      throw failure("asset_peer_mismatch", input.diagnosticReference);
    }

    if ([301, 302, 303, 307, 308].includes(status as number)) {
      if (redirectCount >= input.policy.maxRedirects) throw failure("asset_redirect_rejected", input.diagnosticReference);
      const location = header(responseHeaders, "location");
      if (location === undefined || location.length > 8192) throw failure("asset_redirect_rejected", input.diagnosticReference);
      let redirected: URL;
      try {
        redirected = new URL(location, current);
      } catch {
        throw failure("asset_redirect_rejected", input.diagnosticReference);
      }
      parseApprovedAssetUrl(redirected.toString(), input.hosts, input.diagnosticReference);
      current = redirected;
      redirectCount += 1;
      continue;
    }
    if (status !== 200) throw failure("asset_response_invalid", input.diagnosticReference);

    const contentEncoding = header(responseHeaders, "content-encoding");
    if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    const declaredLength = header(responseHeaders, "content-length");
    if (declaredLength !== undefined) {
      if (!/^\d{1,12}$/.test(declaredLength)) throw failure("asset_response_invalid", input.diagnosticReference);
      const declaredBytes = Number(declaredLength);
      if (!Number.isSafeInteger(declaredBytes)) throw failure("asset_response_invalid", input.diagnosticReference);
      if (declaredBytes > input.policy.maxBytes) throw failure("asset_too_large", input.diagnosticReference);
    }
    const declaredType = header(responseHeaders, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (
      declaredType === undefined || !SUPPORTED_ASSET_TYPES.has(declaredType) ||
      !input.policy.allowedMimeTypes.includes(declaredType as SafeAssetMimeType)
    ) {
      throw failure("asset_type_rejected", input.diagnosticReference);
    }

    const bytes = await collectAssetBody(body, input.policy.maxBytes, input.signal, input.diagnosticReference);
    throwIfAborted(input.signal, input.diagnosticReference);
    if (declaredLength !== undefined && Number(declaredLength) !== bytes.byteLength) {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    if (!hasValidMagic(bytes, declaredType as SafeAssetMimeType)) {
      throw failure("asset_type_rejected", input.diagnosticReference);
    }
    const digest = await sha256(bytes, input.diagnosticReference);
    throwIfAborted(input.signal, input.diagnosticReference);
    return Object.freeze({
      bytes,
      contentType: declaredType as SafeAssetMimeType,
      sha256: digest,
      byteLength: bytes.byteLength,
      finalHost: hostname,
      redirectCount
    });
  }
}

export async function retrieveApprovedAsset(input: {
  readonly url: unknown;
  readonly mode: unknown;
  readonly trustedScope: unknown;
  readonly policy: SafeAssetPolicy;
  readonly resolver: AssetResolver;
  readonly transport: AssetTransport;
  readonly diagnosticReference?: unknown;
}): Promise<RetrievedAsset> {
  const fields = snapshotRecord(input, "asset_policy_invalid");
  const diagnosticReference = fields.diagnosticReference;
  const mode = fields.mode;
  if (!validMode(mode)) throw failure("mode_mismatch", diagnosticReference);
  const url = fields.url;
  const scope = trustedScopeSnapshot(fields.trustedScope, diagnosticReference);
  const policy = snapshotAssetPolicy(fields.policy, diagnosticReference);
  const hosts = normalizedAllowedHosts(policy, diagnosticReference);
  const resolveMethod = captureMethod(fields.resolver, "resolve", "asset_retrieval_failed", diagnosticReference);
  const requestMethod = captureMethod(fields.transport, "request", "asset_retrieval_failed", diagnosticReference);
  const resolve = (hostname: string, signal: AbortSignal): Promise<readonly string[]> =>
    Reflect.apply(resolveMethod, undefined, [hostname, signal]) as Promise<readonly string[]>;
  const request = (assetRequest: AssetRequest): Promise<AssetResponse> =>
    Reflect.apply(requestMethod, undefined, [assetRequest]) as Promise<AssetResponse>;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure("asset_timeout", diagnosticReference));
    }, policy.timeoutMs);
  });
  const operation = retrieveWithinDeadline({
    url,
    mode,
    trustedScope: scope,
    policy,
    hosts,
    resolve,
    request,
    signal: controller.signal,
    diagnosticReference
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof SecurityBoundaryError) throw error;
    if (controller.signal.aborted) throw failure("asset_timeout", diagnosticReference);
    throw failure("asset_retrieval_failed", diagnosticReference);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface ApprovedArtifactIdentity {
  readonly artifactId: string;
  readonly sha256: string;
  readonly contentType: SafeAssetMimeType;
  readonly byteLength: number;
  readonly termsFingerprint: string;
}

export interface SignedAssetAccess {
  readonly url: string;
  readonly expiresAt: number;
  readonly approved: ApprovedArtifactIdentity;
}

function snapshotApprovedIdentity(value: unknown, diagnosticReference?: unknown): ApprovedArtifactIdentity {
  const fields = snapshotRecord(value, "asset_approval_mismatch", diagnosticReference);
  const artifactId = fields.artifactId;
  const digest = fields.sha256;
  const contentType = fields.contentType;
  const byteLength = fields.byteLength;
  const termsFingerprint = fields.termsFingerprint;
  if (
    !validIdentifier(artifactId) || typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/i.test(digest) ||
    typeof contentType !== "string" || !SUPPORTED_ASSET_TYPES.has(contentType) ||
    !Number.isSafeInteger(byteLength) || (byteLength as number) < 1 ||
    !validIdentifier(termsFingerprint)
  ) {
    throw failure("asset_approval_mismatch", diagnosticReference);
  }
  return Object.freeze({
    artifactId,
    sha256: digest.toLowerCase(),
    contentType: contentType as SafeAssetMimeType,
    byteLength: byteLength as number,
    termsFingerprint
  });
}

export function refreshSignedAssetAccess(input: {
  readonly previous: SignedAssetAccess;
  readonly refreshed: SignedAssetAccess;
  readonly allowedHosts: readonly string[];
  readonly now: number;
  readonly diagnosticReference?: unknown;
}): SignedAssetAccess {
  const fields = snapshotRecord(input, "refresh_changed_approval");
  const diagnosticReference = fields.diagnosticReference;
  const allowedHosts = snapshotStringArray(fields.allowedHosts, 100, "refresh_changed_approval", diagnosticReference);
  const now = fields.now;
  const previousFields = snapshotRecord(fields.previous, "refresh_changed_approval", diagnosticReference);
  const refreshedFields = snapshotRecord(fields.refreshed, "refresh_changed_approval", diagnosticReference);
  const previousIdentity = snapshotApprovedIdentity(previousFields.approved, diagnosticReference);
  const refreshedIdentity = snapshotApprovedIdentity(refreshedFields.approved, diagnosticReference);
  const previousUrlValue = previousFields.url;
  const refreshedUrlValue = refreshedFields.url;
  const refreshedExpiresAt = refreshedFields.expiresAt;
  const hosts = normalizedAllowedHosts({
    allowedHosts,
    allowedMimeTypes: ["image/png"],
    maxBytes: 1,
    timeoutMs: 1,
    maxRedirects: 0
  }, diagnosticReference);
  let previousUrl: URL;
  let refreshedUrl: URL;
  try {
    previousUrl = parseApprovedAssetUrl(previousUrlValue, hosts, diagnosticReference);
    refreshedUrl = parseApprovedAssetUrl(refreshedUrlValue, hosts, diagnosticReference);
  } catch {
    throw failure("refresh_changed_approval", diagnosticReference);
  }
  void previousUrl;
  if (!Number.isFinite(now) || !Number.isFinite(refreshedExpiresAt) || (refreshedExpiresAt as number) <= (now as number)) {
    throw failure("asset_approval_mismatch", diagnosticReference);
  }
  const previous = previousIdentity;
  const refreshed = refreshedIdentity;
  if (
    previous.artifactId !== refreshed.artifactId || previous.sha256 !== refreshed.sha256 ||
    previous.contentType !== refreshed.contentType || previous.byteLength !== refreshed.byteLength ||
    previous.termsFingerprint !== refreshed.termsFingerprint
  ) {
    throw failure("refresh_changed_approval", diagnosticReference);
  }
  return Object.freeze({
    url: refreshedUrl.toString(),
    expiresAt: refreshedExpiresAt as number,
    approved: previous
  });
}

export async function assertRetrievedAssetMatchesApproval(input: {
  readonly asset: RetrievedAsset;
  readonly approved: ApprovedArtifactIdentity;
  readonly diagnosticReference?: unknown;
}): Promise<Uint8Array> {
  const fields = snapshotRecord(input, "asset_approval_mismatch");
  const diagnosticReference = fields.diagnosticReference;
  const asset = snapshotRecord(fields.asset, "asset_approval_mismatch", diagnosticReference);
  const approved = snapshotApprovedIdentity(fields.approved, diagnosticReference);
  const bytes = copyBytes(asset.bytes, 20 * 1024 * 1024, "asset_approval_mismatch", diagnosticReference);
  const assetByteLength = asset.byteLength;
  const assetContentType = asset.contentType;
  const assetDigest = asset.sha256;
  const actualDigest = await sha256(bytes, diagnosticReference);
  if (
    assetByteLength !== approved.byteLength || bytes.byteLength !== approved.byteLength ||
    assetContentType !== approved.contentType || assetDigest !== approved.sha256 ||
    actualDigest !== approved.sha256
  ) {
    throw failure("asset_approval_mismatch", diagnosticReference);
  }
  return bytes;
}

export interface TombstoneFingerprint {
  readonly keyVersion: string;
  readonly digest: string;
}

/** A freshly issued fingerprint. `maxRetainUntil` is the latest `retainUntil` (ms since the epoch)
 * a tombstone storing it may use: the issuing key version stays verifiable at least that long.
 * Tombstones expire exclusively at `retainUntil`. The bound is not stored in the tombstone. */
export interface IssuedTombstoneFingerprint extends TombstoneFingerprint {
  readonly maxRetainUntil: number;
}

export interface TombstoneFingerprinter {
  /** Use a stable server-held key distinct from rotating provider API credentials. The result must
   * carry the retention bound of the issuing key version; `purgeSensitiveRecord` requires it. */
  fingerprint(purpose: "authorization_action" | "idempotency_key", canonicalIdentity: string): Promise<IssuedTombstoneFingerprint>;
}

export interface IdempotencyTombstone {
  readonly tenantId: string;
  readonly projectId: string;
  readonly actionFingerprint: TombstoneFingerprint;
  readonly idempotencyFingerprint: TombstoneFingerprint;
  readonly deletedAt: number;
  readonly retainUntil: number;
}

export interface SensitiveRecordRetentionPort {
  /** This operation must atomically erase personal fields and retain the supplied non-sensitive tombstone. */
  purgePersonalDataAndRetainTombstone(input: {
    readonly reference: string;
    readonly trustedScope: TrustedScope;
    readonly tombstone: IdempotencyTombstone;
  }): Promise<void>;
}

function canonicalIdentity(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function snapshotFingerprint(value: unknown, diagnosticReference?: unknown): { readonly fingerprint: TombstoneFingerprint; readonly maxRetainUntil: number } {
  const fields = snapshotRecord(value, "retention_unavailable", diagnosticReference);
  if (
    !validIdentifier(fields.keyVersion) || typeof fields.digest !== "string" || !/^[A-Za-z0-9_-]{32,128}$/.test(fields.digest) ||
    !Number.isSafeInteger(fields.maxRetainUntil)
  ) {
    throw failure("retention_unavailable", diagnosticReference);
  }
  return {
    fingerprint: Object.freeze({ keyVersion: fields.keyVersion, digest: fields.digest }),
    maxRetainUntil: fields.maxRetainUntil as number
  };
}

export async function purgeSensitiveRecord(input: {
  readonly reference: unknown;
  readonly trustedScope: unknown;
  readonly providerId: unknown;
  readonly authorizationId: unknown;
  readonly actionId: unknown;
  readonly idempotencyKey: unknown;
  readonly deletedAt: number;
  readonly retainUntil: number;
  readonly fingerprinter: TombstoneFingerprinter;
  readonly retentionPort: SensitiveRecordRetentionPort;
  readonly diagnosticReference?: unknown;
}): Promise<IdempotencyTombstone> {
  const fields = snapshotRecord(input, "retention_policy_invalid");
  const diagnosticReference = fields.diagnosticReference;
  const scope = trustedScopeSnapshot(fields.trustedScope, diagnosticReference);
  const reference = fields.reference;
  const providerId = fields.providerId;
  const authorizationId = fields.authorizationId;
  const actionId = fields.actionId;
  const idempotencyKey = fields.idempotencyKey;
  const deletedAt = fields.deletedAt;
  const retainUntil = fields.retainUntil;
  if (
    !validIdentifier(reference) || !validIdentifier(providerId) ||
    !validIdentifier(authorizationId) || !validIdentifier(actionId) ||
    !validIdentifier(idempotencyKey) || !Number.isSafeInteger(deletedAt) ||
    !Number.isSafeInteger(retainUntil) || (deletedAt as number) < 0 || (retainUntil as number) <= (deletedAt as number)
  ) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  const fingerprint = captureMethod(fields.fingerprinter, "fingerprint", "retention_unavailable", diagnosticReference);
  const purge = captureMethod(fields.retentionPort, "purgePersonalDataAndRetainTombstone", "retention_unavailable", diagnosticReference);

  const actionIdentity = canonicalIdentity([
    scope.tenantId, scope.projectId, providerId as string, authorizationId as string, actionId as string
  ]);
  const idempotencyIdentity = canonicalIdentity([
    scope.tenantId, scope.projectId, providerId as string, idempotencyKey as string
  ]);
  let actionFingerprint: TombstoneFingerprint;
  let idempotencyFingerprint: TombstoneFingerprint;
  try {
    [actionFingerprint, idempotencyFingerprint] = await Promise.all([
      Reflect.apply(fingerprint, undefined, ["authorization_action", actionIdentity]) as Promise<TombstoneFingerprint>,
      Reflect.apply(fingerprint, undefined, ["idempotency_key", idempotencyIdentity]) as Promise<TombstoneFingerprint>
    ]);
  } catch {
    throw failure("retention_unavailable", diagnosticReference);
  }
  let maxRetainUntil: number;
  try {
    const action = snapshotFingerprint(actionFingerprint, diagnosticReference);
    const idempotency = snapshotFingerprint(idempotencyFingerprint, diagnosticReference);
    actionFingerprint = action.fingerprint;
    idempotencyFingerprint = idempotency.fingerprint;
    maxRetainUntil = Math.min(action.maxRetainUntil, idempotency.maxRetainUntil);
  } catch {
    throw failure("retention_unavailable", diagnosticReference);
  }
  if ((retainUntil as number) > maxRetainUntil) {
    // A tombstone must not outlive the retention window of the key version that fingerprinted it.
    // The bound travels with the issued fingerprint, so a wrapped fingerprinter keeps the guard and
    // one that drops the bound fails closed above.
    throw failure("retention_policy_invalid", diagnosticReference);
  }

  const tombstone: IdempotencyTombstone = Object.freeze({
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    actionFingerprint,
    idempotencyFingerprint,
    deletedAt: deletedAt as number,
    retainUntil: retainUntil as number
  });
  try {
    await Reflect.apply(purge, undefined, [Object.freeze({
      reference: reference as string,
      trustedScope: scope,
      tombstone
    })]);
  } catch {
    throw failure("retention_unavailable", diagnosticReference);
  }
  return tombstone;
}

// ---------------------------------------------------------------------------
// Tombstone fingerprint keyring (docs/key-management.md)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Overridable policy defaults. Retired-key retention has no default: it must cover the
 * longest approved tombstone retention period, which this package does not invent. */
export const TOMBSTONE_FINGERPRINT_KEY_POLICY_DEFAULTS = Object.freeze({
  rotationIntervalMs: 90 * DAY_MS,
  maxActiveKeyAgeMs: 180 * DAY_MS,
  maxKeyVersions: 64,
  maxClockSkewMs: 5 * MINUTE_MS
});

/** Hard limits. A policy cannot override them. */
export const TOMBSTONE_FINGERPRINT_KEY_LIMITS = Object.freeze({
  minKeyBytes: 32,
  maxKeyBytes: 1024,
  /** A key with this many or fewer distinct byte values is rejected as degenerate (all-same bytes, ASCII hex). */
  maxDegenerateDistinctKeyBytes: 16,
  /** Upper bound for `policy.maxKeyVersions` and for any loaded key set. */
  maxKeyVersions: 256,
  minKeyVersions: 2,
  /** Upper bound for `policy.maxClockSkewMs`. */
  maxClockSkewMs: 60 * MINUTE_MS,
  /** Upper bound for `policy.retiredKeyRetentionMs` (100 years of 365 days), so every retention
   * bound and purge time stays a safe integer. */
  maxRetiredKeyRetentionMs: 100 * 365 * DAY_MS
});

/** `<label>-g<generation>`: the generation is a positive integer that only ever increases. */
const FINGERPRINT_KEY_VERSION_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]{0,47})-g([1-9][0-9]{0,14})$/;
const FINGERPRINT_KEY_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;
const FINGERPRINT_DIGEST_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const FINGERPRINT_DOMAIN = "fulfillment-connectors/tombstone-fingerprint/v1";
const FINGERPRINT_PURPOSES: ReadonlySet<string> = new Set(["authorization_action", "idempotency_key"]);
const MAX_CANONICAL_IDENTITY_LENGTH = 8192;
const KEY_MATERIAL_FIELDS: ReadonlySet<string> = new Set(["keyVersion", "key", "state", "activatedAt", "retiredAt"]);
const KEY_METADATA_FIELDS: ReadonlySet<string> = new Set(["keyVersion", "state", "activatedAt", "retiredAt"]);
const KEY_POLICY_FIELDS: ReadonlySet<string> = new Set([
  "rotationIntervalMs", "maxActiveKeyAgeMs", "retiredKeyRetentionMs", "maxKeyVersions", "maxClockSkewMs"
]);
const stringIsWellFormed = (String.prototype as unknown as { isWellFormed?: (this: string) => boolean }).isWellFormed;

export type TombstoneFingerprintPurpose = "authorization_action" | "idempotency_key";
export type FingerprintKeyState = "active" | "retired";

export interface FingerprintKeyMetadata {
  /** `<label>-g<generation>`, for example `tombstone-g7`. Generations strictly increase with activation. */
  readonly keyVersion: string;
  readonly state: FingerprintKeyState;
  /** Milliseconds since the epoch. */
  readonly activatedAt: number;
  /** Required for retired keys, absent for the active key. Equals the successor's `activatedAt`. */
  readonly retiredAt?: number;
}

export interface FingerprintKeyMaterial extends FingerprintKeyMetadata {
  /** At least 32 random bytes from the server-side secret manager, already decoded from any
   * hex or base64 text encoding. Never a supplier credential. */
  readonly key: Uint8Array;
}

export interface FingerprintKeySet {
  readonly keys: readonly FingerprintKeyMaterial[];
}

export interface FingerprintKeySource {
  /** Resolve the complete versioned key set for one keyring reference from the approved
   * server-side secret manager on each operation; do not cache across rotation. */
  load(input: { readonly keyringReference: string }): Promise<FingerprintKeySet | undefined>;
}

export interface TombstoneFingerprintKeyPolicy {
  /** Scheduled rotation cadence. Default 90 days. */
  readonly rotationIntervalMs?: number;
  /** Hard limit. Past this age the active key stops issuing fingerprints. Default 180 days. */
  readonly maxActiveKeyAgeMs?: number;
  /** Required. How long a retired key stays verifiable; at least the longest approved tombstone
   * retention. At most `TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxRetiredKeyRetentionMs` (100 years). */
  readonly retiredKeyRetentionMs: number;
  /** Retained versions a scheduled rotation may produce. Default 64, at most 256. Creation fails when
   * `ceil((retiredKeyRetentionMs + maxClockSkewMs) / rotationIntervalMs) + 2` exceeds it. */
  readonly maxKeyVersions?: number;
  /** Tolerated clock difference between hosts. Default 5 minutes, at most 60 minutes. */
  readonly maxClockSkewMs?: number;
}

export interface FingerprintKeyringStatus {
  readonly keyringReference: string;
  readonly activeKeyVersion: string;
  readonly activeKeyAgeMs: number;
  /** The scheduled rotation interval has elapsed. */
  readonly rotationDue: boolean;
  /** The hard age limit has elapsed; new fingerprints fail closed until rotation. */
  readonly rotationRequired: boolean;
  /** Active first, then retired keys still inside their retention window. */
  readonly verifiableKeyVersions: readonly string[];
  /** Retired keys past retention, oldest first. Remove them from the secret manager in this order, only
   * after their tombstones are deleted. `candidates` still covers them until they are removed. */
  readonly purgeableKeyVersions: readonly string[];
}

export interface TombstoneFingerprintKeyring extends TombstoneFingerprinter {
  /** HMAC-SHA256 with the active key; the key version is part of the HMAC input and the result.
   * `maxRetainUntil` is the latest `retainUntil` a tombstone storing this fingerprint may use. */
  fingerprint(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string): Promise<IssuedTombstoneFingerprint>;
  /** One fingerprint per key version in the set, for a store lookup: the active key, the retired keys
   * inside retention, then (oldest first) retired keys past retention that are still in the set. A
   * store must confirm every hit with `matches`, which throws for a version past retention. */
  candidates(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string): Promise<readonly TombstoneFingerprint[]>;
  /** Constant-time check of a stored fingerprint. Throws (never returns false) for a key version that
   * is unknown or past its retention window. */
  matches(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string, stored: TombstoneFingerprint): Promise<boolean>;
  /** Key versions and rotation state only; never key material. */
  status(): Promise<FingerprintKeyringStatus>;
}

interface ResolvedKeyPolicy {
  readonly rotationIntervalMs: number;
  readonly maxActiveKeyAgeMs: number;
  readonly retiredKeyRetentionMs: number;
  readonly maxKeyVersions: number;
  readonly maxClockSkewMs: number;
}

type HmacKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

interface LoadedFingerprintKey {
  readonly keyVersion: string;
  readonly activatedAt: number;
  readonly cryptoKey: HmacKey;
}

interface LoadedFingerprintKeySet {
  readonly now: number;
  readonly active: LoadedFingerprintKey;
  readonly verifiable: readonly LoadedFingerprintKey[];
  /** Past retention but still in the set, oldest first. Used only by `candidates`, never by `matches`. */
  readonly purgeableKeys: readonly LoadedFingerprintKey[];
  readonly purgeable: readonly string[];
}

function boundedInteger(value: unknown, fallback: number | undefined, min: number, max: number, diagnosticReference?: unknown): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || (resolved as number) < min || (resolved as number) > max) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  return resolved as number;
}

function resolveKeyPolicy(value: unknown, diagnosticReference?: unknown): ResolvedKeyPolicy {
  const fields = snapshotRecord(value, "retention_policy_invalid", diagnosticReference);
  for (const key of Object.keys(fields)) {
    if (!KEY_POLICY_FIELDS.has(key)) throw failure("retention_policy_invalid", diagnosticReference);
  }
  const defaults = TOMBSTONE_FINGERPRINT_KEY_POLICY_DEFAULTS;
  const limits = TOMBSTONE_FINGERPRINT_KEY_LIMITS;
  const max = Number.MAX_SAFE_INTEGER;
  const rotationIntervalMs = boundedInteger(fields.rotationIntervalMs, defaults.rotationIntervalMs, 1, max, diagnosticReference);
  const maxActiveKeyAgeMs = boundedInteger(fields.maxActiveKeyAgeMs, defaults.maxActiveKeyAgeMs, 1, max, diagnosticReference);
  const retiredKeyRetentionMs = boundedInteger(
    fields.retiredKeyRetentionMs, undefined, 1, limits.maxRetiredKeyRetentionMs, diagnosticReference
  );
  const maxKeyVersions = boundedInteger(
    fields.maxKeyVersions, defaults.maxKeyVersions, limits.minKeyVersions, limits.maxKeyVersions, diagnosticReference
  );
  const maxClockSkewMs = boundedInteger(fields.maxClockSkewMs, defaults.maxClockSkewMs, 0, limits.maxClockSkewMs, diagnosticReference);
  if (rotationIntervalMs > maxActiveKeyAgeMs || retiredKeyRetentionMs <= maxClockSkewMs) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  // Scheduled rotation keeps every retired version for retention + skew, plus the active key and
  // one version of headroom for an incident rotation. A policy whose cadence cannot fit under the
  // version cap is a configuration fault today, not an outage years from now.
  const retainedAtCadence = Math.ceil((retiredKeyRetentionMs + maxClockSkewMs) / rotationIntervalMs) + 2;
  if (retainedAtCadence > maxKeyVersions) throw failure("retention_policy_invalid", diagnosticReference);
  return Object.freeze({ rotationIntervalMs, maxActiveKeyAgeMs, retiredKeyRetentionMs, maxKeyVersions, maxClockSkewMs });
}

function keyVersionGeneration(keyVersion: unknown): { readonly label: string; readonly generation: number } | undefined {
  if (typeof keyVersion !== "string") return undefined;
  const match = FINGERPRINT_KEY_VERSION_PATTERN.exec(keyVersion);
  if (match === null) return undefined;
  const generation = Number(match[2]);
  if (!Number.isSafeInteger(generation)) return undefined;
  return { label: match[1] as string, generation };
}

function snapshotKeyMetadata(
  value: unknown,
  allowedFields: ReadonlySet<string>,
  latestAllowed: number,
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): { readonly metadata: FingerprintKeyMetadata; readonly generation: number; readonly fields: Record<string, unknown> } {
  const fields = snapshotRecord(value, code, diagnosticReference);
  for (const key of Object.keys(fields)) {
    if (!allowedFields.has(key)) throw failure(code, diagnosticReference);
  }
  const { keyVersion, state, activatedAt, retiredAt } = fields;
  const parsedVersion = keyVersionGeneration(keyVersion);
  if (
    parsedVersion === undefined || (state !== "active" && state !== "retired") ||
    !Number.isSafeInteger(activatedAt) || (activatedAt as number) < 0 || (activatedAt as number) > latestAllowed
  ) {
    throw failure(code, diagnosticReference);
  }
  if (state === "active") {
    if (Object.hasOwn(fields, "retiredAt")) throw failure(code, diagnosticReference);
    return {
      metadata: Object.freeze({ keyVersion: keyVersion as string, state, activatedAt: activatedAt as number }),
      generation: parsedVersion.generation,
      fields
    };
  }
  if (!Number.isSafeInteger(retiredAt) || (retiredAt as number) <= (activatedAt as number) || (retiredAt as number) > latestAllowed) {
    throw failure(code, diagnosticReference);
  }
  return {
    metadata: Object.freeze({ keyVersion: keyVersion as string, state, activatedAt: activatedAt as number, retiredAt: retiredAt as number }),
    generation: parsedVersion.generation,
    fields
  };
}

/**
 * The key set is a rotation chain. Ordered by generation: generations are unique, activation times
 * strictly increase, exactly the newest key is active, and every retired key's `retiredAt` equals its
 * successor's `activatedAt`. A backdated `retiredAt` (earlier than the successor took over) or a
 * reissued older generation therefore fails closed. Returns the entries oldest first.
 */
function validateKeyChain<T extends { readonly metadata: FingerprintKeyMetadata; readonly generation: number }>(
  entries: readonly T[],
  code: SecurityErrorCode,
  diagnosticReference?: unknown
): readonly T[] {
  if (entries.length === 0) throw failure(code, diagnosticReference);
  const ordered = [...entries].sort((left, right) => left.generation - right.generation);
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index] as T;
    const newest = index === ordered.length - 1;
    if (newest !== (entry.metadata.state === "active")) throw failure(code, diagnosticReference);
    if (newest) continue;
    const successor = ordered[index + 1] as T;
    if (
      successor.generation === entry.generation ||
      successor.metadata.activatedAt <= entry.metadata.activatedAt ||
      entry.metadata.retiredAt !== successor.metadata.activatedAt
    ) {
      throw failure(code, diagnosticReference);
    }
  }
  return ordered;
}

function retiredKeyPurgeable(metadata: FingerprintKeyMetadata, now: number, policy: ResolvedKeyPolicy): boolean {
  // Verification keeps a retired key for one extra clock skew so a host behind the rotating host
  // never treats a version as gone early. Issuance subtracts one skew (see `fingerprint`).
  return metadata.state === "retired" &&
    now >= (metadata.retiredAt as number) + policy.retiredKeyRetentionMs + policy.maxClockSkewMs;
}

function degenerateKey(bytes: Uint8Array): boolean {
  const seen = new Set<number>();
  for (let index = 0; index < bytes.byteLength; index += 1) seen.add(bytes[index] as number);
  return seen.size <= TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxDegenerateDistinctKeyBytes;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= (left[index] as number) ^ (right[index] as number);
  return difference === 0;
}

function fingerprintMessage(keyVersion: string, purpose: string, canonicalIdentity: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(`${FINGERPRINT_DOMAIN}\n${keyVersion}\n${purpose}\n${canonicalIdentity}`);
  const exact = new Uint8Array(encoded.byteLength);
  exact.set(encoded);
  return exact.buffer as ArrayBuffer;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) binary += String.fromCharCode(bytes[index] as number);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function validFingerprintInput(purpose: unknown, canonicalIdentity: unknown, diagnosticReference?: unknown): void {
  if (
    typeof purpose !== "string" || !FINGERPRINT_PURPOSES.has(purpose) ||
    typeof canonicalIdentity !== "string" || canonicalIdentity.length === 0 ||
    canonicalIdentity.length > MAX_CANONICAL_IDENTITY_LENGTH || canonicalIdentity.includes("\u0000") ||
    // Lone surrogates encode to U+FFFD, so two distinct identities would share one fingerprint.
    stringIsWellFormed === undefined || !Reflect.apply(stringIsWellFormed, canonicalIdentity, [])
  ) {
    throw failure("retention_unavailable", diagnosticReference);
  }
}

/**
 * A stable, server-held, versioned HMAC keyring for idempotency tombstone fingerprints.
 * Key material is resolved through the injected source on every operation and is never
 * returned. Every failure (no source, no key set, no or several active keys, short, degenerate
 * or duplicate keys, a broken rotation chain, an over-age active key, an unknown or purgeable
 * stored version) fails closed.
 */
export function createTombstoneFingerprintKeyring(input: {
  readonly keyringReference: unknown;
  readonly source: FingerprintKeySource;
  readonly policy: TombstoneFingerprintKeyPolicy;
  readonly clock?: () => number;
  /** Optional floor from the host's persisted `highWaterGeneration`. A key set whose active
   * generation is below it (a keyring rebuilt from scratch under a reused label) fails closed. */
  readonly minActiveGeneration?: number;
  readonly diagnosticReference?: unknown;
}): TombstoneFingerprintKeyring {
  const fields = snapshotRecord(input, "retention_unavailable");
  const diagnosticReference = fields.diagnosticReference;
  const keyringReference = fields.keyringReference;
  if (!validIdentifier(keyringReference)) throw failure("retention_unavailable", diagnosticReference);
  const policy = resolveKeyPolicy(fields.policy, diagnosticReference);
  const load = captureMethod(fields.source, "load", "retention_unavailable", diagnosticReference);
  const clockValue = fields.clock;
  if (clockValue !== undefined && typeof clockValue !== "function") throw failure("retention_unavailable", diagnosticReference);
  const clock = (clockValue ?? Date.now) as () => number;
  const minActiveGeneration = fields.minActiveGeneration;
  if (minActiveGeneration !== undefined && (!Number.isSafeInteger(minActiveGeneration) || (minActiveGeneration as number) < 1)) {
    throw failure("retention_unavailable", diagnosticReference);
  }

  function readClock(): number {
    let now: unknown;
    try {
      now = Reflect.apply(clock, undefined, []);
    } catch {
      throw failure("retention_unavailable", diagnosticReference);
    }
    if (!Number.isSafeInteger(now) || (now as number) < 0) throw failure("retention_unavailable", diagnosticReference);
    return now as number;
  }

  async function loadKeySet(): Promise<LoadedFingerprintKeySet> {
    const now = readClock();
    let raw: unknown;
    try {
      raw = await Reflect.apply(load, undefined, [Object.freeze({ keyringReference })]);
    } catch {
      throw failure("retention_unavailable", diagnosticReference);
    }
    const set = snapshotRecord(raw, "retention_unavailable", diagnosticReference);
    // Only the hard limit applies here: the policy cap never stops verification.
    const entries = snapshotDataArray(set.keys, TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxKeyVersions, "retention_unavailable", diagnosticReference);

    const parsed: { metadata: FingerprintKeyMetadata; generation: number; bytes: Uint8Array }[] = [];
    try {
      for (const entry of entries) {
        const { metadata, generation, fields: keyFields } = snapshotKeyMetadata(
          entry, KEY_MATERIAL_FIELDS, now + policy.maxClockSkewMs, "retention_unavailable", diagnosticReference
        );
        const bytes = copyBytes(keyFields.key, TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxKeyBytes, "retention_unavailable", diagnosticReference);
        parsed.push({ metadata, generation, bytes });
        if (bytes.byteLength < TOMBSTONE_FINGERPRINT_KEY_LIMITS.minKeyBytes || degenerateKey(bytes)) {
          throw failure("retention_unavailable", diagnosticReference);
        }
        for (const other of parsed) {
          if (other.bytes !== bytes && (other.metadata.keyVersion === metadata.keyVersion || sameBytes(other.bytes, bytes))) {
            throw failure("retention_unavailable", diagnosticReference);
          }
        }
      }
      const ordered = validateKeyChain(parsed, "retention_unavailable", diagnosticReference);
      if (minActiveGeneration !== undefined && (ordered[ordered.length - 1] as (typeof parsed)[number]).generation < (minActiveGeneration as number)) {
        throw failure("retention_unavailable", diagnosticReference);
      }

      const importKey = async (entry: { metadata: FingerprintKeyMetadata; bytes: Uint8Array }): Promise<LoadedFingerprintKey> => {
        let cryptoKey: HmacKey;
        try {
          cryptoKey = await globalThis.crypto.subtle.importKey(
            "raw", entry.bytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
          );
        } catch {
          throw failure("retention_unavailable", diagnosticReference);
        }
        return Object.freeze({ keyVersion: entry.metadata.keyVersion, activatedAt: entry.metadata.activatedAt, cryptoKey });
      };

      const newestFirst = [...ordered].reverse();
      const active = await importKey(newestFirst[0] as (typeof parsed)[number]);
      const verifiable: LoadedFingerprintKey[] = [active];
      const purgeableKeys: LoadedFingerprintKey[] = [];
      for (const entry of newestFirst.slice(1)) {
        if (retiredKeyPurgeable(entry.metadata, now, policy)) purgeableKeys.push(await importKey(entry));
        else verifiable.push(await importKey(entry));
      }
      // Oldest first, matching the planner's removableKeyVersions and the safe removal order.
      purgeableKeys.reverse();
      return Object.freeze({
        now, active, verifiable: Object.freeze(verifiable), purgeableKeys: Object.freeze(purgeableKeys),
        purgeable: Object.freeze(purgeableKeys.map((key) => key.keyVersion))
      });
    } finally {
      for (const entry of parsed) entry.bytes.fill(0);
    }
  }

  async function sign(key: LoadedFingerprintKey, purpose: string, canonicalIdentity: string): Promise<TombstoneFingerprint> {
    let signature: ArrayBuffer;
    try {
      signature = await globalThis.crypto.subtle.sign("HMAC", key.cryptoKey, fingerprintMessage(key.keyVersion, purpose, canonicalIdentity));
    } catch {
      throw failure("retention_unavailable", diagnosticReference);
    }
    return Object.freeze({ keyVersion: key.keyVersion, digest: toBase64Url(new Uint8Array(signature)) });
  }

  return Object.freeze({
    async fingerprint(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string): Promise<IssuedTombstoneFingerprint> {
      validFingerprintInput(purpose, canonicalIdentity, diagnosticReference);
      const set = await loadKeySet();
      if (set.now - set.active.activatedAt > policy.maxActiveKeyAgeMs) throw failure("retention_unavailable", diagnosticReference);
      const signed = await sign(set.active, purpose, canonicalIdentity);
      // The active key retires no earlier than now (minus one skew), so it stays verifiable at least
      // until now + retention - skew. Every issued fingerprint carries that bound as data.
      const maxRetainUntil = set.now + policy.retiredKeyRetentionMs - policy.maxClockSkewMs;
      if (!Number.isSafeInteger(maxRetainUntil)) throw failure("retention_unavailable", diagnosticReference);
      return Object.freeze({ keyVersion: signed.keyVersion, digest: signed.digest, maxRetainUntil });
    },
    async candidates(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string): Promise<readonly TombstoneFingerprint[]> {
      validFingerprintInput(purpose, canonicalIdentity, diagnosticReference);
      const set = await loadKeySet();
      const results: TombstoneFingerprint[] = [];
      for (const key of set.verifiable) results.push(await sign(key, purpose, canonicalIdentity));
      // A version past retention but still in the set may still have tombstones under it (a wrapper
      // that inflated maxRetainUntil, a direct fingerprint() caller, a stale key source). Omitting it
      // would turn such a tombstone into "never deleted", so its candidate stays in the lookup. A hit
      // under it reaches `matches`, which throws: it fails closed only on an actual hit.
      for (const key of set.purgeableKeys) results.push(await sign(key, purpose, canonicalIdentity));
      return Object.freeze(results);
    },
    async matches(purpose: TombstoneFingerprintPurpose, canonicalIdentity: string, stored: TombstoneFingerprint): Promise<boolean> {
      validFingerprintInput(purpose, canonicalIdentity, diagnosticReference);
      const storedFields = snapshotRecord(stored, "retention_unavailable", diagnosticReference);
      const keyVersion = storedFields.keyVersion;
      const digest = storedFields.digest;
      if (
        keyVersionGeneration(keyVersion) === undefined ||
        typeof digest !== "string" || !FINGERPRINT_DIGEST_PATTERN.test(digest)
      ) {
        throw failure("retention_unavailable", diagnosticReference);
      }
      const digestBytes = fromBase64Url(digest);
      // Only the canonical encoding is accepted, so a store keyed by digest agrees with `matches`.
      if (toBase64Url(digestBytes) !== digest) throw failure("retention_unavailable", diagnosticReference);
      const set = await loadKeySet();
      const key = set.verifiable.find((candidate) => candidate.keyVersion === keyVersion);
      if (key === undefined) {
        // An unknown version, or one past retention, means a tombstone outlived its key. That
        // breaks an invariant and is never read as "no tombstone".
        throw failure("retention_unavailable", diagnosticReference);
      }
      try {
        return await globalThis.crypto.subtle.verify(
          "HMAC", key.cryptoKey, digestBytes.buffer as ArrayBuffer, fingerprintMessage(keyVersion as string, purpose, canonicalIdentity)
        );
      } catch {
        throw failure("retention_unavailable", diagnosticReference);
      }
    },
    async status(): Promise<FingerprintKeyringStatus> {
      const set = await loadKeySet();
      const activeKeyAgeMs = Math.max(0, set.now - set.active.activatedAt);
      return Object.freeze({
        keyringReference: keyringReference as string,
        activeKeyVersion: set.active.keyVersion,
        activeKeyAgeMs,
        rotationDue: activeKeyAgeMs >= policy.rotationIntervalMs,
        rotationRequired: activeKeyAgeMs > policy.maxActiveKeyAgeMs,
        verifiableKeyVersions: Object.freeze(set.verifiable.map((key) => key.keyVersion)),
        purgeableKeyVersions: set.purgeable
      });
    }
  });
}

export interface FingerprintKeyRotationPlan {
  readonly reason: "scheduled" | "incident";
  readonly retiringKeyVersion: string;
  readonly newActiveKeyVersion: string;
  /** Generation of `newActiveKeyVersion`. Persist it and pass it back as `highWaterGeneration`. */
  readonly highWaterGeneration: number;
  /** The next key set metadata, newest first. It keeps removable versions (still `retired`). The host
   * adds the new key's random bytes in the secret manager and writes this set atomically. */
  readonly keys: readonly FingerprintKeyMetadata[];
  /** Retired versions past retention, oldest first. Drop them from the key set in a separate step,
   * only after every tombstone with that version is deleted or confirmed expired. Remove them in this
   * order (or all in one write): every intermediate set is then still a valid rotation chain. */
  readonly removableKeyVersions: readonly string[];
}

/**
 * Plan a rotation from key metadata only (no key bytes). The current active key becomes retired at
 * `now` and a new version with the next generation becomes active. Generations only increase: the new
 * one exceeds every generation in the set and the persisted `highWaterGeneration`, so a removed
 * version is never reissued. A scheduled rotation is refused before the active key is
 * `policy.rotationIntervalMs` old (the cadence the capacity check assumes) and above
 * `policy.maxKeyVersions` retained versions; an incident rotation is refused only above the hard limit.
 * The planner applies no clock skew: `now` must be past every recorded timestamp.
 */
export function planTombstoneFingerprintKeyRotation(input: {
  readonly keys: unknown;
  readonly reason: unknown;
  readonly now: unknown;
  readonly policy: TombstoneFingerprintKeyPolicy;
  readonly keyVersionLabel?: unknown;
  readonly highWaterGeneration?: unknown;
  readonly diagnosticReference?: unknown;
}): FingerprintKeyRotationPlan {
  const fields = snapshotRecord(input, "retention_policy_invalid");
  const diagnosticReference = fields.diagnosticReference;
  const policy = resolveKeyPolicy(fields.policy, diagnosticReference);
  const { reason, now, keyVersionLabel, highWaterGeneration } = fields;
  if (
    (reason !== "scheduled" && reason !== "incident") || !Number.isSafeInteger(now) || (now as number) < 0 ||
    (keyVersionLabel !== undefined && (typeof keyVersionLabel !== "string" || !FINGERPRINT_KEY_LABEL_PATTERN.test(keyVersionLabel))) ||
    (highWaterGeneration !== undefined && (!Number.isSafeInteger(highWaterGeneration) || (highWaterGeneration as number) < 1))
  ) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  const entries = snapshotDataArray(fields.keys, TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxKeyVersions, "retention_policy_invalid", diagnosticReference);
  const parsed: { metadata: FingerprintKeyMetadata; generation: number }[] = [];
  const versions = new Set<string>();
  for (const entry of entries) {
    // The rotating host's clock must be past every recorded timestamp: the new activation is `now`.
    const { metadata, generation } = snapshotKeyMetadata(entry, KEY_METADATA_FIELDS, now as number, "retention_policy_invalid", diagnosticReference);
    if (versions.has(metadata.keyVersion)) throw failure("retention_policy_invalid", diagnosticReference);
    versions.add(metadata.keyVersion);
    parsed.push({ metadata, generation });
  }
  const ordered = validateKeyChain(parsed, "retention_policy_invalid", diagnosticReference);
  const retiring = ordered[ordered.length - 1] as (typeof parsed)[number];
  if (retiring.metadata.activatedAt >= (now as number)) throw failure("retention_policy_invalid", diagnosticReference);
  if (reason === "scheduled" && (now as number) - retiring.metadata.activatedAt < policy.rotationIntervalMs) {
    // The version cap is sized for one scheduled rotation per interval. An early scheduled rotation
    // would spend headroom the capacity check never counted; an incident rotation stays allowed.
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  if (highWaterGeneration !== undefined && (highWaterGeneration as number) < retiring.generation) {
    // The persisted high-water mark is behind the key set: the history is inconsistent.
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  const nextGeneration = Math.max(retiring.generation, (highWaterGeneration as number | undefined) ?? 0) + 1;
  const label = (keyVersionLabel as string | undefined) ?? (keyVersionGeneration(retiring.metadata.keyVersion) as { label: string }).label;
  const newKeyVersion = `${label}-g${nextGeneration}`;
  if (!Number.isSafeInteger(nextGeneration) || keyVersionGeneration(newKeyVersion) === undefined) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }

  const next: FingerprintKeyMetadata[] = [
    Object.freeze({ keyVersion: newKeyVersion, state: "active", activatedAt: now as number }),
    Object.freeze({ keyVersion: retiring.metadata.keyVersion, state: "retired", activatedAt: retiring.metadata.activatedAt, retiredAt: now as number })
  ];
  for (const entry of [...ordered].reverse().slice(1)) next.push(entry.metadata);
  // Oldest first: purgeability is monotone in generation (retiredAt increases along the chain), so
  // removable versions are a prefix of the chain and removing them in this order never leaves a gap.
  const removable: string[] = [];
  for (const entry of ordered.slice(0, -1)) {
    if (retiredKeyPurgeable(entry.metadata, now as number, policy)) removable.push(entry.metadata.keyVersion);
  }
  if (next.length > TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxKeyVersions) throw failure("retention_policy_invalid", diagnosticReference);
  if (reason === "scheduled" && next.length - removable.length > policy.maxKeyVersions) {
    throw failure("retention_policy_invalid", diagnosticReference);
  }
  return Object.freeze({
    reason,
    retiringKeyVersion: retiring.metadata.keyVersion,
    newActiveKeyVersion: newKeyVersion,
    highWaterGeneration: nextGeneration,
    keys: Object.freeze(next),
    removableKeyVersions: Object.freeze(removable)
  });
}

export interface CallbackHeaders {
  readonly [name: string]: string;
}

export interface CallbackVerifier {
  /** Implement only the selected provider's documented authenticity method. */
  verify(input: {
    readonly providerId: string;
    readonly mode: ProviderMode;
    readonly trustedScope: TrustedScope;
    readonly headers: CallbackHeaders;
    readonly rawBody: Uint8Array;
  }): Promise<boolean>;
}

export interface CallbackReplayStore {
  /** Atomically claim a provider event in the trusted tenant/project scope across restarts. */
  claim(input: {
    readonly providerId: string;
    readonly trustedScope: TrustedScope;
    readonly eventId: string;
  }): Promise<boolean>;
}

export interface CallbackHint {
  readonly eventId: string;
  readonly providerRequestId?: string;
}

export interface CallbackObservation {
  readonly status: "accepted" | "duplicate";
  readonly providerId: string;
  readonly trustedScope: TrustedScope;
  readonly trust: "verified" | "unverified";
  readonly hint: CallbackHint;
  readonly requiresAuthenticatedPoll: boolean;
  readonly authoritativeMutationAllowed: false;
}

function safeCallbackHeaders(value: unknown, diagnosticReference?: unknown): CallbackHeaders {
  const fields = snapshotRecord(value, "callback_invalid", diagnosticReference);
  if (Object.keys(fields).length > 64) throw failure("callback_invalid", diagnosticReference);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let total = 0;
  for (const [key, rawValue] of Object.entries(fields)) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(key) || typeof rawValue !== "string" || /[\r\n\u0000]/.test(rawValue)) {
      throw failure("callback_invalid", diagnosticReference);
    }
    total += key.length + rawValue.length;
    if (total > 16 * 1024) throw failure("callback_invalid", diagnosticReference);
    const normalized = key.toLowerCase();
    if (Object.hasOwn(result, normalized)) throw failure("callback_invalid", diagnosticReference);
    result[normalized] = rawValue;
  }
  return Object.freeze(result);
}

function parseCallbackHint(value: unknown, diagnosticReference?: unknown): CallbackHint {
  let fields: Record<string, unknown>;
  try {
    fields = snapshotRecord(value, "callback_invalid", diagnosticReference);
  } catch {
    throw failure("callback_invalid", diagnosticReference);
  }
  if (typeof fields.eventId !== "string" || !SAFE_CALLBACK_ID_PATTERN.test(fields.eventId)) {
    throw failure("callback_invalid", diagnosticReference);
  }
  const providerRequestId = fields.providerRequestId;
  if (providerRequestId !== undefined && (typeof providerRequestId !== "string" || !SAFE_CALLBACK_ID_PATTERN.test(providerRequestId))) {
    throw failure("callback_invalid", diagnosticReference);
  }
  return Object.freeze({
    eventId: fields.eventId,
    ...(providerRequestId === undefined ? {} : { providerRequestId })
  });
}

export async function ingestProviderCallback(input: {
  readonly providerId: unknown;
  readonly mode: unknown;
  readonly trustedScope: unknown;
  readonly headers: unknown;
  readonly rawBody: Uint8Array;
  readonly maxBodyBytes: number;
  readonly allowUnverifiedHints: boolean;
  readonly verifier?: CallbackVerifier;
  readonly parseHint: (rawBody: Uint8Array) => unknown;
  readonly replayStore: CallbackReplayStore;
  readonly diagnosticReference?: unknown;
}): Promise<CallbackObservation> {
  const fields = snapshotRecord(input, "callback_invalid");
  const diagnosticReference = fields.diagnosticReference;
  const mode = fields.mode;
  if (!validMode(mode)) throw failure("mode_mismatch", diagnosticReference);
  const scope = trustedScopeSnapshot(fields.trustedScope, diagnosticReference);
  const providerId = fields.providerId;
  if (!validIdentifier(providerId)) throw failure("callback_invalid", diagnosticReference);
  const maxBodyBytes = fields.maxBodyBytes;
  const allowUnverifiedHints = fields.allowUnverifiedHints;
  const verifierPort = fields.verifier;
  const parseHintPort = fields.parseHint;
  if (
    !Number.isSafeInteger(maxBodyBytes) ||
    (maxBodyBytes as number) < 1 || (maxBodyBytes as number) > 1024 * 1024
  ) {
    throw failure("callback_invalid", diagnosticReference);
  }
  const rawBodyLength = byteLengthOf(fields.rawBody, "callback_invalid", diagnosticReference);
  if (rawBodyLength > (maxBodyBytes as number)) throw failure("callback_oversized", diagnosticReference);
  const body = copyBytes(fields.rawBody, maxBodyBytes as number, "callback_invalid", diagnosticReference);
  if (typeof parseHintPort !== "function" || typeof allowUnverifiedHints !== "boolean") {
    throw failure("callback_invalid", diagnosticReference);
  }
  if (verifierPort === undefined && !allowUnverifiedHints) {
    throw failure("callback_disabled", diagnosticReference);
  }

  const headers = safeCallbackHeaders(fields.headers, diagnosticReference);
  const verify = verifierPort === undefined
    ? undefined
    : captureMethod(verifierPort, "verify", "callback_verification_unavailable", diagnosticReference);
  const claim = captureMethod(fields.replayStore, "claim", "callback_unavailable", diagnosticReference);
  let trust: CallbackObservation["trust"] = "unverified";
  if (verify !== undefined) {
    let verified: boolean;
    try {
      verified = await Reflect.apply(verify, undefined, [Object.freeze({
        providerId,
        mode,
        trustedScope: scope,
        headers,
        rawBody: copyBytes(body, 1024 * 1024, "callback_invalid", diagnosticReference)
      })]) as boolean;
    } catch {
      throw failure("callback_verification_unavailable", diagnosticReference);
    }
    if (verified !== true) throw failure("callback_verification_failed", diagnosticReference);
    trust = "verified";
  }

  let rawHint: unknown;
  try {
    rawHint = await Reflect.apply(parseHintPort, undefined, [copyBytes(body, 1024 * 1024, "callback_invalid", diagnosticReference)]);
  } catch {
    throw failure("callback_invalid", diagnosticReference);
  }
  const hint = parseCallbackHint(rawHint, diagnosticReference);
  let claimed: boolean;
  try {
    claimed = await Reflect.apply(claim, undefined, [Object.freeze({
      providerId,
      trustedScope: scope,
      eventId: hint.eventId
    })]) as boolean;
  } catch {
    throw failure("callback_unavailable", diagnosticReference);
  }
  if (typeof claimed !== "boolean") throw failure("callback_unavailable", diagnosticReference);
  return Object.freeze({
    status: claimed ? "accepted" : "duplicate",
    providerId: providerId as string,
    trustedScope: scope,
    trust,
    hint,
    requiresAuthenticatedPoll: trust === "unverified",
    authoritativeMutationAllowed: false
  });
}

const SENSITIVE_KEY_PARTS = [
  "address", "destination", "email", "phone", "telephone", "contact", "recipient", "name",
  "token", "secret", "password", "cookie", "credential", "apikey", "auth", "signature",
  "signedurl", "asseturl", "url", "privatekey", "taxid", "ssn", "card"
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

function scrubString(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]")
    .replace(/\b((?:token|secret|signature|sig|api[_-]?key|credential|password)=)([^&\s]+)/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s<>"']+/gi, "[REDACTED_URL]")
    .slice(0, 4096);
}

const UNSAFE_REDACTION = Symbol("unsafe redaction input");

function isErrorObject(value: object): boolean {
  let current: object | null;
  try {
    current = Object.getPrototypeOf(value) as object | null;
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      if (current === Error.prototype) return true;
      current = Object.getPrototypeOf(current) as object | null;
    }
    return false;
  } catch {
    throw UNSAFE_REDACTION;
  }
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === "string") return scrubString(value);
  if (typeof value !== "object") return REDACTED;
  if (isErrorObject(value)) return Object.freeze({ type: "Error" });
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor !== undefined && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
      if (!Number.isSafeInteger(length) || (length as number) < 0) throw UNSAFE_REDACTION;
      const result: unknown[] = [];
      for (let index = 0; index < Math.min(length as number, 100); index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) result.push(REDACTED);
        else if (!("value" in descriptor)) throw UNSAFE_REDACTION;
        else result.push(redactValue(descriptor.value, seen, depth + 1));
      }
      if ((length as number) > 100) result.push("[TRUNCATED]");
      return Object.freeze(result);
    }
    if (!isRecord(value)) return REDACTED;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(value);
    const stringKeys = keys.filter((key): key is string => typeof key === "string");
    for (const key of stringKeys.slice(0, 100)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) throw UNSAFE_REDACTION;
      // Only retain bounded, non-URL field names. Sensitive but well-formed
      // names are preserved with a redacted value for useful diagnostics.
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
        continue;
      }
      result[key] = redactValue(descriptor.value, seen, depth + 1);
    }
    if (stringKeys.length > 100) result.truncated = true;
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

/** Return a bounded diagnostic copy with nested personal data, credentials, and URLs removed. */
export function redactSensitive(value: unknown): unknown {
  try {
    return redactValue(value, new WeakSet<object>(), 0);
  } catch {
    return REDACTED;
  }
}

export interface SafeSecurityDiagnostic {
  readonly code: SecurityErrorCode;
  readonly diagnosticReference: string;
  readonly safeMessage: string;
}

/** Never copies raw error messages, stacks, URLs, headers, or provider response fields. */
export function safeSecurityDiagnostic(error: unknown, diagnosticReference?: unknown): SafeSecurityDiagnostic {
  try {
    if (error !== null && (typeof error === "object" || typeof error === "function") && genuineSecurityErrors.has(error as object)) {
      const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");
      const referenceDescriptor = Object.getOwnPropertyDescriptor(error, "diagnosticReference");
      const messageDescriptor = Object.getOwnPropertyDescriptor(error, "safeMessage");
      const code = codeDescriptor !== undefined && "value" in codeDescriptor ? codeDescriptor.value : undefined;
      const reference = referenceDescriptor !== undefined && "value" in referenceDescriptor ? referenceDescriptor.value : undefined;
      const message = messageDescriptor !== undefined && "value" in messageDescriptor ? messageDescriptor.value : undefined;
      if (typeof code === "string" && SECURITY_ERROR_CODES.has(code) &&
        typeof reference === "string" && SAFE_REFERENCE_PATTERN.test(reference) &&
        message === SAFE_MESSAGES[code as SecurityErrorCode]) {
        return Object.freeze({ code: code as SecurityErrorCode, diagnosticReference: reference, safeMessage: SAFE_MESSAGES[code as SecurityErrorCode] });
      }
    }
  } catch {
    // Hostile proxies and forged errors collapse to the fixed internal diagnostic.
  }
  const reference = typeof diagnosticReference === "string" && SAFE_REFERENCE_PATTERN.test(diagnosticReference)
    ? diagnosticReference
    : "diag-unavailable";
  return Object.freeze({ code: "internal_failure", diagnosticReference: reference, safeMessage: SAFE_MESSAGES.internal_failure });
}
