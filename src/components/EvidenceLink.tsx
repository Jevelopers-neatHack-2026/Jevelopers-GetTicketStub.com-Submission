import type { MouseEvent } from 'react';
import { approvedEvidenceHref, type EvidencePolicy } from './evidence-policy';
export type EvidenceDisplay = Readonly<{ status: 'permitted'; href: string; label: string }> | Readonly<{ status: 'restricted' | 'unavailable' }>;
export function EvidenceLink({ evidence, policy, onNavigate, id }: { evidence: EvidenceDisplay; policy: EvidencePolicy; onNavigate?: (href: string) => void; id?: string }) {
  if (evidence.status !== 'permitted') return <span>{evidence.status === 'restricted' ? 'Evidence restricted' : 'Evidence unavailable'}</span>;
  const href = approvedEvidenceHref(evidence.href, policy);
  if (!href || !evidence.label.trim()) return <span>Evidence unavailable</span>;
  const external = href.startsWith('https://');
  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    if (!onNavigate || external || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href!);
  }
  return <a id={id} href={href} onClick={navigate} rel={external ? 'noopener noreferrer' : undefined}>{evidence.label}{external && <> <span>(external site)</span></>}</a>;
}
export type { EvidencePolicy } from './evidence-policy';
