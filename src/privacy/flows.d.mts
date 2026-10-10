import type { BoundaryResult, PrivacyBoundary, SanitizedDerivative, TenantScope } from './boundary.mjs';

declare const telemetryBrand: unique symbol;
declare const decisionBrand: unique symbol;
declare const creativeBrand: unique symbol;

export type TelemetryRecord = { readonly [telemetryBrand]: true };
export type DecisionState = { readonly [decisionBrand]: true };
export type CreativePayload = { readonly [creativeBrand]: true };

export interface PrivacyFlows {
  readonly cache: {
    put(scope: TenantScope, key: string, derivative: SanitizedDerivative): void;
    get(scope: TenantScope, key: string): SanitizedDerivative | undefined;
    snapshot(scope: TenantScope): readonly SanitizedDerivative[];
    clear(scope: TenantScope): void;
  };
  readonly diagnostic: {
    record(scope: TenantScope, result: BoundaryResult): TelemetryRecord;
    snapshot(scope: TenantScope): readonly TelemetryRecord[];
  };
  makeDecisionState(scope: TenantScope, derivative: SanitizedDerivative): DecisionState;
  makeCreativePayload(scope: TenantScope, derivative: SanitizedDerivative): CreativePayload;
  decisionPayload(scope: TenantScope, state: DecisionState): Readonly<Record<string, unknown>>;
  creativePayload(scope: TenantScope, payload: CreativePayload): Readonly<Record<string, unknown>>;
  serialize(scope: TenantScope, selections?: {
    readonly cacheValues?: readonly SanitizedDerivative[];
    readonly telemetryValues?: readonly TelemetryRecord[];
    readonly decisionValues?: readonly DecisionState[];
    readonly creativeValues?: readonly CreativePayload[];
  }): string;
}

export declare function createPrivacyFlows<Request>(boundary: PrivacyBoundary<Request>): PrivacyFlows;
