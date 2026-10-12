import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectWrapperMetadata, readFinancePage, type TrustedPacketExpectation } from '../../src/views/financial-summary';
import { NOW, caseOf, kit, manifest, scopeOf } from './support';

/**
 * Real-helper evidence for the Finance packet gate: the installed, hash-verified shared-contracts package supplies the
 * schema bytes, the producer fixture, `hashManifest` and `checkFinancialSummary`. Nothing is stubbed. It needs
 * `npm run contracts:provision` like every test in this suite and has no skip path: unprovisioned, the suite fails closed.
 * The producer fixture's own references are the trusted expectation; no reference or digest is invented here.
 */
const m = manifest('FinancialSummary');
const context = caseOf(m, 'semantic-positive').context;
const packageRoot = join(import.meta.dirname, '../../node_modules/@jevelopers/shared-contracts');
const schemaSha256 = createHash('sha256').update(readFileSync(join(packageRoot, 'schemas/FinancialSummary/1.0.0.json'))).digest('hex');
const summary = () => structuredClone(m.valid) as Record<string, unknown>;
const trusted = (over: Partial<TrustedPacketExpectation> = {}): TrustedPacketExpectation => ({ schemaSha256, summaryDigest: caseOf(m, 'minimal').expected.canonical_sha256!, references: context.references, ...over });
const packet = { canonicalReferences: { status: 'proposal_only', adoptionAccepted: false, packageVersion: '0.3.0', schemaVersion: '1.0.0', schemas: [{ contract: 'FinancialSummary', schemaVersion: '1.0.0', sha256: schemaSha256 }] }, financeAcknowledgment: null, dashboardAcknowledgment: null };
const request = (over = {}) => ({ kit, scope: scopeOf(), now: NOW, maxAgeMs: 3_600_000, currency: 'USD', metricNames: ['expense'], manifest: packet, trusted: trusted(), mode: 'synthetic_development' as const, page: { summary: summary() }, ...over });

describe('Finance packet gate against the real consumer helper (synthetic development only)', () => {
  it('reads the producer fixture through the gate, the canonical digest and the semantic check', () => {
    const read = readFinancePage(request());
    expect(read.packet).toMatchObject({ outcome: 'synthetic_development_only', productionAdoption: 'not_established' });
    expect(read.result.status).toBe('ready');
  });
  it('refuses an absent, invalid or production mode before the canonical reader runs', () => {
    for (const mode of [undefined, 'prod', 'production']) expect(readFinancePage(request({ mode })).result).toMatchObject({ status: 'refused' });
  });
  it('refuses a tampered summary against the trusted digest, and a swapped trusted schema digest', () => {
    const tampered = JSON.parse(JSON.stringify(summary()).replace('"amount":"0.000003"', '"amount":"0.000004"')) as Record<string, unknown>;
    expect(tampered).not.toEqual(summary());
    expect(readFinancePage(request({ page: { summary: tampered } })).result).toMatchObject({ status: 'refused', code: 'DIGEST_MISMATCH' });
    expect(readFinancePage(request({ trusted: trusted({ schemaSha256: 'f'.repeat(64) }) })).result).toMatchObject({ status: 'refused', code: 'DIGEST_MISMATCH' });
  });
  it('keeps hostile wrapper fields out of the display projection while the summary still reads', () => {
    const read = readFinancePage(request({ page: { summary: summary(), watermark: 'sk-live-canary', token: 'canary' } }));
    expect(read.result.status).toBe('ready');
    expect(projectWrapperMetadata(read.wrapper)).toEqual({ status: 'unvalidated', fields: [], withheld: 2 });
  });
});
