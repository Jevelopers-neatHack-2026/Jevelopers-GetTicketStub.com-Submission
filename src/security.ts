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

const SAFE_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const OPAQUE_TEXT_LIMIT = 512;
const SUPPORTED_ASSET_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const REDACTED = "[REDACTED]";

export class SecurityBoundaryError extends Error {
  readonly code: SecurityErrorCode;
  readonly diagnosticReference: string;
  readonly safeMessage: string;

  constructor(code: SecurityErrorCode, diagnosticReference: string) {
    const safeCode = Object.hasOwn(SAFE_MESSAGES, code) ? code : "internal_failure";
    const safeReference = typeof diagnosticReference === "string" && SAFE_REFERENCE_PATTERN.test(diagnosticReference)
      ? diagnosticReference
      : "sec-unavailable";
    super(SAFE_MESSAGES[safeCode]);
    this.name = "SecurityBoundaryError";
    this.code = safeCode;
    this.diagnosticReference = safeReference;
    this.safeMessage = SAFE_MESSAGES[safeCode];
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
    : "sec-unavailable";
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

function hasSafeOpaqueText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= OPAQUE_TEXT_LIMIT &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function trustedScopeSnapshot(value: unknown, diagnosticReference?: unknown): TrustedScope {
  if (!isRecord(value) || !hasSafeOpaqueText(value.tenantId) || !hasSafeOpaqueText(value.projectId)) {
    throw failure("invalid_scope", diagnosticReference);
  }
  return Object.freeze({ tenantId: value.tenantId, projectId: value.projectId });
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
  const scope = trustedScopeSnapshot(input.trustedScope, input.diagnosticReference);
  if (!validIdentifier(input.reference) || !validIdentifier(input.purpose)) {
    throw failure("reference_unavailable", input.diagnosticReference);
  }

  let record: EncryptedScopedRecord | undefined;
  try {
    record = await input.store.get(input.reference, scope);
  } catch {
    throw failure("reference_unavailable", input.diagnosticReference);
  }
  if (
    record === undefined || record === null ||
    record.tenantId !== scope.tenantId || record.projectId !== scope.projectId ||
    !(record.ciphertext instanceof Uint8Array) || record.ciphertext.byteLength === 0 ||
    record.ciphertext.byteLength > 20 * 1024 * 1024 || !validIdentifier(record.keyVersion)
  ) {
    throw failure("reference_unavailable", input.diagnosticReference);
  }

  try {
    return await input.decryptor.decrypt(record.ciphertext.slice(), {
      trustedScope: scope,
      keyVersion: record.keyVersion,
      purpose: input.purpose
    });
  } catch {
    throw failure("reference_unavailable", input.diagnosticReference);
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

  if (!isRecord(selection)) throw failure("provider_payload_policy_invalid", diagnosticReference);
  const selectionKeys = Object.keys(selection);
  if (selectionKeys.length === 1 && selectionKeys[0] === "$each") {
    if (!Array.isArray(value) || value.length > 1000) {
      throw failure("provider_payload_policy_invalid", diagnosticReference);
    }
    const eachDescriptor = Object.getOwnPropertyDescriptor(selection, "$each");
    if (eachDescriptor === undefined || !("value" in eachDescriptor)) {
      throw failure("provider_payload_policy_invalid", diagnosticReference);
    }
    const eachSelection = eachDescriptor.value as ProviderFieldSelection;
    const projected: unknown[] = [];
    for (const item of value) projected.push(projectValue(item, eachSelection, depth + 1, diagnosticReference));
    return Object.freeze(projected);
  }
  if (!isRecord(value)) {
    if (value === null) return null;
    throw failure("provider_payload_policy_invalid", diagnosticReference);
  }

  const projected: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of selectionKeys) {
    if (!validSelectionKey(key)) throw failure("provider_payload_policy_invalid", diagnosticReference);
    const descriptor = Object.getOwnPropertyDescriptor(selection, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw failure("provider_payload_policy_invalid", diagnosticReference);
    }
    const sourceDescriptor = Object.getOwnPropertyDescriptor(value, key);
    if (sourceDescriptor === undefined) continue;
    if (!("value" in sourceDescriptor)) throw failure("provider_payload_policy_invalid", diagnosticReference);
    projected[key] = projectValue(sourceDescriptor.value, descriptor.value as ProviderFieldSelection, depth + 1, diagnosticReference);
  }
  return Object.freeze(projected);
}

/** Project only explicitly reviewed fields; nested objects and arrays need nested selections. */
export function minimizeProviderPayload<T = Readonly<Record<string, unknown>>>(input: {
  readonly value: unknown;
  readonly fields: ProviderFieldSelection;
  readonly diagnosticReference?: unknown;
}): T {
  if (!isRecord(input.value) || !isRecord(input.fields)) {
    throw failure("provider_payload_policy_invalid", input.diagnosticReference);
  }
  return projectValue(input.value, input.fields, 0, input.diagnosticReference) as T;
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
  if (!validMode(input.mode)) throw failure("mode_mismatch", input.diagnosticReference);
  if (!validIdentifier(input.providerId) || !validIdentifier(input.secretReference)) {
    throw failure("server_secret_unavailable", input.diagnosticReference);
  }

  let lease: ServerSecretLease | undefined;
  try {
    lease = await input.source.load({
      providerId: input.providerId,
      secretReference: input.secretReference,
      mode: input.mode
    });
  } catch {
    throw failure("server_secret_unavailable", input.diagnosticReference);
  }
  if (
    lease === undefined || !isRecord(lease) || typeof lease.secret !== "string" || lease.secret.length === 0 ||
    lease.secret.length > 65536 || !validIdentifier(lease.version) || lease.mode !== input.mode
  ) {
    throw failure("server_secret_unavailable", input.diagnosticReference);
  }

  try {
    return await input.use(Object.freeze({ secret: lease.secret, version: lease.version, mode: input.mode }));
  } catch {
    throw failure("provider_operation_failed", input.diagnosticReference);
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

function normalizedAllowedHosts(policy: SafeAssetPolicy, diagnosticReference?: unknown): Set<string> {
  if (!Array.isArray(policy.allowedHosts) || policy.allowedHosts.length === 0 || policy.allowedHosts.length > 100) {
    throw failure("asset_policy_invalid", diagnosticReference);
  }
  const hosts = new Set<string>();
  for (const host of policy.allowedHosts) {
    if (typeof host !== "string") throw failure("asset_policy_invalid", diagnosticReference);
    const normalized = normalizeDnsHostname(host);
    if (normalized === undefined || normalized !== host.toLowerCase()) {
      throw failure("asset_policy_invalid", diagnosticReference);
    }
    hosts.add(normalized);
  }
  if (
    !Array.isArray(policy.allowedMimeTypes) || policy.allowedMimeTypes.length === 0 ||
    policy.allowedMimeTypes.some((type) => !SUPPORTED_ASSET_TYPES.has(type)) ||
    !Number.isSafeInteger(policy.maxBytes) || policy.maxBytes < 1 || policy.maxBytes > 20 * 1024 * 1024 ||
    !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs < 1 || policy.timeoutMs > 30_000 ||
    !Number.isSafeInteger(policy.maxRedirects) || policy.maxRedirects < 0 || policy.maxRedirects > 5
  ) {
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

function header(response: AssetResponse, name: string): string | undefined {
  if (!isRecord(response.headers)) return undefined;
  const matching = Object.entries(response.headers).filter(([key]) => key.toLowerCase() === name);
  if (matching.length > 1) return undefined;
  const value = matching[0]?.[1];
  return typeof value === "string" ? value : undefined;
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
  body: AssetResponse["body"],
  maxBytes: number,
  signal: AbortSignal,
  diagnosticReference?: unknown
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (body === undefined) throw failure("asset_response_invalid", diagnosticReference);
  const iterable: AsyncIterable<Uint8Array> = body instanceof Uint8Array
    ? (async function* () { yield body; })()
    : body;
  try {
    for await (const chunk of iterable) {
      if (signal.aborted) throw failure("asset_timeout", diagnosticReference);
      if (!(chunk instanceof Uint8Array)) throw failure("asset_response_invalid", diagnosticReference);
      byteLength += chunk.byteLength;
      if (byteLength > maxBytes) throw failure("asset_too_large", diagnosticReference);
      chunks.push(chunk.slice());
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
    const copy = bytes.slice();
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
  readonly resolver: AssetResolver;
  readonly transport: AssetTransport;
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
      answers = await input.resolver.resolve(hostname, input.signal);
    } catch {
      if (input.signal.aborted) throw failure("asset_timeout", input.diagnosticReference);
      throw failure("asset_retrieval_failed", input.diagnosticReference);
    }
    throwIfAborted(input.signal, input.diagnosticReference);
    if (!Array.isArray(answers) || answers.length === 0 || answers.length > 32) {
      throw failure("asset_address_rejected", input.diagnosticReference);
    }
    const addresses = answers.map((address) => typeof address === "string" ? canonicalIp(address) : undefined);
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
      response = await input.transport.request(request);
    } catch {
      if (input.signal.aborted) throw failure("asset_timeout", input.diagnosticReference);
      throw failure("asset_retrieval_failed", input.diagnosticReference);
    }
    throwIfAborted(input.signal, input.diagnosticReference);
    if (response === null || typeof response !== "object" || !Number.isInteger(response.status)) {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    const connectedAddress = typeof response.connectedAddress === "string" ? canonicalIp(response.connectedAddress) : undefined;
    if (
      connectedAddress === undefined || !isPublicIPAddress(connectedAddress) ||
      !pinnedAddresses.includes(connectedAddress)
    ) {
      throw failure("asset_peer_mismatch", input.diagnosticReference);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirectCount >= input.policy.maxRedirects) throw failure("asset_redirect_rejected", input.diagnosticReference);
      const location = header(response, "location");
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
    if (response.status !== 200) throw failure("asset_response_invalid", input.diagnosticReference);

    const contentEncoding = header(response, "content-encoding");
    if (contentEncoding !== undefined && contentEncoding.toLowerCase() !== "identity") {
      throw failure("asset_response_invalid", input.diagnosticReference);
    }
    const declaredLength = header(response, "content-length");
    if (declaredLength !== undefined) {
      if (!/^\d{1,12}$/.test(declaredLength)) throw failure("asset_response_invalid", input.diagnosticReference);
      const declaredBytes = Number(declaredLength);
      if (!Number.isSafeInteger(declaredBytes)) throw failure("asset_response_invalid", input.diagnosticReference);
      if (declaredBytes > input.policy.maxBytes) throw failure("asset_too_large", input.diagnosticReference);
    }
    const declaredType = header(response, "content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (
      declaredType === undefined || !SUPPORTED_ASSET_TYPES.has(declaredType) ||
      !input.policy.allowedMimeTypes.includes(declaredType as SafeAssetMimeType)
    ) {
      throw failure("asset_type_rejected", input.diagnosticReference);
    }

    const bytes = await collectAssetBody(response.body, input.policy.maxBytes, input.signal, input.diagnosticReference);
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
  if (!validMode(input.mode)) throw failure("mode_mismatch", input.diagnosticReference);
  const scope = trustedScopeSnapshot(input.trustedScope, input.diagnosticReference);
  const hosts = normalizedAllowedHosts(input.policy, input.diagnosticReference);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(failure("asset_timeout", input.diagnosticReference));
    }, input.policy.timeoutMs);
  });
  const operation = retrieveWithinDeadline({
    url: input.url,
    mode: input.mode,
    trustedScope: scope,
    policy: input.policy,
    hosts,
    resolver: input.resolver,
    transport: input.transport,
    signal: controller.signal,
    diagnosticReference: input.diagnosticReference
  });
  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof SecurityBoundaryError) throw error;
    if (controller.signal.aborted) throw failure("asset_timeout", input.diagnosticReference);
    throw failure("asset_retrieval_failed", input.diagnosticReference);
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
  if (!isRecord(value)) throw failure("asset_approval_mismatch", diagnosticReference);
  const artifactId = value.artifactId;
  const digest = value.sha256;
  const contentType = value.contentType;
  const byteLength = value.byteLength;
  const termsFingerprint = value.termsFingerprint;
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
  const hosts = normalizedAllowedHosts({
    allowedHosts: input.allowedHosts,
    allowedMimeTypes: ["image/png"],
    maxBytes: 1,
    timeoutMs: 1,
    maxRedirects: 0
  }, input.diagnosticReference);
  let previousUrl: URL;
  let refreshedUrl: URL;
  try {
    previousUrl = parseApprovedAssetUrl(input.previous.url, hosts, input.diagnosticReference);
    refreshedUrl = parseApprovedAssetUrl(input.refreshed.url, hosts, input.diagnosticReference);
  } catch {
    throw failure("refresh_changed_approval", input.diagnosticReference);
  }
  void previousUrl;
  if (!Number.isFinite(input.now) || !Number.isFinite(input.refreshed.expiresAt) || input.refreshed.expiresAt <= input.now) {
    throw failure("asset_approval_mismatch", input.diagnosticReference);
  }
  const previous = snapshotApprovedIdentity(input.previous.approved, input.diagnosticReference);
  const refreshed = snapshotApprovedIdentity(input.refreshed.approved, input.diagnosticReference);
  if (
    previous.artifactId !== refreshed.artifactId || previous.sha256 !== refreshed.sha256 ||
    previous.contentType !== refreshed.contentType || previous.byteLength !== refreshed.byteLength ||
    previous.termsFingerprint !== refreshed.termsFingerprint
  ) {
    throw failure("refresh_changed_approval", input.diagnosticReference);
  }
  return Object.freeze({
    url: refreshedUrl.toString(),
    expiresAt: input.refreshed.expiresAt,
    approved: previous
  });
}

export async function assertRetrievedAssetMatchesApproval(input: {
  readonly asset: RetrievedAsset;
  readonly approved: ApprovedArtifactIdentity;
  readonly diagnosticReference?: unknown;
}): Promise<void> {
  const approved = snapshotApprovedIdentity(input.approved, input.diagnosticReference);
  const actualDigest = await sha256(input.asset.bytes, input.diagnosticReference);
  if (
    input.asset.byteLength !== approved.byteLength || input.asset.bytes.byteLength !== approved.byteLength ||
    input.asset.contentType !== approved.contentType || input.asset.sha256 !== approved.sha256 ||
    actualDigest !== approved.sha256
  ) {
    throw failure("asset_approval_mismatch", input.diagnosticReference);
  }
}

export interface TombstoneFingerprint {
  readonly keyVersion: string;
  readonly digest: string;
}

export interface TombstoneFingerprinter {
  /** Use a stable server-held key distinct from rotating provider API credentials. */
  fingerprint(purpose: "authorization_action" | "idempotency_key", canonicalIdentity: string): Promise<TombstoneFingerprint>;
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

function validFingerprint(value: unknown): value is TombstoneFingerprint {
  return isRecord(value) && validIdentifier(value.keyVersion) &&
    typeof value.digest === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value.digest);
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
  const scope = trustedScopeSnapshot(input.trustedScope, input.diagnosticReference);
  if (
    !validIdentifier(input.reference) || !validIdentifier(input.providerId) ||
    !validIdentifier(input.authorizationId) || !validIdentifier(input.actionId) ||
    !validIdentifier(input.idempotencyKey) || !Number.isSafeInteger(input.deletedAt) ||
    !Number.isSafeInteger(input.retainUntil) || input.deletedAt < 0 || input.retainUntil <= input.deletedAt
  ) {
    throw failure("retention_policy_invalid", input.diagnosticReference);
  }

  const actionIdentity = canonicalIdentity([
    scope.tenantId, scope.projectId, input.providerId, input.authorizationId, input.actionId
  ]);
  const idempotencyIdentity = canonicalIdentity([
    scope.tenantId, scope.projectId, input.providerId, input.idempotencyKey
  ]);
  let actionFingerprint: TombstoneFingerprint;
  let idempotencyFingerprint: TombstoneFingerprint;
  try {
    [actionFingerprint, idempotencyFingerprint] = await Promise.all([
      input.fingerprinter.fingerprint("authorization_action", actionIdentity),
      input.fingerprinter.fingerprint("idempotency_key", idempotencyIdentity)
    ]);
  } catch {
    throw failure("retention_unavailable", input.diagnosticReference);
  }
  if (!validFingerprint(actionFingerprint) || !validFingerprint(idempotencyFingerprint)) {
    throw failure("retention_unavailable", input.diagnosticReference);
  }

  const tombstone: IdempotencyTombstone = Object.freeze({
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    actionFingerprint: Object.freeze({ ...actionFingerprint }),
    idempotencyFingerprint: Object.freeze({ ...idempotencyFingerprint }),
    deletedAt: input.deletedAt,
    retainUntil: input.retainUntil
  });
  try {
    await input.retentionPort.purgePersonalDataAndRetainTombstone({
      reference: input.reference,
      trustedScope: scope,
      tombstone
    });
  } catch {
    throw failure("retention_unavailable", input.diagnosticReference);
  }
  return tombstone;
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
  if (!isRecord(value) || Object.keys(value).length > 64) throw failure("callback_invalid", diagnosticReference);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let total = 0;
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(key) || typeof rawValue !== "string" || /[\r\n\u0000]/.test(rawValue)) {
      throw failure("callback_invalid", diagnosticReference);
    }
    total += key.length + rawValue.length;
    if (total > 16 * 1024) throw failure("callback_invalid", diagnosticReference);
    result[key.toLowerCase()] = rawValue;
  }
  return Object.freeze(result);
}

function parseCallbackHint(value: unknown, diagnosticReference?: unknown): CallbackHint {
  if (!isRecord(value) || typeof value.eventId !== "string" || !SAFE_REFERENCE_PATTERN.test(value.eventId)) {
    throw failure("callback_invalid", diagnosticReference);
  }
  const providerRequestId = value.providerRequestId;
  if (providerRequestId !== undefined && (typeof providerRequestId !== "string" || !SAFE_REFERENCE_PATTERN.test(providerRequestId))) {
    throw failure("callback_invalid", diagnosticReference);
  }
  return Object.freeze({
    eventId: value.eventId,
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
  if (!validMode(input.mode)) throw failure("mode_mismatch", input.diagnosticReference);
  const scope = trustedScopeSnapshot(input.trustedScope, input.diagnosticReference);
  if (!validIdentifier(input.providerId)) throw failure("callback_invalid", input.diagnosticReference);
  if (
    !(input.rawBody instanceof Uint8Array) || !Number.isSafeInteger(input.maxBodyBytes) ||
    input.maxBodyBytes < 1 || input.maxBodyBytes > 1024 * 1024
  ) {
    throw failure("callback_invalid", input.diagnosticReference);
  }
  if (input.rawBody.byteLength > input.maxBodyBytes) throw failure("callback_oversized", input.diagnosticReference);
  if (typeof input.parseHint !== "function" || typeof input.allowUnverifiedHints !== "boolean") {
    throw failure("callback_invalid", input.diagnosticReference);
  }
  if (input.verifier === undefined && !input.allowUnverifiedHints) {
    throw failure("callback_disabled", input.diagnosticReference);
  }

  const headers = safeCallbackHeaders(input.headers, input.diagnosticReference);
  const body = input.rawBody.slice();
  let trust: CallbackObservation["trust"] = "unverified";
  if (input.verifier !== undefined) {
    let verified: boolean;
    try {
      verified = await input.verifier.verify({
        providerId: input.providerId,
        mode: input.mode,
        trustedScope: scope,
        headers,
        rawBody: body.slice()
      });
    } catch {
      throw failure("callback_verification_unavailable", input.diagnosticReference);
    }
    if (verified !== true) throw failure("callback_verification_failed", input.diagnosticReference);
    trust = "verified";
  }

  let rawHint: unknown;
  try {
    rawHint = input.parseHint(body.slice());
  } catch {
    throw failure("callback_invalid", input.diagnosticReference);
  }
  const hint = parseCallbackHint(rawHint, input.diagnosticReference);
  let claimed: boolean;
  try {
    claimed = await input.replayStore.claim({
      providerId: input.providerId,
      trustedScope: scope,
      eventId: hint.eventId
    });
  } catch {
    throw failure("callback_unavailable", input.diagnosticReference);
  }
  if (typeof claimed !== "boolean") throw failure("callback_unavailable", input.diagnosticReference);
  return Object.freeze({
    status: claimed ? "accepted" : "duplicate",
    providerId: input.providerId,
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

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  if (typeof value === "string") return scrubString(value);
  if (typeof value !== "object") return REDACTED;
  if (value instanceof Error) return Object.freeze({ type: "Error" });
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 100).map((item) => redactValue(item, seen, depth + 1));
    if (value.length > 100) result.push("[TRUNCATED]");
    seen.delete(value);
    return Object.freeze(result);
  }
  if (!isRecord(value)) {
    seen.delete(value);
    return REDACTED;
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).slice(0, 100)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactValue(descriptor.value, seen, depth + 1);
  }
  if (Object.keys(value).length > 100) result.truncated = true;
  seen.delete(value);
  return Object.freeze(result);
}

/** Return a bounded diagnostic copy with nested personal data, credentials, and URLs removed. */
export function redactSensitive(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>(), 0);
}

export interface SafeSecurityDiagnostic {
  readonly code: SecurityErrorCode;
  readonly diagnosticReference: string;
  readonly safeMessage: string;
}

/** Never copies raw error messages, stacks, URLs, headers, or provider response fields. */
export function safeSecurityDiagnostic(error: unknown, diagnosticReference?: unknown): SafeSecurityDiagnostic {
  const code = error instanceof SecurityBoundaryError ? error.code : "internal_failure";
  const reference = error instanceof SecurityBoundaryError
    ? error.diagnosticReference
    : failure(code, diagnosticReference).diagnosticReference;
  return Object.freeze({ code, diagnosticReference: reference, safeMessage: SAFE_MESSAGES[code] });
}
