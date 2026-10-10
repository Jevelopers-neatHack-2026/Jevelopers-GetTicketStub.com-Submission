import {
  ASSET_PERMISSION_SELECTION_LIMITS,
  createAssetPermissionSelector,
  type AssetPermissionCandidate,
  type AssetPermissionHandoffPayload,
  type AssetPermissionRequest,
  type AssetPermissionSelector,
} from '../../../src/verification/asset-permissions/index.mjs';

declare const request: AssetPermissionRequest;
declare const candidate: AssetPermissionCandidate;
declare const payload: AssetPermissionHandoffPayload;

const selector: AssetPermissionSelector = createAssetPermissionSelector({});
const selected = selector.select({ request, candidates: [candidate] }, {
  deadlineAtMs: performance.now() + ASSET_PERMISSION_SELECTION_LIMITS.maxOperationMs,
});
void selected.then((summary) => selector.handoff(summary.handle, request));
void [payload.referenceImages, payload.permittedAssets, ASSET_PERMISSION_SELECTION_LIMITS.maxCandidates];
