import { checkPrintSpec, checkFulfillmentCapabilitySnapshot, adaptFulfillmentCatalogV1, translatePrintSpecToLegacy } from '../generated/index.js';
import type { PrintSpec, FulfillmentCapabilitySnapshot, CapabilityContext, CapabilityResult, CapabilityCode, ContractVersionMap } from '../generated/index.js';

type Assert<T extends true> = T;
type KnownDimensions = Extract<PrintSpec['constraints']['physical_dimensions'], { readonly state: 'known' }>['value'];
type UnknownGeometry = Extract<PrintSpec['constraints']['geometry']['printable'], { readonly state: 'unknown' }>;
type ExactStrings = Assert<KnownDimensions['width_nm'] extends string ? true : false>;
type CanonicalUnits = Assert<'mm' extends KnownDimensions['unit'] ? false : true>;
type ExplicitUnknown = Assert<'reason_code' extends keyof UnknownGeometry ? true : false>;
type ReadonlyProducts = Assert<FulfillmentCapabilitySnapshot['products'] extends PrintSpec[] ? false : true>;
type ExactVersion = Assert<keyof ContractVersionMap['PrintSpec'] extends '1.0.0' ? true : false>;
type NoLegacySuccess = Assert<Extract<ReturnType<typeof translatePrintSpecToLegacy>, { readonly ok: true }>['value'] extends never ? true : false>;
export function typedCapabilityBoundary(input: unknown, context: CapabilityContext): CapabilityResult<FulfillmentCapabilitySnapshot> {
  const adapted = adaptFulfillmentCatalogV1(input, context);
  return adapted.ok ? checkFulfillmentCapabilitySnapshot(adapted.value, context) : adapted;
}
export function typedSpecBoundary(input: unknown, context: CapabilityContext): CapabilityResult<PrintSpec> {
  return checkPrintSpec(input, context);
}
export const legacyBlockCode: CapabilityCode = 'LEGACY_UNREPRESENTABLE';
export type CapabilityTypeParity = readonly [ExactStrings, CanonicalUnits, ExplicitUnknown, ReadonlyProducts, ExactVersion, NoLegacySuccess];
