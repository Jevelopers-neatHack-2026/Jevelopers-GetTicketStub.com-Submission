/**
 * Acceptance gate for a Finance handoff feeding `readFinancialSummary`. Mechanical review of the Finance 0.3.0 proposal and
 * the Dashboard 0.9.7 pin found the FinancialSummary 1.0.0 wire schema byte-identical, so a differing package version is
 * NOT a refusal reason. The gate instead checks, in order: the manifest and wire/schema version, the FinancialSummary schema
 * entry, its digest against a host-supplied trusted digest, the host-supplied summary digest and versioned-reference
 * expectations, and the mode, which the caller must state explicitly (there is no default). The semantic producer check (`checkFinancialSummary`) runs inside `readFinancialSummary` and is
 * never bypassed here.
 *
 * Nothing in a packet can establish production adoption. An owner acknowledgement or `adoptionAccepted` claim is recorded as
 * a claim only; no owner verifier exists in this slice, so `production` is always refused and the eligible outcome is limited
 * to explicit synthetic development. Trusted expectations come from the host, never from the packet or the payload, and this
 * module neither invents references nor derives amounts. Erasable TypeScript only.
 */
import { readFinancialSummary, type ProjectionResult, type SummaryProjection, type SummaryRequest } from '../../data/shared-contracts-adapter';

type Refused = Extract<ProjectionResult<SummaryProjection>, { status: 'refused' }>;
type RefusalCode = Refused['code'];

/** The parts of a Finance handoff manifest the gate reads. Every field is untrusted input. */
export type FinancePacketReferences = Readonly<{
  packageVersion?: unknown; schemaVersion?: unknown; status?: unknown; adoptionAccepted?: unknown;
  schemas?: unknown;
}>;

/**
 * Host-held expectations, obtained independently of the packet and payload. `schemaSha256` binds the FinancialSummary
 * contract bytes, `summaryDigest` is the canonical digest of the inner summary (`kit.hashManifest`), and `references` are the
 * trusted VersionedReference expectations keyed by payload path, exactly as `readFinancialSummary` expects them.
 */
export type TrustedPacketExpectation = Readonly<{
  schemaSha256: string; summaryDigest: string; references: Readonly<Record<string, unknown>>;
}>;

export type PacketMode = 'synthetic_development' | 'production';

export type PacketOutcome =
  | Readonly<{ outcome: 'refused'; result: Refused }>
  | Readonly<{
    outcome: 'synthetic_development_only';
    /** Production adoption is never established by this gate. */
    productionAdoption: 'not_established';
    /** `claimed_unverified` records that the packet names an acknowledgement; it is not verified and grants nothing. */
    ownerAcknowledgement: 'absent' | 'claimed_unverified';
    packageVersion: string | null; packetStatus: string | null; schemaSha256: string;
  }>;

const authority = 'read_only_projection' as const;
const refused = (code: RefusalCode, path: string): PacketOutcome => ({ outcome: 'refused', result: { status: 'refused', authority, code, path } });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const REFERENCE_HASH = /^sha256:[0-9a-f]{64}$/u;
const textOrNull = (value: unknown) => typeof value === 'string' ? value : null;

/** Shape of one trusted VersionedReference (UUID id, safe non-negative revision, sha256 content hash). Never repaired or defaulted. */
function validReference(value: unknown): boolean {
  return record(value) && typeof value.id === 'string' && UUID.test(value.id)
    && typeof value.revision === 'number' && Number.isSafeInteger(value.revision) && value.revision >= 0
    && typeof value.content_hash === 'string' && REFERENCE_HASH.test(value.content_hash);
}

/** Evaluates a Finance handoff manifest against host-trusted expectations. Pure; reads nothing outside its arguments. */
export function evaluateFinancePacket(manifest: unknown, trusted: TrustedPacketExpectation, mode: PacketMode): PacketOutcome {
  const root = record(manifest) ? manifest : undefined;
  const refs = root && record(root.canonicalReferences) ? root.canonicalReferences as FinancePacketReferences : undefined;
  if (!root || !refs) return refused('INVALID_PAYLOAD', '/canonicalReferences');
  if (refs.schemaVersion !== '1.0.0') return refused('UNSUPPORTED_VERSION', '/canonicalReferences/schemaVersion');
  const entry = Array.isArray(refs.schemas) ? refs.schemas.find((candidate) => record(candidate) && candidate.contract === 'FinancialSummary') : undefined;
  if (!record(entry)) return refused('UNKNOWN_CONTRACT', '/canonicalReferences/schemas');
  if (entry.schemaVersion !== '1.0.0') return refused('UNSUPPORTED_VERSION', '/canonicalReferences/schemas/FinancialSummary/schemaVersion');
  if (!SHA256_HEX.test(trusted.schemaSha256)) return refused('INVALID_TRUST_CONTEXT', '/trusted/schemaSha256');
  if (entry.sha256 !== trusted.schemaSha256) return refused('DIGEST_MISMATCH', '/canonicalReferences/schemas/FinancialSummary/sha256');
  if (typeof trusted.summaryDigest !== 'string' || !trusted.summaryDigest) return refused('INVALID_TRUST_CONTEXT', '/trusted/summaryDigest');
  const keys = record(trusted.references) ? Object.keys(trusted.references) : [];
  if (!keys.length) return refused('REFERENCE_MISMATCH', '/trusted/references');
  const bad = keys.find((key) => !validReference(trusted.references[key]));
  if (bad !== undefined) return refused('REFERENCE_MISMATCH', `/trusted/references/${bad}`);
  if (mode === 'production') return refused('UNACCEPTED_INTERFACE', '/ownerAcknowledgement');
  // No default eligibility: only the exact literal opts in. An absent, unknown or mistyped runtime mode is refused, never coerced.
  if (mode !== 'synthetic_development') return refused('INVALID_TRUST_CONTEXT', '/mode');
  const acknowledged = root.financeAcknowledgment != null || root.dashboardAcknowledgment != null || refs.adoptionAccepted === true;
  return {
    outcome: 'synthetic_development_only', productionAdoption: 'not_established', ownerAcknowledgement: acknowledged ? 'claimed_unverified' : 'absent',
    packageVersion: textOrNull(refs.packageVersion), packetStatus: textOrNull(refs.status), schemaSha256: trusted.schemaSha256,
  };
}

/**
 * Finance response-envelope fields other than the canonical `summary`, preserved exactly as delivered and never summed or
 * re-derived. This is UNVALIDATED transport data: it is not bound to a query or snapshot and may hold anything. Display goes
 * only through `projectWrapperMetadata`.
 */
export type FinanceWrapperMetadata = Readonly<Record<string, unknown>>;

/** Envelope keys the view may show, each with the only value shape it accepts. Anything else is withheld, never echoed. */
const SECRET_LIKE = /secret|token|passw|bearer|credential|api[-_]?key|private|\bsk-/iu;
const WRAPPER_ALLOWLIST = {
  schema: (value: string) => value === 'FinancialSummaryPage',
  asOf: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.test(value),
  timezone: (value: string) => /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/u.test(value) && !SECRET_LIKE.test(value),
  watermark: (value: string) => /^[A-Za-z0-9._:-]{1,64}$/u.test(value) && !SECRET_LIKE.test(value),
  queryContentHash: (value: string) => REFERENCE_HASH.test(value),
  summaryContentHash: (value: string) => REFERENCE_HASH.test(value),
} as const satisfies Record<string, (value: string) => boolean>;
export type WrapperMetadataKey = keyof typeof WRAPPER_ALLOWLIST;

/**
 * Display projection of the wrapper. `unvalidated` is the only status: nothing here claims the metadata matches the query,
 * snapshot or watermark of the summary, and it stays unsupported until a reviewed Finance producer port binds it.
 */
export type WrapperMetadataDisplay = Readonly<{
  status: 'unvalidated';
  fields: readonly Readonly<{ key: WrapperMetadataKey; value: string }>[];
  /** Delivered fields not shown (unknown keys, nested values, or values outside the allowed shape). Their names and values are never exposed. */
  withheld: number;
}>;

/** Allowlisted, shape-checked projection of untrusted wrapper metadata. Pure; does not throw on hostile input. */
export function projectWrapperMetadata(wrapper: unknown): WrapperMetadataDisplay {
  if (!record(wrapper)) return { status: 'unvalidated', fields: [], withheld: 0 };
  const fields: { key: WrapperMetadataKey; value: string }[] = [];
  let total = 0;
  for (const key of Object.keys(wrapper)) {
    total += 1;
    if (!Object.hasOwn(WRAPPER_ALLOWLIST, key)) continue;
    const value = wrapper[key];
    if (typeof value === 'string' && WRAPPER_ALLOWLIST[key as WrapperMetadataKey](value)) fields.push({ key: key as WrapperMetadataKey, value });
  }
  return { status: 'unvalidated', fields, withheld: total - fields.length };
}

export type FinancePageRequest = Omit<SummaryRequest, 'delivery' | 'references' | 'expectedDigest'> & Readonly<{
  manifest: unknown; trusted: TrustedPacketExpectation; mode: PacketMode;
  /** The whole Finance page. Only its inner `summary` is handed to the canonical reader. */
  page: unknown;
}>;
export type FinancePageRead = Readonly<{ packet: PacketOutcome; result: ProjectionResult<SummaryProjection>; wrapper?: FinanceWrapperMetadata }>;

/**
 * Gate, split and read one Finance page. The wrapper is kept separately; the exact inner `summary` goes to
 * `readFinancialSummary` with the trusted digest and references, so semantic, scope, partition and digest refusals surface
 * unchanged. A page with a null or absent `summary` is `missing`, never an empty or zero summary.
 */
export function readFinancePage(request: FinancePageRequest): FinancePageRead {
  const { manifest, trusted, mode, page, ...rest } = request;
  const packet = evaluateFinancePacket(manifest, trusted, mode);
  if (packet.outcome === 'refused') return { packet, result: packet.result };
  const fail = (code: RefusalCode, path: string): FinancePageRead => ({ packet, result: { status: 'refused', authority, code, path } });
  if (!record(page)) return fail('INVALID_PAYLOAD', '/');
  const { summary, ...wrapper } = page;
  if ('summary_id' in page) return fail('INVALID_PAYLOAD', '/summary_id');
  if (wrapper.summaryContentHash !== undefined && wrapper.summaryContentHash !== trusted.summaryDigest) return { ...fail('DIGEST_MISMATCH', '/summaryContentHash'), wrapper };
  if (summary === undefined || summary === null) return { packet, result: { status: 'missing', authority }, wrapper };
  if (!record(summary)) return { ...fail('INVALID_PAYLOAD', '/summary'), wrapper };
  const result = readFinancialSummary({ ...rest, delivery: { kind: 'payload', json: JSON.stringify(summary) }, references: trusted.references, expectedDigest: trusted.summaryDigest });
  return { packet, result, wrapper };
}
