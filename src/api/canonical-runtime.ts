import { randomUUID } from "node:crypto";
import { z } from "zod";
import { classify, productionFailure } from "./canonical-error.js";
import { validatePrimitive } from "@jevelopers/shared-contracts";
import type {
	ContractMap,
	ContractName,
	Sha256,
	UtcTime,
} from "@jevelopers/shared-contracts";
import {
	checkProductionHostRequest,
	checkProductionValueIntegrity,
	productionSemanticDigest,
	productionRequests,
} from "@jevelopers/shared-contracts/production-operations";
import type {
	ProductionContext,
	ProductionOperation,
	ProductionRequestMap,
	ProductionResult,
	ProductionReferenceValue,
} from "@jevelopers/shared-contracts/production-operations";
import {
	bindCanonicalContext,
	snapshotCanonicalProfiles,
} from "./canonical-context.js";
import { CanonicalState } from "../storage/canonical-state.js";
import type { CanonicalHost, CanonicalProfile } from "./canonical-host.js";
import {
	CandidateFailure,
	checked,
	contract,
	requireCandidate,
	same,
	jsonBytes,
} from "./canonical-values.js";
import { profileCommitment } from "./canonical-layout.js";

const identityKeys = {
	DesignVersion: ["design_version_id", "revision", "design_hash"],
	ArtifactHandoffManifest: ["handoff_id", "revision", "manifest_hash"],
	TemplateSpec: ["template_id", "revision", "content_hash"],
	Composition: ["composition_id", "revision", "content_hash"],
	PersonalizationSchema: ["schema_id", "revision", "content_hash"],
	EventIntelligencePackage: ["package_id", "package_version", "package_hash"],
	ApprovalReceipt: ["approval_id", "", "receipt_hash"],
	PrintSpec: ["", "", "spec_identity"],
	FulfillmentCapabilitySnapshot: ["", "", "capture_identity"],
	ProductionPolicy: ["id", "revision", "content_hash"],
	ProductionRuntime: ["id", "revision", "content_hash"],
	ProductionResource: ["id", "revision", "content_hash"],
} as const satisfies Readonly<
	Partial<Record<ContractName, readonly [string, string, string]>>
>;
export class CandidateRuntime {
	readonly context: ProductionContext;
	readonly state: CanonicalState;
	readonly profiles: readonly CanonicalProfile[];
	constructor(readonly host: CanonicalHost) {
		this.context = bindCanonicalContext(host.context);
		this.state = new CanonicalState(host.db, host.private_scope);
		this.profiles = snapshotCanonicalProfiles(host.profiles);
		for (const ref of host.external_references) this.state.register(ref);
		for (const p of this.profiles)
			this.state.put(
				`profile:${p.template_ref.id}:${p.template_ref.revision}`,
				{
					template: p.template_ref,
					commitment: profileCommitment(p),
					canonical_scope: this.context.scope,
					private_scope: host.private_scope,
				},
			);
	}
	now(): UtcTime {
		const value = checked(
			validatePrimitive("UtcTime", this.context.clock.now()),
		);
		requireCandidate(Number.isFinite(Date.parse(value)), "INVALID_INPUT");
		return value;
	}
	async entry<K extends ProductionOperation, T>(
		invocation: {
			readonly context: ProductionContext;
			readonly operation: K;
			readonly request: ProductionRequestMap[K];
		},
		work: (request: ProductionRequestMap[K]) => Promise<T>,
	): Promise<ProductionResult<T>> {
		const { context: ctx, operation, request } = invocation;
		let entered = false;
		try {
			requireCandidate(ctx === this.context, "FORBIDDEN", "access");
			this.now();
			checked(
				checkProductionValueIntegrity(
					"ProductionExecutionPins",
					this.context.runtime,
					this.context.scope,
				),
			);
			contract(productionRequests[operation], request);
			const parsed = checked(
				checkProductionHostRequest(
					operation,
					request,
					this.context,
					this.state.expectations(request),
				),
			);
			requireCandidate(
				await this.host.access(operation),
				"FORBIDDEN",
				"access",
			);
			requireCandidate(
				this.context.environment !== "production",
				"INCOMPATIBLE_TEMPLATE",
				"template",
			);
			entered =
				operation === "composeArtifact" ||
				operation === "personalizeArtifactBatch" ||
				operation === "exportArtifactBundle";
			return { ok: true, value: await work(parsed) };
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			const failure = classify(error);
			const correlation = validatePrimitive(
				"CorrelationId",
				request?.correlation_id,
			);
			const correlationId = correlation.ok
				? correlation.value
				: checked(validatePrimitive("CorrelationId", randomUUID()));
			return {
				ok: false,
				error: productionFailure(this, {
					operation,
					correlation_id: correlationId,
					code: failure.code,
					blocking_condition: failure.condition,
					side_effects: entered ? "possible" : "none",
					usage_state: entered ? "incomplete" : "complete",
				}),
			};
		}
	}
	profile(ref: ProductionReferenceValue): CanonicalProfile {
		const value = this.profiles.find((p) => same(p.template_ref, ref));
		requireCandidate(value !== undefined, "INCOMPATIBLE_TEMPLATE", "template");
		return value;
	}
	async resolve<K extends keyof typeof identityKeys>(
		ref: Extract<
			ProductionReferenceValue,
			{ readonly schema_version: "1.0.0" }
		> & { readonly contract: K },
	): Promise<ContractMap[K]> {
		requireCandidate(
			ref.schema_version === "1.0.0",
			"UNSUPPORTED_VERSION",
			"version",
		);
		const result = await this.context.references.resolve(
			{
				contract: ref.contract,
				schema_version: "1.0.0",
				id: ref.id,
				revision: ref.revision,
				content_hash: ref.content_hash,
			},
			this.context.scope,
		);
		if (!result.ok)
			throw new CandidateFailure(
				result.error.code,
				result.error.blocking_condition,
			);
		const value = checked(
			checkProductionValueIntegrity(
				ref.contract,
				result.value,
				this.context.scope,
			),
		);
		const keys = identityKeys[ref.contract];
		requireCandidate(keys !== undefined, "UNSUPPORTED_VERSION", "version");
		const record = z.record(z.string(), z.unknown()).parse(value);
		const [id, revision, digest] = keys;
		requireCandidate(
			(id === "" || record[id] === ref.id) &&
				(revision === "" || record[revision] === ref.revision) &&
				record[digest] === ref.content_hash,
			"HASH_MISMATCH",
			"integrity",
		);
		return value;
	}
	semantic<K extends ProductionOperation>(
		operation: K,
		request: ProductionRequestMap[K],
	): Sha256 {
		return checked(
			productionSemanticDigest(operation, request, this.context.runtime),
		);
	}
	bind<
		K extends
			| "composeArtifact"
			| "exportArtifactBundle"
			| "personalizeArtifactBatch",
	>(operation: K, request: ProductionRequestMap[K]) {
		return this.state.bind(
			operation,
			request.idempotency_key,
			jsonBytes({ digest: this.semantic(operation, request) }),
		);
	}
	registerValue(value: unknown): void {
		for (const [, ref] of importReferences(value)) this.state.register(ref);
	}
}
import { productionReferences as importReferences } from "@jevelopers/shared-contracts/production-operations";
