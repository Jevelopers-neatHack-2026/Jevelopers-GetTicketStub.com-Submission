import type {
	ComposeArtifactRequest,
	Composition,
} from "@jevelopers/shared-contracts";
import {
	checkComposition,
	checkPersonalizationSchema,
	checkProductionHostApproval,
} from "@jevelopers/shared-contracts/production-operations";
import type { CompositionPorts } from "../composition/private-model.js";
import {
	CandidateFailure,
	checked,
	contract,
	requireCandidate,
	same,
} from "./canonical-values.js";
import {
	adaptLayout,
	adaptInput,
	layoutCommitment,
} from "./canonical-layout.js";
import { checkPrintSpecBinding } from "@jevelopers/shared-contracts/capability";
import { requireSpecMapping } from "./canonical-constraints.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import type { CanonicalProfile } from "./canonical-host.js";

export async function currentApproval(
	runtime: CandidateRuntime,
	approval: Composition["asset_uses"][number]["permission_ref"],
	profile: CanonicalProfile,
) {
	const now = runtime.now();
	const receipt = await runtime.resolve(approval);
	const verified = await runtime.context.authorization.verify(
		approval,
		runtime.context.scope,
	);
	if (!verified.ok) throw new CandidateFailure(verified.error.code, "approval");
	const outcome = contract("ApprovalVerificationOutcome", verified.value);
	requireCandidate(
		outcome.receipt_ref !== null &&
			outcome.receipt_ref.id === approval.id &&
			outcome.receipt_ref.content_hash === approval.content_hash &&
			outcome.receipt_ref.revision === approval.revision,
		"APPROVAL_INVALID",
		"approval",
	);
	checked(
		checkProductionHostApproval(
			{ receipt, status: outcome.status, checked_at: outcome.checked_at },
			runtime.context,
			profile.expected_approval_binding,
			now,
		),
		"APPROVAL_INVALID",
	);
	return receipt;
}
export async function resolveInputs(
	runtime: CandidateRuntime,
	binding: ComposeArtifactRequest["binding"],
) {
	requireCandidate(
		binding.repair_policy_ref === null,
		"CAPABILITY_DISABLED",
		"capability",
	);
	for (const [given, expected] of [
		[binding.template_ref, runtime.context.runtime.template_ref],
		[binding.spec_ref, runtime.context.runtime.spec_ref],
		[binding.capability_ref, runtime.context.runtime.capability_ref],
		[binding.approval_ref, runtime.context.runtime.approval_ref],
	] as const)
		requireCandidate(same(given, expected), "HASH_MISMATCH");
	const profile = runtime.profile(binding.template_ref);
	await runtime.resolve(binding.design_ref);
	await runtime.resolve(binding.handoff_ref);
	const templateResult = await runtime.context.templates.resolve(
		binding.template_ref,
		runtime.context.scope,
	);
	if (!templateResult.ok) throw new CandidateFailure(templateResult.error.code);
	const template = contract("TemplateSpec", templateResult.value);
	const layout = adaptLayout(template, profile, runtime.context.scope);
	const spec = await runtime.resolve(binding.spec_ref),
		capture = await runtime.resolve(binding.capability_ref);
	checked(
		checkPrintSpecBinding(spec, capture, {
			trusted_scope: runtime.context.scope,
			now: runtime.now(),
			capture_identity: binding.capability_ref.content_hash,
			content_identity: capture.content_identity,
		}),
		"INCOMPATIBLE_TEMPLATE",
	);
	requireSpecMapping(spec, template, profile);
	const composition = await runtime.resolve(binding.composition_ref);
	requireCandidate(
		same(composition.font_refs, runtime.context.runtime.font_refs) &&
			same(
				composition.policy_refs.output,
				runtime.context.runtime.output_policy_ref,
			),
		"HASH_MISMATCH",
	);
	const personalization = await runtime.resolve(
		template.personalization_schema_ref,
	);
	checked(checkPersonalizationSchema(personalization, template), "ROW_SCHEMA");
	requireCandidate(
		composition.facts_ref.contract === "EventIntelligencePackage",
		"INVALID_INPUT",
	);
	const facts = await runtime.resolve({
		...composition.facts_ref,
		contract: "EventIntelligencePackage",
		schema_version: "1.0.0",
	});
	const factPackage = contract("EventIntelligencePackage", facts);
	requireCandidate(
		factPackage.readiness === "ready" &&
			Date.parse(factPackage.expires_at) > Date.parse(runtime.now()),
		"INVALID_INPUT",
	);
	const factValues: Record<string, string> = {};
	for (const fact of factPackage.facts)
		if (fact.status === "known" && typeof fact.value === "string")
			factValues[fact.key] = fact.value;
	const input = adaptInput(composition, profile, { layout, factValues });
	const bytes: Record<string, Uint8Array> = {};
	const receipt = await currentApproval(runtime, binding.approval_ref, profile);
	for (const asset of composition.asset_uses) {
		const resolved = await runtime.context.assets.resolve(
			asset.asset_ref,
			runtime.context.scope,
		);
		if (!resolved.ok) throw new CandidateFailure(resolved.error.code, "asset");
		bytes[asset.asset_ref.id] = resolved.value;
		await currentApproval(runtime, asset.permission_ref, profile);
		const verified = await runtime.context.assets.verifyPermission(
			asset.asset_ref,
			runtime.context.scope,
		);
		if (!verified.ok) throw new CandidateFailure(verified.error.code, "asset");
		const outcome = contract("ApprovalVerificationOutcome", verified.value);
		requireCandidate(
			outcome.status === "valid" &&
				outcome.checked_at === runtime.now() &&
				outcome.receipt_ref?.id === asset.permission_ref.id &&
				outcome.receipt_ref.content_hash === asset.permission_ref.content_hash,
			"APPROVAL_INVALID",
			"approval",
		);
	}
	requireCandidate(
		runtime.context.runtime.runtime_ref.contract === "ProductionRuntime",
		"INVALID_INPUT",
	);
	checked(
		checkComposition(composition, {
			scope: runtime.context.scope,
			template,
			personalization,
			facts: { reference: composition.facts_ref, package: factPackage },
			expected_references: runtime.state.expectations(composition),
			expected_resolved_layout_commitment: layoutCommitment(
				input,
				profile,
				layout,
			),
			expected_policy_refs: profile.policy_refs,
			expected_font_refs: template.font_refs,
			expected_runtime_ref: {
				...runtime.context.runtime.runtime_ref,
				contract: "ProductionRuntime",
				schema_version: "1.0.0",
			},
			asset_bytes: bytes,
		}),
		"INCOMPATIBLE_TEMPLATE",
	);
	for (const key of [
		"design_ref",
		"handoff_ref",
		"facts_ref",
		"template_ref",
		"spec_ref",
		"capability_ref",
	] as const)
		requireCandidate(same(binding[key], composition[key]), "HASH_MISMATCH");
	requireCandidate(
		same(binding.values, composition.values) &&
			same(binding.asset_refs, composition.asset_uses) &&
			same(binding.formatting_policy_ref, composition.policy_refs.formatting) &&
			same(binding.repair_policy_ref, composition.policy_refs.repair),
		"HASH_MISMATCH",
	);
	const ports: CompositionPorts = {
		...profile.private_permissions,
		resolve: async (_scope, ref, revision) => {
			const mapping = profile.asset_refs.find(
				(asset) =>
					asset.private_ref === ref && asset.private_revision === revision,
			);
			return mapping ? (bytes[mapping.reference.id] ?? null) : null;
		},
		permission: async (request) => {
			await currentApproval(runtime, binding.approval_ref, profile);
			return profile.private_permissions.permission(request);
		},
		compositionPermission: async (request) => {
			await currentApproval(runtime, binding.approval_ref, profile);
			return profile.private_permissions.compositionPermission(request);
		},
	};
	return {
		profile,
		template,
		composition,
		personalization,
		facts: factPackage,
		factValues,
		input,
		layout,
		ports,
		receipt,
		bytes,
		approval_ref: binding.approval_ref,
	};
}
export type CanonicalInputs = Awaited<ReturnType<typeof resolveInputs>>;
