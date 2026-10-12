import { validateContract, checkTrustedContext } from '@jevelopers/shared-contracts';
import type { ContractMap, ContractName, ContractVersionMap, Composition } from '@jevelopers/shared-contracts';
import {
  checkTemplateSpec, checkComposition, checkProductionFacts, checkProductionPreflight,
  checkRowResult, verifyProductionBundleFiles, verifyProductionZip, validateProductionReference,
  checkProductionValueIntegrity,
} from '@jevelopers/shared-contracts/production-operations';
import type {
  ProductionScope, CompositionContext, ProductionPreflightContext, BatchCheckContext,
  ProductionByteContext, ProductionObservedFile, ProductionZipDescriptor,
} from '@jevelopers/shared-contracts/production-operations';

type Assert<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
export type VersionCoverage = Assert<{
  [K in ContractName]: ContractMap[K]['schema_version'] extends keyof ContractVersionMap[K] ? true : false
}[ContractName]>;
export type ReadonlyComposition = Assert<Equal<Composition, Readonly<Composition>>>;
export type ReadonlyBindings = Assert<Equal<Composition['slot_bindings'], Readonly<Composition['slot_bindings']>>>;

/** Consumer boundary: validation results remain observations, never release authority. */
export function inspectDesign(value: unknown, scope: ProductionScope) {
  const parsed = validateContract('TemplateSpec', value);
  if (!parsed.ok) return parsed;
  const scoped = checkTrustedContext(parsed.value, scope);
  if (!scoped.ok) return scoped;
  return checkTemplateSpec(parsed.value, scope);
}
export function inspectFacts(value: unknown, scope: ProductionScope) {
  return checkProductionFacts(value, scope);
}
export function inspectReference(value: unknown) {
  return validateProductionReference(value);
}
export function inspectValue<K extends ContractName>(contract: K, value: unknown, scope: ProductionScope) {
  return checkProductionValueIntegrity(contract, value, scope);
}
export function inspectComposition(value: unknown, context: CompositionContext) {
  return checkComposition(value, context);
}
export function inspectRow(value: unknown, context: BatchCheckContext) {
  return checkRowResult(value, context);
}
export function inspectPreflight(value: unknown, context: ProductionPreflightContext) {
  return checkProductionPreflight(value, context);
}
export function inspectBytes(files: readonly ProductionObservedFile[], context: ProductionByteContext) {
  return verifyProductionBundleFiles(files, context);
}
export function inspectZip(bytes: Uint8Array, expected: readonly ProductionZipDescriptor[]) {
  return verifyProductionZip(bytes, expected);
}
