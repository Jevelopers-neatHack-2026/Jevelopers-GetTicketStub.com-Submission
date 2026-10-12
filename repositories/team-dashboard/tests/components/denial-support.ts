import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { FinanceV2PreparedExpectation } from '../../src/views/finance-v2';
import { clone, loadCandidate, pins, type Receipt } from './export-support';

/**
 * Shared support for the SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY tests. `candidate-postgres-composition.json` is the Finance producer's ACTUAL captured composition (task-local real
 * PostgreSQL holding synthetic postings, behind a synthetic single-state authority host that is NOT a live issuer). It is committed byte for byte; its bytes are re-hashed against
 * `PROVENANCE.json` here with node crypto. Everything built from it below (expectations, mutated copies) is labelled TEST_BUILT and is never producer output.
 */
export const DENIAL_DIR = 'tests/fixtures/export-denial-conformance/';
export const CAPTURE_FILE = 'candidate-postgres-composition.json';
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export const captureBytes = (): Buffer => readFileSync(DENIAL_DIR + CAPTURE_FILE);
export const provenance = (): Record<string, any> => JSON.parse(readFileSync(`${DENIAL_DIR}PROVENANCE.json`, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Counters = { sourceQueries: number; authorityCalls: number; fenceValidations: number; stateTransitions: number };
export type CapturedError = { schemaVersion: string; module: string; operation: string; code: string; retryable: boolean; safe_message: string; diagnostic_ref: string };
export type CapturedCase = {
  caseId: string; version: '1.0.0' | '2.0.0'; path: string; fixtureMode: string; expectedCode: string | null;
  sourceBinding: { scopeHash: string; snapshotReferenceHash: string; queryContentHash: string; summaryContentHash: string };
  actualResult: { ok: false; error: CapturedError } | { ok: true; value: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  reached: Record<string, unknown>; counters: { before: Counters; after: Counters };
};
export type Capture = { fixtureMode: string; failures: unknown[]; receipts: { query: Record<string, string>; receipt: Receipt }[]; executionProvenance: Record<string, unknown>; authorizationCases: CapturedCase[] };

let parsed: Capture | undefined;
export const capture = (): Capture => (parsed ??= JSON.parse(captureBytes().toString('utf8')) as Capture);
export const allCases = (): CapturedCase[] => capture().authorizationCases;
export const failureCases = (): CapturedCase[] => allCases().filter((item) => !item.actualResult.ok);
export const lateForbidden = (): CapturedCase[] => allCases().filter((item) => item.expectedCode === 'FORBIDDEN_SCOPE');
export const entryMissingFence = (): CapturedCase[] => allCases().filter((item) => item.expectedCode === 'SOURCE_UNAVAILABLE');
export const positiveCases = (version?: '1.0.0' | '2.0.0'): CapturedCase[] => allCases().filter((item) => item.actualResult.ok && (version === undefined || item.version === version));
export const answerOf = (item: CapturedCase): unknown => item.actualResult;
export const failureOf = (item: CapturedCase): CapturedError => (item.actualResult as { error: CapturedError }).error;
export const receiptOf = (item: CapturedCase): Receipt => (item.actualResult as { value: Receipt }).value;

/** Every captured file with its declared hash and length: the producer's 17 receipts (34 files) and the 28 positive case receipts (56 rich/legacy files). */
export function capturedFiles(): { origin: string; fileName: string; content: string; contentHash: string; byteLength: number }[] {
  const out: { origin: string; fileName: string; content: string; contentHash: string; byteLength: number }[] = [];
  for (const [index, entry] of capture().receipts.entries()) for (const artifact of entry.receipt.artifacts) out.push({ ...artifact, origin: `receipt:${index}` });
  for (const item of positiveCases()) for (const artifact of (item.actualResult as { value: { artifacts: typeof out } }).value.artifacts) out.push({ ...artifact, origin: item.caseId });
  return out;
}

/**
 * TEST_BUILT expectation for a positive rich case. The query and projection hashes are the capture's own `sourceBinding` (stated separately from the answer). The snapshot id, scope,
 * as-of, period and currencies are hydrated from the captured answer itself because the capture holds no separate host statement for them: this is a test fixture hydration, NOT the
 * actual PostgreSQL request and NOT a trusted current host. It is frozen before any guard sees an answer, so an answer cannot move it.
 */
export function testBuiltExpectation(item: CapturedCase): FinanceV2PreparedExpectation {
  const receipt = receiptOf(item);
  const summary = JSON.parse(receipt.artifacts[0]!.content) as { environment: string; billingMode: string; timezone: string; asOf: string; period: { start: string; end: string }; currencies: { currency: string }[] };
  return Object.freeze({
    snapshotId: receipt.manifest.snapshotId as string, queryContentHash: item.sourceBinding.queryContentHash, summaryContentHash: item.sourceBinding.summaryContentHash, format: 'json',
    environment: summary.environment, billingMode: summary.billingMode, asOf: summary.asOf, timezone: summary.timezone,
    period: Object.freeze({ start: summary.period.start, end: summary.period.end }), currencies: Object.freeze(summary.currencies.map((entry) => entry.currency)),
  });
}

/** Re-pins one original producer receipt to the capture's receipts[] entry (query holds only hashes, never the full captured request). */
export const originalReceipt = (index: number) => ({ pin: pins.receipts[index]!, fromFile: loadCandidate(index), fromCapture: capture().receipts[index]! });
export { clone };
