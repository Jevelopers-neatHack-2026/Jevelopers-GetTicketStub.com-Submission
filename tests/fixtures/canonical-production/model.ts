import type {
	Composition,
	TemplateSpec,
	ComposeArtifactRequest,
	ApprovalReceipt,
	EventIntelligencePackage,
} from "@jevelopers/shared-contracts";
import type { ProductionScope } from "@jevelopers/shared-contracts/production-operations";
import { productionContentHash } from "@jevelopers/shared-contracts/production-operations";
import { contract, contentHash } from "../../../src/api/canonical-values.js";
import {
	adaptLayout,
	adaptInput,
	layoutCommitment,
} from "../../../src/api/canonical-layout.js";
import type { CanonicalProfile } from "../../../src/api/canonical-host.js";
export function syntheticComposition(configuration: {
	readonly rawComposition: Composition;
	readonly request: ComposeArtifactRequest;
	readonly uses: Composition["asset_uses"];
	readonly template: TemplateSpec;
	readonly templateRef: Composition["template_ref"];
	readonly fontRef: TemplateSpec["font_refs"][number];
	readonly specRef: Composition["spec_ref"];
	readonly capabilityRef: Composition["capability_ref"];
	readonly facts: EventIntelligencePackage;
	readonly approval: ApprovalReceipt;
	readonly approvalRef: ComposeArtifactRequest["binding"]["approval_ref"];
	readonly baseProfile: CanonicalProfile;
	readonly scope: ProductionScope;
}): {
	readonly composition: Composition;
	readonly profile: CanonicalProfile;
	readonly request: ComposeArtifactRequest;
} {
	const {
		rawComposition,
		request,
		uses,
		template,
		templateRef,
		fontRef,
		specRef,
		capabilityRef,
		facts,
		approval,
		approvalRef,
		baseProfile,
		scope,
	} = configuration;
	const compositionDraft = {
		...rawComposition,
		template_ref: templateRef,
		spec_ref: specRef,
		capability_ref: capabilityRef,
		asset_uses: uses,
		fact_bindings: [],
		facts_ref: {
			...rawComposition.facts_ref,
			content_hash: facts.package_hash,
		},
		font_refs: [fontRef],
		values: {
			name: { kind: "display" as const, value: "Zoë O’Connor" },
			detail: { kind: "display" as const, value: "Seat 0007 • Serial 000123" },
		},
		slot_bindings: rawComposition.slot_bindings
			.filter((b) => b.slot_id !== "title-slot")
			.map((binding) =>
				binding.source.kind === "asset"
					? {
							...binding,
							source: {
								kind: "asset" as const,
								asset_ref: uses.find(
									(a) =>
										a.asset_ref.id ===
										(binding.source.kind === "asset"
											? binding.source.asset_ref.id
											: ""),
								)?.asset_ref,
							},
						}
					: binding,
			),
	};
	const compositionShape = contract("Composition", {
		...compositionDraft,
		slot_bindings: [
			...compositionDraft.slot_bindings,
			{
				slot_id: "shape-slot",
				source: {
					kind: "policy",
					policy_ref: rawComposition.policy_refs.layout,
				},
			},
			{
				slot_id: "guide-slot",
				source: {
					kind: "policy",
					policy_ref: rawComposition.policy_refs.layout,
				},
			},
		],
	});
	const profile: CanonicalProfile = {
		...baseProfile,
		template_ref: templateRef,
		fonts: [{ reference: fontRef, font: checkedFont(baseProfile) }],
		asset_refs: uses.map((a) => ({
			reference: a.asset_ref,
			private_ref: a.purpose === "artwork" ? "synthetic-art" : "synthetic-logo",
			private_revision: "synthetic-1",
		})),
		policy_refs: compositionShape.policy_refs,
		expected_approval_binding: structuredClone(approval.binding),
		constraints: baseProfile.constraints
			? {
					...baseProfile.constraints,
					sourceDigest: specRef.content_hash.replace(/^sha256:/, ""),
				}
			: null,
	};
	const layout = adaptLayout(template, profile, scope),
		input = adaptInput(compositionShape, profile, { layout, factValues: {} });
	const bound = {
		...compositionShape,
		input_binding_hash: contentHash({
			values: compositionShape.values,
			fact_bindings: [],
			facts_ref: compositionShape.facts_ref,
			formatting: compositionShape.policy_refs.formatting,
		}),
		resolved_layout_commitment: layoutCommitment(input, profile, layout),
	};
	const composition = { ...bound, content_hash: productionContentHash(bound) };
	const composeRequest = {
		...request,
		binding: {
			...request.binding,
			composition_ref: {
				...request.binding.composition_ref,
				content_hash: composition.content_hash,
			},
			template_ref: templateRef,
			spec_ref: specRef,
			capability_ref: capabilityRef,
			facts_ref: composition.facts_ref,
			approval_ref: approvalRef,
			asset_refs: uses,
			values: composition.values,
		},
	};

	return { composition, profile, request: composeRequest };
}
function checkedFont(profile: CanonicalProfile) {
	const value = profile.fonts[0];
	if (!value) throw new Error("missing real fixture font");
	return value.font;
}
