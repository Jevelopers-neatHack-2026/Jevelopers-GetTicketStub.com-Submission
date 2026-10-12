declare const releaseAuthorityBrand: unique symbol;
declare const releaseCheckBrand: unique symbol;

/** Opaque one-shot authority issued by the authenticated host composition. */
export type PrivateAssetReleaseAuthority = { readonly [releaseAuthorityBrand]: true };
/** Opaque single-use result of the store's async revalidation preflight. */
export type PrivateAssetReleaseCheck = { readonly [releaseCheckBrand]: true };

/**
 * Host-owned controller. Keep it in the authorization layer and call revoke
 * synchronously whenever tenant, release, asset, or policy authority changes.
 */
export interface PrivateAssetReleaseAuthorityController {
  revoke(reason?: string): 'before_release' | 'after_release' | null;
}

/** Internal fail-closed adapter helpers for supported native Promise values. */
export declare function hasThenableBehavior(value: unknown): boolean;
export declare function observeNativeRejectedPromise(value: unknown): boolean;
export declare function subscribeToSupportedNativePromise(
  value: unknown,
  onFulfilled: ((value: unknown) => void) | undefined,
  onRejected: ((reason: unknown) => void) | undefined,
): boolean;
