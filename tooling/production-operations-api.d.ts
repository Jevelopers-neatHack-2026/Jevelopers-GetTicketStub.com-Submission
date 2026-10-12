import type { ContractMap, ContractName, TrustedContext, TenantId, ProjectId, UtcTime, Sha256, ProductionReference, ProductionError, ComposeArtifactRequest, PersonalizeBatchRequest, InspectArtifactRequest, ExportBundleRequest, CompareTemplateRequest, ArtifactStatusRequest, ArtifactRef, JobRef, BatchResult, RowResult, PreflightReport, CompatibilityReport, ProductionBundleRef, ArtifactManifestStatus, TemplateSpec, Composition, PersonalizationSchema, ProductionExecutionPins, ProductionRuntime, ProductionPolicy, ProductionResource, CsvDialect, CsvMapping, CsvCheckpoint, ApprovalReceipt, ApprovalVerificationOutcome, EventIntelligencePackage, PrintSpec_1_0_0, ProductionBundle_2_0_0, ProductionBundleDetached, ArtifactFile, PartialFailure, JobStatus, OperationContext, BatchContext, JobContext, UsageEvent_1_0_0 } from '../generated/index.js';
export type { ComposeArtifactRequest, PersonalizeBatchRequest, InspectArtifactRequest, ExportBundleRequest, CompareTemplateRequest, ArtifactStatusRequest, ArtifactRef, JobRef, BatchResult, RowResult, PreflightReport, CompatibilityReport, ProductionBundleRef, ArtifactManifestStatus, TemplateSpec, Composition, PersonalizationSchema, ProductionError, ProductionExecutionPins } from '../generated/index.js';
export type ProductionResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProductionError };
export type ProductionReferenceValue = ProductionReference['reference'];
export type ProductionOperation = ProductionError['operation'];
export type ProductionScope = Pick<TrustedContext, 'tenant_id' | 'project_id'>;
export type ProductionHostAuthority = { readonly actor_id: ApprovalReceipt['actor_id']; readonly audience: ApprovalReceipt['audience'] };
export type ProductionCheck<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly path: string; readonly keyword?: string }[] };
export type ProductionRequestMap = { readonly composeArtifact: ComposeArtifactRequest; readonly personalizeArtifactBatch: PersonalizeBatchRequest; readonly inspectArtifact: InspectArtifactRequest; readonly exportArtifactBundle: ExportBundleRequest; readonly compareTemplateCompatibility: CompareTemplateRequest; readonly getArtifactManifestStatus: ArtifactStatusRequest };
export type ProductionValueMap = { readonly composeArtifact: ArtifactRef; readonly personalizeArtifactBatch: JobRef | BatchResult; readonly inspectArtifact: PreflightReport; readonly exportArtifactBundle: ProductionBundleRef; readonly compareTemplateCompatibility: CompatibilityReport; readonly getArtifactManifestStatus: ArtifactManifestStatus };

export interface ProductionReferencePort {
  readonly resolve: <K extends ContractName>(reference: ProductionReferenceValue & { readonly contract: K }, scope: ProductionScope) => Promise<ProductionResult<ContractMap[K]>>;
}
export interface ProductionAuthorizationPort {
  readonly verify: (reference: ProductionReferenceValue, scope: ProductionScope) => Promise<ProductionResult<ApprovalVerificationOutcome>>;
}
export interface ProductionAssetPort {
  readonly resolve: (reference: ProductionReferenceValue, scope: ProductionScope) => Promise<ProductionResult<Uint8Array>>;
  readonly verifyPermission: (reference: ProductionReferenceValue, scope: ProductionScope) => Promise<ProductionResult<ApprovalVerificationOutcome>>;
}
export interface ProductionTemplatePort {
  readonly resolve: (reference: ProductionReferenceValue, scope: ProductionScope) => Promise<ProductionResult<TemplateSpec>>;
}
export interface ProductionStoragePort {
  readonly readStatus: (target: ArtifactStatusRequest['target'], scope: ProductionScope) => Promise<ProductionResult<ArtifactManifestStatus>>;
  readonly publish: (bundle: ProductionBundleRef, scope: ProductionScope) => Promise<ProductionResult<ProductionBundleRef>>;
}
export interface ProductionMeteringPort {
  readonly observe: (observation: UsageEvent_1_0_0) => Promise<ProductionResult<ProductionReferenceValue>>;
}
/** Host implementation supplies and authenticates ports. Shared-contracts never calls them. */
export interface ProductionContext {
  readonly scope: ProductionScope;
  /** Authenticated independently by the host and bound before operation entry. */
  readonly authority: ProductionHostAuthority;
  readonly clock: { readonly now: () => UtcTime };
  readonly policy_version: '1.0.0';
  readonly references: ProductionReferencePort;
  readonly environment: 'development' | 'test' | 'production';
  readonly billing_mode: 'live' | 'sandbox' | 'simulated';
  readonly evidence_mode: 'simulated' | 'offline' | 'sandbox' | 'live';
  readonly authorization: ProductionAuthorizationPort;
  readonly assets: ProductionAssetPort;
  readonly templates: ProductionTemplatePort;
  readonly runtime: ProductionExecutionPins;
  readonly storage: ProductionStoragePort;
  readonly metering: ProductionMeteringPort;
}
/** Service binding interfaces only, no callable fake compositor. */
export interface ProductionOperations {
  readonly composeArtifact: (ctx: ProductionContext, request: ComposeArtifactRequest) => Promise<ProductionResult<ArtifactRef>>;
  readonly personalizeArtifactBatch: (ctx: ProductionContext, request: PersonalizeBatchRequest) => Promise<ProductionResult<JobRef | BatchResult>>;
  readonly inspectArtifact: (ctx: ProductionContext, request: InspectArtifactRequest) => Promise<ProductionResult<PreflightReport>>;
  readonly exportArtifactBundle: (ctx: ProductionContext, request: ExportBundleRequest) => Promise<ProductionResult<ProductionBundleRef>>;
  readonly compareTemplateCompatibility: (ctx: ProductionContext, request: CompareTemplateRequest) => Promise<ProductionResult<CompatibilityReport>>;
  readonly getArtifactManifestStatus: (ctx: ProductionContext, request: ArtifactStatusRequest) => Promise<ProductionResult<ArtifactManifestStatus>>;
}
export type ProductionRequestContext = { readonly scope: ProductionScope; readonly policy_version: '1.0.0'; readonly references: Readonly<Record<string, ProductionReferenceValue>> };
export type ProductionErrorContext = { readonly scope: ProductionScope; readonly correlation_id: ContractMap['CommonEnvelope']['correlation_id']; readonly operation: ProductionOperation; readonly diagnostic_ref?: ProductionError['diagnostic_ref']; readonly blocking_condition?: ProductionError['blocking_condition']; readonly side_effects?: ProductionError['side_effects']; readonly usage_state?: ProductionError['usage_state']; readonly field_path?: ProductionError['field_path']; readonly row_id?: string };
export type ProductionApprovalContext = { readonly scope: ProductionScope; readonly now: UtcTime; readonly expected_binding: ApprovalReceipt['binding'] } & ProductionHostAuthority;
export type ProductionFacts = { readonly reference: ProductionReferenceValue; readonly package: EventIntelligencePackage };
export type CompositionContext = { readonly scope: ProductionScope; readonly template: TemplateSpec; readonly personalization: PersonalizationSchema; readonly facts: ProductionFacts | null; readonly expected_references: Readonly<Record<string, ProductionReferenceValue>>; readonly expected_resolved_layout_commitment: Sha256; readonly expected_policy_refs: Composition['policy_refs']; readonly expected_font_refs: Composition['font_refs']; readonly expected_runtime_ref: Composition['runtime_ref']; readonly asset_bytes: Readonly<Record<string, Uint8Array>> };
export type PlanContext = { readonly scope: ProductionScope; readonly policy: PersonalizationSchema; readonly template: TemplateSpec };
export type OriginalRow = Extract<PersonalizeBatchRequest['input'], { readonly kind: 'structured' }>['rows'][number];
export type VerifiedRow = { readonly artifact_ref: ArtifactRef; readonly bundle_ref: ProductionBundleRef; readonly preflight_status: 'passed'; readonly input_hash: Sha256; readonly ordinal: number; readonly job: JobRef };
export type BatchCheckContext = { readonly scope: ProductionScope; readonly job: JobRef; readonly original_rows: readonly OriginalRow[]; readonly verified_rows?: Readonly<Record<string, VerifiedRow>> };
export type CompleteBatch = { readonly batch: BatchResult; readonly rows: readonly RowResult[] };
export type PartialProjectionContext = BatchCheckContext & { readonly envelope: ContractMap['CommonEnvelope']; readonly policy_ref: NonNullable<PartialFailure['policy_ref']>; readonly v1_errors: Readonly<Record<string, PartialFailure['failures'][number]['error']>>; readonly operation_context: OperationContext };
export type JobProjectionContext = BatchCheckContext & { readonly batch_ref: NonNullable<PartialFailure['policy_ref']>; readonly job_candidate: JobStatus; readonly job_context: JobContext };
export type CsvContext = { readonly enabled: boolean; readonly scope: ProductionScope; readonly enabling_ref?: ProductionReferenceValue; readonly expected_enabling_ref?: ProductionReferenceValue; readonly dialect?: CsvDialect; readonly mapping?: CsvMapping; readonly row_policy?: PersonalizationSchema; readonly checkpoint?: CsvCheckpoint; readonly checkpoint_ref?: ProductionReferenceValue; readonly complete_record_byte_offset?: number; readonly logical_record?: number; readonly physical_line?: number };
export type ProductionObservedFile = { readonly filename: string; readonly bytes: Uint8Array };
export type ProductionByteContext = { readonly scope: ProductionScope; readonly trusted_commitment: ProductionBundleRef };
export type ProductionPreflightContext = { readonly artifact_ref: ArtifactRef; readonly spec_ref: ProductionReferenceValue; readonly rule_ref: ProductionReferenceValue; readonly parser_ref: ProductionReferenceValue; readonly files: readonly ArtifactFile[] };
export type ProductionEligibilityContext = ProductionApprovalContext & { readonly composition: Composition; readonly composition_context: CompositionContext; readonly artifact_ref: ArtifactRef; readonly spec: PrintSpec_1_0_0; readonly capture: ContractMap['FulfillmentCapabilitySnapshot']; readonly maximum_nm: string; readonly report: PreflightReport; readonly inspection_policy_ref: ProductionReferenceValue; readonly parser_ref: ProductionReferenceValue; readonly current_approval: { readonly receipt: ApprovalReceipt; readonly status: ApprovalVerificationOutcome['status']; readonly checked_at: UtcTime }; readonly expected_row_scope: ProductionBundle_2_0_0['row_scope']; readonly accepted_domain_pin: ProductionReferenceValue | null; readonly accepted_consumer_pin: ProductionReferenceValue | null };

export declare const productionErrorRegistry: Readonly<Record<ProductionError['code'], { readonly safe_message: string; readonly retryable: boolean }>>;
export declare const productionRequests: Readonly<Record<ProductionOperation, ProductionRequestMap[ProductionOperation]['contract']>>;
export declare function createProductionError(code: ProductionError['code'], context: ProductionErrorContext): ProductionCheck<ProductionError>;
export declare function checkProductionError(value: unknown, scope: ProductionScope): ProductionCheck<ProductionError>;
export declare function validateProductionReference(value: unknown): ProductionCheck<ProductionReferenceValue>;
export declare function adaptProductionRevision(value: unknown): ProductionCheck<ProductionReferenceValue>;
export declare function checkProductionApproval(value: { readonly receipt: ApprovalReceipt; readonly status: ApprovalVerificationOutcome['status']; readonly checked_at: UtcTime }, context: ProductionApprovalContext): ProductionCheck<{ readonly receipt: ApprovalReceipt; readonly status: ApprovalVerificationOutcome['status']; readonly checked_at: UtcTime }>;
export declare function checkProductionAuthority(value: unknown, scope: ProductionScope): ProductionCheck<ProductionHostAuthority>;
export declare function checkProductionHostApproval(value: { readonly receipt: ApprovalReceipt; readonly status: ApprovalVerificationOutcome['status']; readonly checked_at: UtcTime }, context: Pick<ProductionContext, 'scope' | 'authority'>, expectedBinding: ApprovalReceipt['binding'], now: UtcTime): ProductionCheck<{ readonly receipt: ApprovalReceipt; readonly status: ApprovalVerificationOutcome['status']; readonly checked_at: UtcTime }>;
export declare function checkProductionHostRequest<K extends ProductionOperation>(operation: K, value: unknown, context: Pick<ProductionContext, 'scope' | 'authority' | 'policy_version'>, references: ProductionRequestContext['references']): ProductionCheck<ProductionRequestMap[K]>;
export declare function productionReferences(value: unknown): readonly (readonly [string, ProductionReferenceValue])[];
export declare function checkProductionRequest<K extends ProductionOperation>(operation: K, value: unknown, context: ProductionRequestContext): ProductionCheck<ProductionRequestMap[K]>;
export declare function validateProductionResult<K extends ProductionOperation>(operation: K, value: unknown, scope: ProductionScope): ProductionCheck<ProductionResult<ProductionValueMap[K]>>;
export declare function productionSemanticDigest<K extends ProductionOperation>(operation: K, value: ProductionRequestMap[K], pins: ProductionExecutionPins): ProductionCheck<Sha256>;
export declare function compareProductionIdempotency(input: { readonly tenant_id: TenantId; readonly project_id: ProjectId; readonly operation: ProductionOperation; readonly idempotency_key: string; readonly digest: Sha256 }, prior: { readonly tenant_id: TenantId; readonly project_id: ProjectId; readonly operation: ProductionOperation; readonly idempotency_key: string; readonly digest: Sha256 }): ProductionCheck<{ readonly relationship: 'same_input'; readonly replay_authorized: false }>;
export declare function productionContentHash(value: TemplateSpec | Composition | PersonalizationSchema | ProductionPolicy | ProductionRuntime | ProductionResource): Sha256;
export declare function checkTemplateSpec(value: unknown, scope: ProductionScope): ProductionCheck<TemplateSpec>;
export declare function checkPersonalizationSchema(value: unknown, template: TemplateSpec): ProductionCheck<PersonalizationSchema>;
export declare function checkComposition(value: unknown, context: CompositionContext): ProductionCheck<Composition>;
export declare function checkProductionFacts(value: unknown, scope: ProductionScope): ProductionCheck<EventIntelligencePackage>;
export declare function checkProductionValueIntegrity<K extends ContractName>(contract: K, value: unknown, scope: ProductionScope): ProductionCheck<ContractMap[K]>;
export declare function nmToPrivateMillimetres(value: string, maximumNm: string): ProductionCheck<string>;
export declare function privateMillimetresToNm(value: string, maximumNm: string): ProductionCheck<string>;
export declare function translateProductionGeometry(value: unknown, context: { readonly scope: ProductionScope; readonly maximum_nm?: string }): ProductionCheck<{ readonly unit: 'mm'; readonly geometry: Readonly<Record<string, Readonly<Record<string, string>>>>; readonly surfaces: readonly string[]; readonly evidence_mode: 'supplied_values_only' }>;
export declare function compareProductionTemplates(prior: TemplateSpec, current: TemplateSpec, scope: ProductionScope): ProductionCheck<{ readonly changed_fields: readonly string[]; readonly relayout: boolean; readonly reapproval: boolean; readonly eligibility: 'unknown' }>;
export declare function checkPersonalizationPlan(value: unknown, context: PlanContext): ProductionCheck<{ readonly acceptance_policy: 'atomic' | 'allow_partial'; readonly rows: readonly { readonly row_id: string; readonly ordinal: number; readonly input_hash: Sha256; readonly fields: Readonly<Record<string, string>> }[] }>;
export declare function checkRowResult(value: unknown, context: BatchCheckContext): ProductionCheck<RowResult>;
export declare function checkBatchResult(value: unknown, context: BatchCheckContext): ProductionCheck<BatchResult>;
export declare function checkBatchPages(value: readonly BatchResult[], context: BatchCheckContext): ProductionCheck<CompleteBatch>;
export declare function projectBatchPartialFailure(value: readonly BatchResult[], context: PartialProjectionContext): ProductionCheck<{ readonly value: PartialFailure; readonly equivalent: false; readonly loss: readonly string[] }>;
export declare function projectBatchJobStatus(value: readonly BatchResult[], context: JobProjectionContext): ProductionCheck<{ readonly value: JobStatus; readonly equivalent: false; readonly loss: readonly string[] }>;
export declare function checkCsvInput(value: unknown, context: CsvContext): ProductionCheck<{ readonly request: PersonalizeBatchRequest; readonly parser_implemented: false; readonly launch_authorized: false }>;
export declare const productionArchiveLimits: { readonly payloads: 97; readonly zip_entries: 98; readonly outer_descriptors: 100; readonly entry_bytes: 8388608; readonly payload_bytes: 33554432; readonly archive_bytes: 41943040; readonly manifest_bytes: 4194304; readonly detached_bytes: 1048576 };
export declare const productionJsonLimits: { readonly maximum_depth: 64; readonly maximum_tokens: 100000 };
export declare function safeProductionFilename(value: string): boolean;
export type ProductionZipDescriptor = Pick<ArtifactFile, 'filename' | 'byte_size' | 'byte_hash'>;
export declare function verifyProductionZip(value: Uint8Array, expected: readonly ProductionZipDescriptor[]): ProductionCheck<readonly ProductionObservedFile[]>;
export declare function productionBundleContentHash(value: ProductionBundle_2_0_0): Sha256;
export declare function productionPayloadSetHash(value: readonly ArtifactFile[]): Sha256;
export declare function checkProductionFile(value: unknown): ProductionCheck<ArtifactFile>;
export declare function parseProductionCanonicalBytes<K extends ContractName>(contract: K, version: string, bytes: Uint8Array, maximum: number): ProductionCheck<ContractMap[K]>;
export declare function checkProductionBundleV2(value: unknown, scope: ProductionScope): ProductionCheck<ProductionBundle_2_0_0>;
export declare function verifyProductionBundleFiles(value: readonly ProductionObservedFile[], context: ProductionByteContext): ProductionCheck<{ readonly bundle: ProductionBundle_2_0_0; readonly detached: ProductionBundleDetached; readonly integrity: 'passed'; readonly eligibility: 'blocked'; readonly reasons: readonly string[]; readonly evidence_mode: 'byte_verification_only' }>;
export declare function translateProductionBundleV2ToV1(value: unknown): ProductionCheck<never>;
export declare function adaptProductionErrorToV1(value: ProductionError, context: { readonly scope: ProductionScope; readonly envelope: ContractMap['CommonEnvelope']; readonly blocking_condition: ContractMap['ErrorEnvelope']['error']['blocking_condition'] }): ProductionCheck<{ readonly value: ContractMap['ErrorEnvelope']['error']; readonly source_code: ProductionError['code']; readonly equivalent: false; readonly loss: readonly string[] }>;
export declare function checkProductionPreflight(value: unknown, context: ProductionPreflightContext): ProductionCheck<PreflightReport>;
export declare function checkProductionBundleEligibility(value: ProductionBundle_2_0_0, context: ProductionEligibilityContext): ProductionCheck<{ readonly state: 'eligible'; readonly evidence_mode: 'independently_supplied_domain_values'; readonly authority_issued: false }>;
