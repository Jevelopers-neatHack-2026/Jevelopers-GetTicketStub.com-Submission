/**
 * Packet-level gate for a Finance handoff manifest. The dashboard consumes shared-contracts 0.9.7 only; a packet that
 * names another package version or a proposal-only, un-adopted schema set is refused as unsupported, never relabelled
 * or approximated. Erasable TypeScript only, no runtime imports beyond the adapter pin.
 */
import { SHARED_CONTRACTS_PIN, type ProjectionResult, type SummaryProjection } from '../../data/shared-contracts-adapter';

export type FinancePacketReferences = Readonly<{
  packageVersion?: unknown; schemaVersion?: unknown; status?: unknown; adoptionAccepted?: unknown;
}>;

const refused = (code: 'UNSUPPORTED_VERSION' | 'UNACCEPTED_INTERFACE', path: string): ProjectionResult<SummaryProjection> => ({ status: 'refused', authority: 'read_only_projection', code, path });

/** Returns a typed refusal when the packet cannot feed `readFinancialSummary`, or `undefined` when no packet-level objection exists. */
export function refuseUnsupportedPacket(manifest: unknown): ProjectionResult<SummaryProjection> | undefined {
  const refs = typeof manifest === 'object' && manifest !== null ? (manifest as { canonicalReferences?: FinancePacketReferences }).canonicalReferences : undefined;
  if (!refs || typeof refs !== 'object') return refused('UNSUPPORTED_VERSION', '/canonicalReferences');
  if (refs.packageVersion !== SHARED_CONTRACTS_PIN.version) return refused('UNSUPPORTED_VERSION', '/canonicalReferences/packageVersion');
  if (refs.schemaVersion !== '1.0.0') return refused('UNSUPPORTED_VERSION', '/canonicalReferences/schemaVersion');
  if (refs.adoptionAccepted !== true) return refused('UNACCEPTED_INTERFACE', '/canonicalReferences/adoptionAccepted');
  return undefined;
}
