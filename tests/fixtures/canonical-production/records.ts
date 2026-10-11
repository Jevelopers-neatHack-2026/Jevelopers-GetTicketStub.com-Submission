import { ownerFixture } from "./owner.js";
import { syntheticSpecification } from "./spec.js";
import { syntheticComposition } from "./model.js";
import type { ContractMap, Sha256 } from "@jevelopers/shared-contracts";
import type {
	ProductionScope,
	ProductionReferenceValue,
} from "@jevelopers/shared-contracts/production-operations";
import {
	productionContentHash,
	productionReferences,
} from "@jevelopers/shared-contracts/production-operations";
import { commerceContentHash } from "@jevelopers/shared-contracts/commerce-evidence";
import { researchContentHash } from "@jevelopers/shared-contracts/research-creative";
import { sha } from "../../../src/api/canonical-values.js";
import type { CanonicalProfile } from "../../../src/api/canonical-host.js";

export { ownerFixture } from "./owner.js";
export function revisionRef(value: {
	readonly contract:
		| "ProductionResource"
		| "TemplateSpec"
		| "Composition"
		| "PersonalizationSchema";
	readonly id: string;
	readonly content_hash: Sha256;
}) {
	return {
		contract: value.contract,
		schema_version: "1.0.0" as const,
		id: value.id,
		revision: 1,
		content_hash: value.content_hash,
	};
}
export type SyntheticRecords = {
	readonly scope: ProductionScope;
	readonly template: ContractMap["TemplateSpec"];
	readonly composition: ContractMap["Composition"];
	readonly personalization: ContractMap["PersonalizationSchema"];
	readonly facts: ContractMap["EventIntelligencePackage"];
	readonly approval: ContractMap["ApprovalReceipt"];
	readonly profile: CanonicalProfile;
	readonly request: ContractMap["ComposeArtifactRequest"];
	readonly runtime: ContractMap["ProductionExecutionPins"];
	readonly records: Map<string, unknown>;
	readonly references: readonly ProductionReferenceValue[];
};
export async function syntheticRecords(base: {
	readonly art: Uint8Array;
	readonly logo: Uint8Array;
	readonly profile: CanonicalProfile;
}): Promise<SyntheticRecords> {
	const [
		rawTemplate,
		rawComposition,
		rawPolicy,
		rawFacts,
		rawApproval,
		rawSpec,
		rawCapture,
		request,
		rawFont,
		pins,
	] = await Promise.all([
		ownerFixture("TemplateSpec"),
		ownerFixture("Composition"),
		ownerFixture("PersonalizationSchema"),
		ownerFixture("EventIntelligencePackage"),
		ownerFixture("ApprovalReceipt"),
		ownerFixture("PrintSpec"),
		ownerFixture("FulfillmentCapabilitySnapshot"),
		ownerFixture("ComposeArtifactRequest"),
		ownerFixture("ProductionResource"),
		ownerFixture("ProductionExecutionPins"),
	]);
	const scope = {
		tenant_id: rawComposition.tenant_id,
		project_id: rawComposition.project_id,
	};
	const [rawDesign, rawHandoff] = await Promise.all([
		ownerFixture("DesignVersion"),
		ownerFixture("ArtifactHandoffManifest"),
	]);
	const designDraft = { ...rawDesign, ...scope };
	const design = {
		...designDraft,
		design_hash: sha(researchContentHash(designDraft, "design_hash")),
	};
	const handoffDraft = { ...rawHandoff, ...scope };
	const handoff = {
		...handoffDraft,
		manifest_hash: sha(commerceContentHash(handoffDraft, "manifest_hash")),
	};
	const designRef = {
		...rawComposition.design_ref,
		content_hash: design.design_hash,
	};
	const handoffRef = {
		...rawComposition.handoff_ref,
		content_hash: handoff.manifest_hash,
	};
	const font = {
		...rawFont,
		byte_hash: sha(`sha256:${base.profile.fonts[0]?.font.descriptor.digest}`),
	};
	const fontRef = {
		...rawTemplate.font_refs[0],
		...revisionRef({ ...font, content_hash: productionContentHash(font) }),
		contract: "ProductionResource" as const,
	};
	const policy = {
		...rawPolicy,
		fields: rawPolicy.fields.filter((f) => f.source_policy === "row_display"),
	};
	const personalization = {
		...policy,
		content_hash: productionContentHash(policy),
	};
	const { spec, capture } = syntheticSpecification({
		spec: rawSpec,
		capture: rawCapture,
		scope,
	});
	const factsDraft = { ...rawFacts, ...scope };
	const facts = {
		...factsDraft,
		package_hash: sha(researchContentHash(factsDraft, "package_hash")),
	};
	const specRef = { ...rawTemplate.spec_ref, content_hash: spec.spec_identity };
	const capabilityRef = {
		...rawTemplate.capability_ref,
		content_hash: capture.capture_identity,
	};
	const templateDraft = {
		...rawTemplate,
		spec_ref: specRef,
		capability_ref: capabilityRef,
		font_refs: [fontRef],
		personalization_schema_ref: {
			...rawTemplate.personalization_schema_ref,
			content_hash: personalization.content_hash,
		},
		slots: rawTemplate.slots
			.filter((s) => s.slot_id !== "title-slot")
			.map((s) => ({
				...s,
				allowed_font_refs: s.kind === "text" ? [fontRef] : [],
			})),
	};
	const template = {
		...templateDraft,
		content_hash: productionContentHash(templateDraft),
	};
	const templateRef = {
		...rawComposition.template_ref,
		content_hash: template.content_hash,
	};
	const approvalDraft = { ...rawApproval, ...scope };
	const approval = {
		...approvalDraft,
		receipt_hash: sha(commerceContentHash(approvalDraft, "receipt_hash")),
	};
	const approvalRef = {
		...request.binding.approval_ref,
		content_hash: approval.receipt_hash,
	};
	const uses = rawComposition.asset_uses.map((asset) => ({
		...asset,
		asset_ref: {
			...asset.asset_ref,
			content_hash: sha(
				`sha256:${contentDigest(asset.purpose === "artwork" ? base.art : base.logo)}`,
			),
		},
		permission_ref: approvalRef,
	}));
	const {
		composition,
		profile,
		request: composeRequest,
	} = syntheticComposition({
		rawComposition: {
			...rawComposition,
			design_ref: designRef,
			handoff_ref: handoffRef,
		},
		request: {
			...request,
			binding: {
				...request.binding,
				design_ref: designRef,
				handoff_ref: handoffRef,
			},
		},
		uses,
		template,
		templateRef,
		fontRef,
		specRef,
		capabilityRef,
		facts,
		approval,
		approvalRef,
		baseProfile: base.profile,
		scope,
	});
	const runtime = {
		...pins,
		template_ref: templateRef,
		spec_ref: specRef,
		capability_ref: capabilityRef,
		approval_ref: approvalRef,
		font_refs: [fontRef],
	};
	const records = new Map<string, unknown>([
		[design.design_version_id, design],
		[handoff.handoff_id, handoff],
		[template.template_id, template],
		[personalization.schema_id, personalization],
		[composition.composition_id, composition],
		[facts.package_id, facts],
		[approval.approval_id, approval],
		[specRef.id, spec],
		[capabilityRef.id, capture],
	]);
	const references = [
		...productionReferences(composeRequest),
		...productionReferences(composition),
		...productionReferences(template),
		...productionReferences(runtime),
	].map(([, ref]) => ref);
	return {
		scope,
		template,
		composition,
		personalization,
		facts,
		approval,
		profile,
		request: composeRequest,
		runtime,
		records,
		references,
	};
}
import { createHash } from "node:crypto";
function contentDigest(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}
