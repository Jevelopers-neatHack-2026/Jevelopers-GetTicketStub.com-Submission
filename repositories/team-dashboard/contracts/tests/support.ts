import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importVerified } from '../../scripts/verified-package.mjs';
import type { ContractKit, ContractScope } from '../../src/data/shared-contracts-adapter';

/** The real, installed package helpers behind the adapter's injected port. */
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sc = await importVerified(import.meta.resolve('@jevelopers/shared-contracts'), repoRoot);
const { fixturePayload } = await importVerified(import.meta.resolve('@jevelopers/shared-contracts/fixture-harness'), repoRoot);
export const kit = sc as unknown as ContractKit;
const packageRoot = join(repoRoot, 'node_modules/@jevelopers/shared-contracts');
export type FixtureCase = { id: string; category: string; mode?: string; set?: Record<string, unknown>; remove?: string[]; context?: any; expected: { ok: boolean; code?: string; path?: string; canonical_sha256?: string }; json?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type FixtureManifest = { contract: string; schema_version: string; policy_version: string; valid: Record<string, any>; cases: FixtureCase[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const manifest = (name: string): FixtureManifest => JSON.parse(readFileSync(join(packageRoot, 'fixtures', name + '.json'), 'utf8'));
export const payloadOf = (m: FixtureManifest, id: string) => fixturePayload(m as never, m.cases.find((c) => c.id === id)! as never) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export const caseOf = (m: FixtureManifest, id: string) => m.cases.find((c) => c.id === id)!;

export const TENANT = '123e4567-e89b-42d3-a456-426614174000';
export const PROJECT = '123e4567-e89b-42d3-a456-426614174111'; // distinct from the fixtures' tenant so a tenant/project swap is detectable
export const scopeOf = (over: Partial<ContractScope> = {}): ContractScope => ({ tenantId: TENANT, projectId: TENANT, environment: 'test', billingMode: 'simulated', ...over });
export const NOW = '2026-10-10T12:05:00Z';
export const json = (value: unknown) => JSON.stringify(value);
