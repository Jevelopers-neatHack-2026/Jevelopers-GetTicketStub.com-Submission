declare const policyBrand: unique symbol;
declare const requestBrand: unique symbol;

export type TrustedActionPolicy = { readonly [policyBrand]: true };
export type ActionRequest = { readonly [requestBrand]: true };
export type DenialReason = 'capability_not_allowed' | 'budget_limit_exceeded' | 'approval_not_valid';

export interface TrustedActionPolicyInput {
  readonly allowedCapabilities: readonly string[] | ReadonlySet<string>;
  readonly maxBillableUnits: number;
  readonly approvalRequiredCapabilities?: readonly string[] | ReadonlySet<string>;
  readonly approvedCapabilities?: readonly string[] | ReadonlySet<string>;
}

export interface AuthorizationDecision {
  readonly allowed: boolean;
  readonly denialReason: DenialReason | null;
}

declare const classifierBrand: unique symbol;
export type TrustedInjectionClassifier = { readonly [classifierBrand]: true };
export type TrustedInjectionCallback = (text: string) => boolean | Promise<boolean>;

export declare function createTrustedActionPolicy(input: TrustedActionPolicyInput): TrustedActionPolicy;
export declare function createActionRequest(capability: string, billableUnits?: number): ActionRequest;
export declare function authorizeAction(policy: TrustedActionPolicy, request: ActionRequest): AuthorizationDecision;
/**
 * Build an explicit classifier adapter for use by trusted composition-root code. This
 * records that trust decision; it does not inspect or sandbox the callback. The callback
 * must return a boolean or an ordinary native Promise. A native Promise with an own
 * `constructor`, a subclass, or a thenable must be rejection-handled by the adapter
 * before it returns. The trusted callback must not mutate the runtime Promise intrinsics.
 */
export declare function createTrustedInjectionClassifier(callback: TrustedInjectionCallback): TrustedInjectionClassifier;
/**
 * Synchronous annotation only. Raw callbacks, async settlements, and malformed values
 * return null. Rejections from ordinary native Promises are observed through the
 * captured intrinsic Promise.prototype.then.
 */
export declare function optionalInjectionSignal(text: string, classifier: TrustedInjectionClassifier): boolean | null;
