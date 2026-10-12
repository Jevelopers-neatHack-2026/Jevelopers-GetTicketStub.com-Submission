import { validateContract, checkTrustedContext, checkResearchCreative, checkDesignVersion, adaptResearchPackage, ContractError } from '../generated/index.js';
import type { TrustedContext, ResearchContext, DesignContext, EventIntelligencePackage, ResearchFact, Control, OperationResult, ProjectRequest } from '../generated/index.js';
export function ingress(input: unknown, serverContext: ResearchContext): OperationResult<ProjectRequest> { return checkResearchCreative('ProjectRequest', input, serverContext); }
export function scopedPackage(input: unknown, authenticatedScope: TrustedContext): EventIntelligencePackage | undefined {
  const parsed = validateContract('EventIntelligencePackage', input);
  if (!parsed.ok) return undefined;
  const scoped = checkTrustedContext(parsed.value, authenticatedScope);
  return scoped.ok ? scoped.value : undefined;
}
export function exactDesign(input: unknown, serverContext: DesignContext) { return checkDesignVersion(input, serverContext); }
export function proposedAlias(source: unknown, candidate: EventIntelligencePackage) { return adaptResearchPackage(source, 'creative-local-1.1', candidate); }
export function factState(fact: ResearchFact): string {
  switch (fact.status) {
    case 'known': return 'known';
    case 'unknown': return 'unknown';
    case 'conflicting': return 'conflicting';
    case 'review': return 'review';
    default: throw new ContractError('INVALID_PAYLOAD');
  }
}
export function defaultControlValue(control: Control): unknown {
  switch (control.kind) {
    case 'number': return control.default_value;
    case 'enum': return control.default_value;
    case 'boolean': return control.default_value;
    case 'text': return control.default_value;
    default: throw new ContractError('INVALID_PAYLOAD');
  }
}
