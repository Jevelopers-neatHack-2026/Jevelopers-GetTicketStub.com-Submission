import type { UsageEvent_2_0_0 } from '@jevelopers/shared-contracts';
import type { ProductionMeteringPort } from '@jevelopers/shared-contracts/production-operations';
declare const port: ProductionMeteringPort;
declare const value: UsageEvent_2_0_0;
void port.observe(value);
