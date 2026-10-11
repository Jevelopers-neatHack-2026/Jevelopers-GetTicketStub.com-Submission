import type { ContractMap, ContractVersionMap, ContractName, CommonEnvelope, ProjectRequest, DecisionPortRequest, TenantId, ProjectId, Brand } from '../generated/index.js';
import { versions, parseContract } from '../generated/index.js';
type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type EveryVersion = Assert<{ [K in ContractName]: Equal<ContractMap[K]['schema_version'], keyof ContractVersionMap[K]> }[ContractName]>;
type EveryDiscriminator = Assert<{ [K in ContractName]: Equal<ContractMap[K]['contract'], K> }[ContractName]>;
type ExactRegistry = Assert<Equal<keyof typeof versions.CommonEnvelope, '1.0.0'>>;
type QuestionMap = Assert<Equal<DecisionPortRequest['questions'], Readonly<DecisionPortRequest['questions']>>>;
type StableTenantBrand = Assert<Equal<TenantId, Brand<string, 'TenantId'>>>;
type SeparateScope = Assert<ProjectId extends TenantId ? false : true>;
type NoRawBrand = Assert<string extends TenantId ? false : true>;
type NoUnknownVersion = Assert<'2.0.0' extends ProjectRequest['schema_version'] ? false : true>;
export type FinalParity = readonly [EveryVersion, EveryDiscriminator, ExactRegistry, QuestionMap, StableTenantBrand, SeparateScope, NoRawBrand, NoUnknownVersion];
export function generatedBoundary(json: string): CommonEnvelope | undefined {
  const result = parseContract('CommonEnvelope', json);
  return result.ok ? result.value : undefined;
}
