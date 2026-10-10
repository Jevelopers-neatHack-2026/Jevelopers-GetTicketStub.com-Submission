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

export declare function createTrustedActionPolicy(input: TrustedActionPolicyInput): TrustedActionPolicy;
export declare function createActionRequest(capability: string, billableUnits?: number): ActionRequest;
export declare function authorizeAction(policy: TrustedActionPolicy, request: ActionRequest): AuthorizationDecision;
/**
 * Synchronous annotation only. Non-boolean values, including async classifier results,
 * return null; promise-like settlements and rejections are observed and discarded.
 */
export declare function optionalInjectionSignal(text: string, classifier: unknown): boolean | null;
