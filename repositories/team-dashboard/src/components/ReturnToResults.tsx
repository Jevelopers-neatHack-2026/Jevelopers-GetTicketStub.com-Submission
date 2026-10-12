import { EvidenceLink, type EvidencePolicy } from './EvidenceLink';
export function ReturnToResults({ href, policy, onNavigate }: { href: string; policy: EvidencePolicy; onNavigate: (href: string) => void }) {
  return <EvidenceLink evidence={{ status: 'permitted', href, label: 'Return to results' }} policy={policy} onNavigate={onNavigate} />;
}
