import type {
	PrintSpec_1_0_0,
	TemplateSpec,
} from "@jevelopers/shared-contracts";
import type { CanonicalProfile } from "./canonical-host.js";
import { requireCandidate } from "./canonical-values.js";
import { mm } from "./canonical-layout.js";

export function requireSpecMapping(
	spec: PrintSpec_1_0_0,
	template: TemplateSpec,
	profile: CanonicalProfile,
): void {
	const c = spec.constraints,
		g = template.coordinate_geometry;
	requireCandidate(
		c.geometry.trim.state === "known" &&
			c.geometry.printable.state === "known" &&
			c.inset_geometry_basis.state === "known" &&
			c.minimum_bleed.state === "known" &&
			c.minimum_safe_area.state === "known",
		"INCOMPATIBLE_TEMPLATE",
		"template",
	);
	requireCandidate(
		c.inset_geometry_basis.value === "trim" &&
			c.surfaces.state === "known" &&
			c.surfaces.value.length === 1 &&
			c.surfaces.value[0] === "front",
		"UNSUPPORTED_PRODUCT",
		"product",
	);
	requireCandidate(
		c.geometry.trim.value.width_nm === g.trim.width_nm &&
			c.geometry.trim.value.height_nm === g.trim.height_nm &&
			c.geometry.printable.value.width_nm === g.canvas.width_nm &&
			c.geometry.printable.value.height_nm === g.canvas.height_nm,
		"INCOMPATIBLE_TEMPLATE",
		"template",
	);
	const bleed = c.minimum_bleed.value,
		safe = c.minimum_safe_area.value;
	requireCandidate(
		BigInt(g.trim.x_nm) - BigInt(g.bleed.x_nm) >= BigInt(bleed.left_nm) &&
			BigInt(g.trim.y_nm) - BigInt(g.bleed.y_nm) >= BigInt(bleed.top_nm) &&
			BigInt(g.bleed.x_nm) +
				BigInt(g.bleed.width_nm) -
				BigInt(g.trim.x_nm) -
				BigInt(g.trim.width_nm) >=
				BigInt(bleed.right_nm) &&
			BigInt(g.bleed.y_nm) +
				BigInt(g.bleed.height_nm) -
				BigInt(g.trim.y_nm) -
				BigInt(g.trim.height_nm) >=
				BigInt(bleed.bottom_nm),
		"INCOMPATIBLE_TEMPLATE",
		"template",
	);
	requireCandidate(
		BigInt(g.safe.x_nm) - BigInt(g.trim.x_nm) >= BigInt(safe.left_nm) &&
			BigInt(g.safe.y_nm) - BigInt(g.trim.y_nm) >= BigInt(safe.top_nm) &&
			BigInt(g.trim.x_nm) +
				BigInt(g.trim.width_nm) -
				BigInt(g.safe.x_nm) -
				BigInt(g.safe.width_nm) >=
				BigInt(safe.right_nm) &&
			BigInt(g.trim.y_nm) +
				BigInt(g.trim.height_nm) -
				BigInt(g.safe.y_nm) -
				BigInt(g.safe.height_nm) >=
				BigInt(safe.bottom_nm),
		"INCOMPATIBLE_TEMPLATE",
		"template",
	);
	requireCandidate(
		c.color.state === "known" &&
			c.color.value.spaces.includes("sRGB") &&
			c.color.value.profiles.includes("srgb") &&
			profile.layout.profile === "srgb",
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	requireCandidate(
		c.minimum_resolution_dpi.state === "known" &&
			profile.output_policy.dpi >= c.minimum_resolution_dpi.value &&
			template.minimum_effective_dpi >= c.minimum_resolution_dpi.value,
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	requireCandidate(
		c.files.state === "known" &&
			template.export_formats.every(
				(format) =>
					c.files.state === "known" &&
					c.files.value.mime_types.includes(
						format === "svg"
							? "image/svg+xml"
							: format === "png"
								? "image/png"
								: "application/pdf",
					),
			),
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	requireCandidate(
		profile.constraints !== null &&
			profile.constraints.sourceDigest ===
				spec.spec_identity.replace(/^sha256:/, "") &&
			profile.constraints.width === mm(g.canvas.width_nm) &&
			profile.constraints.height === mm(g.canvas.height_nm),
		"HASH_MISMATCH",
		"integrity",
	);
}
