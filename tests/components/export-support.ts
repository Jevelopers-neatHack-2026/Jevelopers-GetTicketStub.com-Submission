import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { FinanceV2PreparedExpectation } from '../../src/views/finance-v2';

/**
 * Shared test support for the prepared-export consumer. The receipts are the Finance producer's ACTUAL candidate receipts (SYNTHETIC_EXPORT_CONFORMANCE_ONLY): receipt 0 is committed
 * and re-hashed against the handoff pins; the other sixteen are present only after `scripts/prepare-export-conformance.mjs` has been run against the producer packet.
 * Everything built by mutating those receipts below is a clearly labelled test-built negative control, never producer output.
 */
export const DIR = 'tests/fixtures/export-conformance/';
export const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
export const json = <T = any>(path: string): T => JSON.parse(readFileSync(DIR + path, 'utf8')) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

export type Artifact = { fileName: string; mediaType: string; content: string; contentHash: string; byteLength: number };
export type Receipt = { schemaVersion: string; artifacts: Artifact[]; manifest: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Candidate = { query: { snapshotId: string; queryContentHash: string; summaryContentHash: string }; receipt: Receipt };

export const pins = json<{ receipts: { index: number; snapshotId: string; queryContentHash: string; summaryContentHash: string; schema: string; files: Record<string, { sha256: string; byteLength: number }> }[] }>('candidate-pins.json');
const receiptPath = (index: number): string => `candidate-receipts/receipt-${String(index).padStart(2, '0')}.json`;
export const hasReceipt = (index: number): boolean => existsSync(DIR + receiptPath(index));
export const loadCandidate = (index: number): Candidate => json<Candidate>(receiptPath(index));
export const receiptZero = (): Candidate => loadCandidate(0);

/** Host literals for receipt 0, stated here independently of the receipt under test. */
export const ZERO = {
  snapshotId: 'sha256:80448f1b4ce01f3df2e72e0b374c37365d873828e837bf89cea17ac0c6c999e6',
  queryContentHash: 'sha256:c37d31cd096f650a79c33b74a865ca5c4b67808e8ad2812e1e69a199293615c7',
  summaryContentHash: 'sha256:366c764516c4222767479897b26d7d4fd99c37c2bce7115fb213b987aa227755',
  asOf: '2026-10-12T22:00:00.000Z',
  period: { start: '2026-10-10T00:00:00.000Z', end: '2026-10-11T00:00:00.000Z' },
} as const;
export const expectationZero = (over: Partial<FinanceV2PreparedExpectation> = {}): FinanceV2PreparedExpectation => ({
  snapshotId: ZERO.snapshotId, queryContentHash: ZERO.queryContentHash, summaryContentHash: ZERO.summaryContentHash, format: 'json', environment: 'test', billingMode: 'live',
  asOf: ZERO.asOf, timezone: 'UTC', period: { ...ZERO.period }, currencies: ['USD'], ...over,
});

export const ok = (value: unknown) => ({ ok: true as const, value });
export const clone = <T>(value: T): T => structuredClone(value);

/**
 * Test-built variant: the content of one artifact is changed and its declared length AND its declared SHA-256 (real, computed here over the new bytes) are kept in step in the artifact
 * and in the manifest, so only the intended defect remains and the bytes are internally consistent.
 */
export function withContent(receipt: Receipt, fileName: 'summary.json' | 'metrics.csv', change: (content: string) => string): Receipt {
  const next = clone(receipt);
  const artifact = next.artifacts.find((item) => item.fileName === fileName)!;
  artifact.content = change(artifact.content);
  const length = Buffer.byteLength(artifact.content, 'utf8');
  const hash = `sha256:${sha256(artifact.content)}`;
  artifact.byteLength = length;
  artifact.contentHash = hash;
  const ref = next.manifest.artifacts.find((item: { fileName: string }) => item.fileName === fileName);
  ref.byteLength = length;
  ref.contentHash = hash;
  return next;
}

/** Test-built hostile variant: the bytes change (same length when `change` preserves it) while every DECLARED length and hash stays the original producer value. */
export function tamperUnderDeclaredHash(receipt: Receipt, fileName: 'summary.json' | 'metrics.csv', change: (content: string) => string): Receipt {
  const next = clone(receipt);
  const artifact = next.artifacts.find((item) => item.fileName === fileName)!;
  const before = artifact.content;
  artifact.content = change(before);
  if (artifact.content === before) throw new Error('tamper did not change the bytes');
  return next;
}
