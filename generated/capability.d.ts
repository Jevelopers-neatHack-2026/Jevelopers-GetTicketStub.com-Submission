import type { PrintSpec_1_0_0, FulfillmentCapabilitySnapshot_1_0_0, TenantId, ProjectId, ValidationCode } from './index.js';
export type { PrintSpec_1_0_0 as PrintSpec, FulfillmentCapabilitySnapshot_1_0_0 as FulfillmentCapabilitySnapshot } from './index.js';
export type CapabilityCode = ValidationCode | 'RESOURCE_LIMIT' | 'INVALID_CLOCK' | 'PHYSICAL_RANGE' | 'PRIVATE_METADATA' | 'GEOMETRY_UNCONFIRMED' | 'IMPOSSIBLE_SAFE_GEOMETRY' | 'CONTRADICTORY_CONSTRAINT' | 'DUPLICATE_ROUTE' | 'CONTRADICTORY_ROUTE' | 'SPEC_HASH_MISMATCH' | 'EXPIRY_MISMATCH' | 'CLOCK_BEFORE_CAPTURE' | 'STALE_CAPTURE' | 'DUPLICATE_PRODUCT' | 'PROVIDER_MISMATCH' | 'CONTENT_HASH_MISMATCH' | 'CAPTURE_HASH_MISMATCH' | 'CAPTURE_BINDING_MISMATCH' | 'PRODUCT_MISSING' | 'SPEC_DRIFT' | 'AVAILABILITY_UNCONFIRMED' | 'CAPTURE_CLOCK_REGRESSION' | 'LEGACY_UNREPRESENTABLE' | 'LEGACY_ADOPTION_PENDING' | 'UNSUPPORTED_LEGACY_TARGET' | 'INVALID_PHYSICAL_DECIMAL' | 'UNSUPPORTED_PHYSICAL_UNIT' | 'INEXACT_PHYSICAL_UNIT' | 'UNSUPPORTED_SOURCE_FIELD' | 'UNSUPPORTED_SOURCE_VERSION';
export type CapabilityResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly code: CapabilityCode; readonly path: string; readonly keyword?: string }[] };
export type CapabilityScope = { readonly tenant_id: TenantId; readonly project_id: ProjectId };
export type CapabilityContext = { readonly trusted_scope: CapabilityScope; readonly now: string };
export type PrintSpecBindingContext = CapabilityContext & { readonly capture_identity: string; readonly content_identity: string };
export type CapabilityIdentities = { readonly spec_identities: readonly string[]; readonly content_identity: string; readonly capture_identity: string };
export type CaptureComparison = { readonly status: 'unchanged' | 'material_drift' | 'source_or_catalog_change' | 'capture_refresh'; readonly changed_products: readonly { readonly sku: string; readonly variant_id: string }[] };
export declare function convertPhysicalLength(input: { readonly value: string; readonly unit: 'mm' | 'cm' | 'in' }): CapabilityResult<string>;
/** Field/value migration only. Unknown source fields and unsupported private versions block. */
export declare function adaptFulfillmentCatalogV1(input: unknown, context: CapabilityContext): CapabilityResult<FulfillmentCapabilitySnapshot_1_0_0>;
export declare function hashPrintSpec(value: unknown): CapabilityResult<string>;
export declare function deriveCapabilityIdentities(value: unknown): CapabilityResult<CapabilityIdentities>;
export declare function checkPrintSpec(value: unknown, context: Pick<CapabilityContext, 'trusted_scope'>): CapabilityResult<PrintSpec_1_0_0>;
export declare function checkFulfillmentCapabilitySnapshot(value: unknown, context: CapabilityContext): CapabilityResult<FulfillmentCapabilitySnapshot_1_0_0>;
export declare function checkPrintSpecBinding(value: unknown, snapshot: unknown, context: PrintSpecBindingContext): CapabilityResult<PrintSpec_1_0_0>;
export declare function compareFulfillmentCaptures(prior: unknown, current: unknown, context: CapabilityContext): CapabilityResult<CaptureComparison>;
export declare function translatePrintSpecToLegacy(value: unknown, target: 'ProductionBundle/1.0.0' | 'FulfillmentQuote/1.0.0' | 'OrderAuthorization/1.0.0'): CapabilityResult<never>;
