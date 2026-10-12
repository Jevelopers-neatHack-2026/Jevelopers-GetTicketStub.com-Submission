import type { UsageEvent_1_0_0, UsageEvent_2_0_0 } from '../generated/index.js';
import type {
  ProductionMeteringPort,
  ProductionReferenceValue,
  ProductionResult
} from '../generated/production-operations.js';

type IsAssignable<Source, Target> = [Source] extends [Target] ? true : false;
type Assert<T extends true> = T;
type LegacyObserveInput = Parameters<ProductionMeteringPort['observe']>[0];

export type LegacyPortAcceptsAssignedV1 = Assert<IsAssignable<UsageEvent_1_0_0, LegacyObserveInput>>;
export type LegacyPortRejectsOptInV2 = Assert<IsAssignable<UsageEvent_2_0_0, LegacyObserveInput> extends false ? true : false>;

declare const existingV1Observer: (
  event: UsageEvent_1_0_0
) => Promise<ProductionResult<ProductionReferenceValue>>;

export const unchangedV1MeteringPort = {
  observe: existingV1Observer
} satisfies ProductionMeteringPort;
