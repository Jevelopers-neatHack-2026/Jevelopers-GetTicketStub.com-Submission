import { mm } from "./canonical-geometry.js";
import type { Composition, TemplateSpec } from "@jevelopers/shared-contracts";
import { checkTemplateSpec } from "@jevelopers/shared-contracts/production-operations";
import type { ProductionScope } from "@jevelopers/shared-contracts/production-operations";
import { resolveLayout } from "../templates/private-layout.js";
import { parseComposition } from "../composition/private-model.js";
import type {
	CompositionInput,
	LayoutNode,
} from "../composition/private-model.js";
import { digest, fingerprint, refSchema } from "../composition/primitives.js";
import type { Rect } from "../composition/primitives.js";
import type { CanonicalProfile } from "./canonical-host.js";
import {
	checked,
	contentHash,
	requireCandidate,
	same,
	sha,
	unreachable,
} from "./canonical-values.js";

export { mm, nm } from "./canonical-geometry.js";
function rect(value: TemplateSpec["coordinate_geometry"]["trim"]): Rect {
	return {
		x: mm(value.x_nm),
		y: mm(value.y_nm),
		width: mm(value.width_nm),
		height: mm(value.height_nm),
	};
}
export function adaptLayout(
	template: TemplateSpec,
	profile: CanonicalProfile,
	scope: ProductionScope,
) {
	checked(checkTemplateSpec(template, scope), "INCOMPATIBLE_TEMPLATE");
	requireCandidate(
		same(profile.template_ref, {
			contract: template.contract,
			schema_version: template.schema_version,
			id: template.template_id,
			revision: template.revision,
			content_hash: template.content_hash,
		}),
		"HASH_MISMATCH",
	);
	const fontRef = (ref: TemplateSpec["font_refs"][number]) => {
		const mapped = profile.fonts.find((f) => same(f.reference, ref));
		requireCandidate(mapped !== undefined, "INCOMPATIBLE_TEMPLATE", "template");
		return mapped.font.descriptor.ref;
	};
	const g = template.coordinate_geometry;
	return resolveLayout({
		...profile.layout,
		width: mm(g.canvas.width_nm),
		height: mm(g.canvas.height_nm),
		trim: rect(g.trim),
		bleed: rect(g.bleed),
		safe: rect(g.safe),
		orientation: template.orientation,
		minDpi: template.minimum_effective_dpi,
		exports: template.export_formats,
		fonts: template.font_refs.map(fontRef),
		slots: template.slots.map((slot) => {
			const id = profile.slot_ids[slot.slot_id];
			requireCandidate(id !== undefined, "INCOMPATIBLE_TEMPLATE", "template");
			return {
				id,
				kind: slot.kind,
				bounds: rect(slot.bounds),
				required: slot.required,
				minFontMm: slot.font_bounds_nm ? mm(slot.font_bounds_nm.minimum) : 1,
				maxFontMm: slot.font_bounds_nm ? mm(slot.font_bounds_nm.maximum) : 1,
				allowedFonts: slot.allowed_font_refs.map(fontRef),
				allowCrop: slot.allow_crop,
				maxRotation: slot.maximum_rotation_degrees,
				fits: slot.allowed_fits,
			};
		}),
	});
}
export function adaptInput(
	composition: Composition,
	profile: CanonicalProfile,
	render: {
		readonly layout: ReturnType<typeof adaptLayout>;
		readonly factValues: Readonly<Record<string, string>>;
		readonly rowId?: string;
	},
): CompositionInput {
	const { layout, factValues, rowId } = render;
	requireCandidate(
		composition.barcode.state === "absent",
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	const nodes: LayoutNode[] = [];
	for (const binding of composition.slot_bindings) {
		const slot = profile.slot_ids[binding.slot_id];
		const base = profile.input.nodes.find((node) => node.slot === slot);
		requireCandidate(base !== undefined, "INCOMPATIBLE_TEMPLATE", "template");
		switch (binding.source.kind) {
			case "asset": {
				requireCandidate(
					base.kind === "artwork" || base.kind === "overlay",
					"INCOMPATIBLE_TEMPLATE",
				);
				const use = composition.asset_uses.find((use) =>
					same(
						use.asset_ref,
						binding.source.kind === "asset" ? binding.source.asset_ref : null,
					),
				);
				const mapped = profile.asset_refs.find((a) =>
					same(
						a.reference,
						binding.source.kind === "asset" ? binding.source.asset_ref : null,
					),
				);
				requireCandidate(
					use !== undefined &&
						mapped !== undefined &&
						use.normalization_policy_ref === null,
					"ASSET_MISSING",
					"asset",
				);
				requireCandidate(
					base.asset.ref === mapped.private_ref &&
						base.asset.version === mapped.private_revision &&
						sha(`sha256:${base.asset.digest}`) === use.asset_ref.content_hash &&
						base.asset.purpose === use.purpose,
					"HASH_MISMATCH",
					"asset",
				);
				nodes.push(base);
				break;
			}
			case "value":
			case "fact": {
				requireCandidate(base.kind === "text", "INCOMPATIBLE_TEMPLATE");
				const value =
					binding.source.kind === "value"
						? composition.values[binding.source.field_id]
						: {
								kind: "display" as const,
								value: factValues[binding.source.fact_key],
							};
				requireCandidate(
					value !== undefined &&
						value.kind === "display" &&
						typeof value.value === "string",
					"ROW_SCHEMA",
					"row",
				);
				if (binding.source.kind === "value")
					requireCandidate(
						profile.field_ids[binding.source.field_id] === base.field.fieldRef,
						"ROW_SCHEMA",
						"row",
					);
				nodes.push({
					...base,
					field: {
						...base.field,
						source: { kind: "display", value: value.value },
						sourceDigest: digest(value.value),
						...(rowId === undefined ? {} : { rowRef: refSchema.parse(rowId) }),
					},
				});
				break;
			}
			case "policy":
				requireCandidate(
					base.kind === "shape" || base.kind === "guide",
					"INCOMPATIBLE_TEMPLATE",
				);
				nodes.push(base);
				break;
			default:
				unreachable(binding.source);
		}
	}
	return parseComposition({ ...profile.input, nodes }, layout);
}
export function layoutCommitment(
	input: CompositionInput,
	profile: CanonicalProfile,
	layout: ReturnType<typeof adaptLayout>,
) {
	return contentHash({
		input,
		layout,
		fonts: profile.fonts.map((f) => ({
			reference: f.reference,
			descriptor: f.font.descriptor,
			byte_hash: sha(`sha256:${digest(Buffer.from(f.font.base64, "base64"))}`),
		})),
		output: profile.output_policy,
		constraints: profile.constraints,
		mapping: {
			template: profile.template_ref,
			assets: profile.asset_refs,
			slots: profile.slot_ids,
			fields: profile.field_ids,
		},
	});
}
export function profileCommitment(profile: CanonicalProfile) {
	return fingerprint({
		layout: profile.layout,
		input: profile.input,
		fonts: profile.fonts,
		assets: profile.asset_refs,
		slots: profile.slot_ids,
		fields: profile.field_ids,
		constraints: profile.constraints,
		output: profile.output_policy,
		policies: profile.policy_refs,
		approval: profile.expected_approval_binding,
	});
}
