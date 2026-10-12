import {
  inspectSafeAssetBytes,
  SAFE_ASSET_LIMITS,
  type SafeAssetInspectionOptions,
  type SafeAssetInspectionResult,
} from '../../../src/security/assets/inspect.mjs';

const options: SafeAssetInspectionOptions = {
  contentType: 'image/svg+xml',
  signal: new AbortController().signal,
  deadlineAtMs: 10_000,
};
const result: SafeAssetInspectionResult = inspectSafeAssetBytes(new Uint8Array([1]), options);
const copy: Uint8Array | null = result.copyTransformedBytes();
const exact: boolean = result.matchesTransformedBytes(copy);
const byteCap: number = SAFE_ASSET_LIMITS.maxSourceBytes;
void [exact, byteCap];
