import { Value } from '@sinclair/typebox/value';
import { createReportingSnapshotReader, readVerifiedSummarySnapshotV2, REPORTING_CANONICAL_REFERENCE_REGISTRY, ReportingMetricDefinitionSchema, ReportingPolicyDefinitionSchema, type FinancialSummaryPageV2, type ReportingPorts } from '../reporting/index.js';
import { checkFinancialSummary, type VersionedReference } from '@jevelopers/shared-contracts';
import type { FinancialSummaryPage } from '../reporting/index.js';
import { hashExportCanonical, freezeExportValue, type ExportRuntimePorts, type ExportArtifactStorePort } from './runtime.js';
import type { TrustedScope } from '../shared/contracts.js';
import type { ReportingExportArtifactStorePort } from './reporting-export.js';

/** Exact immutable Finance-owned registry body; raw committed fixture SHA is independently tested. */
export const REPORTING_EXPORT_REGISTRY_PIN = 'sha256:827ac8d4e37adc354dc8721d4f34c4c3bfb0039b318ae769ed8fec3e249055c2';
type Registry = typeof REPORTING_CANONICAL_REFERENCE_REGISTRY;
function pinRegistry(value: Registry): Registry {
  const registry = freezeExportValue(value);
  if (hashExportCanonical(registry) !== REPORTING_EXPORT_REGISTRY_PIN) throw new Error('The Finance definition registry does not match the export pin.');
  for (const [name, entry] of Object.entries(registry.metrics)) {
    if (!Value.Check(ReportingMetricDefinitionSchema, entry.definition) || entry.definition.metric !== name
        || entry.reference.id !== entry.definition.definitionId || entry.reference.contract !== entry.definition.contract
        || entry.reference.revision !== entry.definition.revision || entry.reference.content_hash !== hashExportCanonical(entry.definition)) {
      throw new Error('The Finance metric definition does not match its registered artifact.');
    }
  }
  if (!Value.Check(ReportingPolicyDefinitionSchema, registry.policy.definition)
      || registry.policy.reference.id !== registry.policy.definition.definitionId
      || registry.policy.reference.content_hash !== hashExportCanonical(registry.policy.definition)) throw new Error('The Finance policy definition does not match its registered artifact.');
  return registry;
}
// Copied at module initialization, before any query response can expose a producer alias.
const PINNED_REGISTRY = pinRegistry(REPORTING_CANONICAL_REFERENCE_REGISTRY);
type SnapshotReference = { readonly scope: TrustedScope; readonly snapshotId: string; readonly queryContentHash: string; readonly summaryContentHash: string };
export type ReportingExportBridge = {
  readonly registry: Registry;
  readonly artifactStoreV2?: ReportingExportArtifactStorePort;
  readVerifiedSnapshotV2(request: SnapshotReference): Promise<FinancialSummaryPageV2 | null>;
};
const bridges = new WeakMap<object, ReportingExportBridge>();

/**
 * Concrete composition over the public Finance PostgreSQL readers. No caller
 * summary, requestedBy label, or generic "verified" flag establishes provenance.
 * Each reader freshly enforces reporting permission in addition to export permission.
 */
export function createReportingExportRuntimePorts(ports: ReportingPorts, artifactStore: ExportArtifactStorePort, artifactStoreV2?: ReportingExportArtifactStorePort): ExportRuntimePorts {
  const configured = Object.freeze({ snapshotReader: Object.freeze(createReportingSnapshotReader(ports)), artifactStore });
  bridges.set(configured, Object.freeze({
    registry: PINNED_REGISTRY,
    ...(artifactStoreV2 ? { artifactStoreV2 } : {}),
    async readVerifiedSnapshotV2(request: SnapshotReference) {
      const result = await readVerifiedSummarySnapshotV2({ ...freezeExportValue(request), schemaVersion: '1.0.0', requestId: 'finance-export-verified-snapshot' }, ports);
      return result.ok ? freezeExportValue(result.value) : null;
    },
  }));
  return { ...ports, exports: configured };
}
export function reportingExportBridge(ports: ExportRuntimePorts): ReportingExportBridge | undefined {
  return ports.exports ? bridges.get(ports.exports) : undefined;
}
export function checkRegisteredCanonicalSummary(page: Pick<FinancialSummaryPage, 'summary'>, scope: TrustedScope, now: string): boolean {
  if (page.summary.tenant_id !== scope.tenantId || page.summary.project_id !== scope.projectId) return false;
  const references: Record<string, VersionedReference> = { policy_ref: PINNED_REGISTRY.policy.reference as VersionedReference };
  for (const name of Object.keys(page.summary.metrics)) {
    const registered = PINNED_REGISTRY.metrics[name];
    if (!registered) return false;
    references[`metrics/${name}/definition_ref`] = registered.reference as VersionedReference;
  }
  return checkFinancialSummary(page.summary, {
    scope: { tenant_id: page.summary.tenant_id, project_id: page.summary.project_id },
    now: now as FinancialSummaryPage['summary']['occurred_at'], policy_version: '1.0.0', references, currency: page.summary.currency,
    included_environments: [scope.environment], included_billing_modes: [scope.billingMode],
  }).ok;
}
