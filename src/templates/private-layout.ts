import { z } from "zod";
import {
	colorSchema,
	contains,
	fingerprint,
	parse,
	positiveSchema,
	rectSchema,
	refSchema,
	requireCore,
	revisionSchema,
} from "../composition/primitives.js";
import type { Digest } from "../composition/primitives.js";

const slotSchema = z
	.object({
		id: refSchema,
		kind: z.enum(["artwork", "text", "overlay", "shape", "guide"]),
		bounds: rectSchema,
		required: z.boolean(),
		minFontMm: positiveSchema,
		maxFontMm: positiveSchema,
		allowedFonts: z.array(refSchema).max(16).readonly(),
		allowCrop: z.boolean(),
		maxRotation: z.number().min(0).max(180),
		fits: z
			.array(z.enum(["contain", "cover", "exact"]))
			.min(1)
			.readonly(),
	})
	.strict()
	.readonly();
export const layoutSchema = z
	.object({
		privateVersion: z.literal(1),
		id: refSchema,
		revision: revisionSchema,
		productRef: refSchema,
		policyRevision: revisionSchema,
		units: z.literal("mm"),
		origin: z.literal("top-left"),
		width: positiveSchema,
		height: positiveSchema,
		orientation: z.enum(["portrait", "landscape", "square"]),
		trim: rectSchema,
		bleed: rectSchema,
		safe: rectSchema,
		minDpi: z.number().positive().max(2400),
		profile: z.enum(["srgb", "icc", "cmyk", "pdf-x"]),
		transparency: z.enum(["allow", "forbid"]),
		exports: z
			.array(z.enum(["svg", "png", "pdf"]))
			.min(1)
			.readonly(),
		fonts: z.array(refSchema).min(1).max(16).readonly(),
		slots: z.array(slotSchema).min(1).max(256).readonly(),
		background: colorSchema,
		includeProofGuides: z.boolean(),
		allowedWarnings: z.array(refSchema).max(64).readonly(),
	})
	.strict()
	.readonly();
export type PrivateLayout = z.infer<typeof layoutSchema>;
export function resolveLayout(value: unknown): PrivateLayout {
	const layout = parse(layoutSchema, value);
	const page = { x: 0, y: 0, width: layout.width, height: layout.height };
	requireCore(
		contains(page, layout.bleed) &&
			contains(layout.bleed, layout.trim) &&
			contains(layout.trim, layout.safe),
		"INVALID_GEOMETRY",
		"layout.rectangles",
	);
	requireCore(
		layout.orientation ===
			(layout.width === layout.height
				? "square"
				: layout.width > layout.height
					? "landscape"
					: "portrait"),
		"INVALID_GEOMETRY",
		"layout.orientation",
	);
	requireCore(
		new Set(layout.slots.map((s) => s.id)).size === layout.slots.length &&
			new Set(layout.fonts).size === layout.fonts.length &&
			new Set(layout.exports).size === layout.exports.length,
		"INVALID_INPUT",
		"layout.duplicates",
	);
	for (const slot of layout.slots)
		requireCore(
			contains(page, slot.bounds) &&
				slot.minFontMm <= slot.maxFontMm &&
				slot.allowedFonts.every((f) => layout.fonts.includes(f)) &&
				(slot.kind !== "text" || slot.allowedFonts.length > 0),
			"INVALID_GEOMETRY",
			`slots.${slot.id}`,
		);
	return layout;
}
export class PrivateLayoutRegistry {
	readonly revisions: readonly {
		readonly layout: PrivateLayout;
		readonly hash: Digest;
	}[];
	constructor(values: readonly unknown[]) {
		this.revisions = Object.freeze(
			values.map((value) => {
				const layout = resolveLayout(value);
				return Object.freeze({ layout, hash: fingerprint(layout) });
			}),
		);
		requireCore(
			new Set(this.revisions.map((r) => `${r.layout.id}/${r.layout.revision}`))
				.size === values.length,
			"REVISION_CONFLICT",
			"registry",
		);
	}
}

// Resolved private constraints supplied by the future canonical adapter; this is not a supplier catalog.
export const constraintsSchema = z
	.object({
		specRef: refSchema,
		revision: revisionSchema,
		sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
		productRef: refSchema,
		width: positiveSchema,
		height: positiveSchema,
		bleed: rectSchema,
		safe: rectSchema,
		minDpi: z.number().positive(),
		profiles: z.array(z.enum(["srgb", "icc", "cmyk", "pdf-x"])).readonly(),
		exports: z.array(z.enum(["svg", "png", "pdf"])).readonly(),
		fonts: z.array(refSchema).readonly(),
		transparency: z.enum(["allow", "forbid"]),
		requiredChecks: z
			.array(z.enum(["dimensions", "content", "fonts", "container", "profile"]))
			.min(1)
			.readonly(),
	})
	.strict()
	.readonly();
export type ResolvedConstraints = z.infer<typeof constraintsSchema>;
export function resolveConstraints(value: unknown): ResolvedConstraints {
	const resolved = parse(constraintsSchema, value);
	requireCore(
		contains(
			{ x: 0, y: 0, width: resolved.width, height: resolved.height },
			resolved.bleed,
		) && contains(resolved.bleed, resolved.safe),
		"INVALID_GEOMETRY",
		"constraints.rectangles",
	);
	return resolved;
}
export function compareTemplateCompatibility(
	source: PrivateLayout,
	target: PrivateLayout,
	constraints: ResolvedConstraints | null,
) {
	const changed = fingerprint(source) !== fingerprint(target);
	const reasons: string[] = [];
	if (!constraints)
		return Object.freeze({
			state: "unknown" as const,
			reasons: ["SPEC_UNKNOWN"],
			relayout: changed,
			reapproval: changed,
		});
	if (target.productRef !== constraints.productRef)
		reasons.push("PRODUCT_MISMATCH");
	if (
		target.width !== constraints.width ||
		target.height !== constraints.height
	)
		reasons.push("DIMENSIONS_MISMATCH");
	if (fingerprint(target.bleed) !== fingerprint(constraints.bleed))
		reasons.push("BLEED_MISMATCH");
	if (!contains(constraints.safe, target.safe)) reasons.push("SAFE_MISMATCH");
	if (target.minDpi < constraints.minDpi) reasons.push("DPI_MISMATCH");
	if (
		!constraints.profiles.includes(target.profile) ||
		target.profile !== "srgb"
	)
		reasons.push("PROFILE_UNSUPPORTED");
	if (!target.exports.every((e) => constraints.exports.includes(e)))
		reasons.push("EXPORT_UNSUPPORTED");
	if (!target.fonts.every((f) => constraints.fonts.includes(f)))
		reasons.push("FONT_UNSUPPORTED");
	if (target.transparency === "allow" && constraints.transparency === "forbid")
		reasons.push("TRANSPARENCY_MISMATCH");
	return Object.freeze({
		state: reasons.length ? ("unsupported" as const) : ("supported" as const),
		reasons: Object.freeze(reasons.sort()),
		relayout: changed,
		reapproval: changed,
	});
}
export const launchRoster = Object.freeze([
	Object.freeze({
		product: "commemorative-ticket",
		state: "pending",
		reason:
			"Required P0: approved layout, supplier specification and roster decision absent",
	}),
	Object.freeze({
		product: "postcard",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
	Object.freeze({
		product: "card",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
	Object.freeze({
		product: "art-print",
		state: "pending",
		reason: "P1 enable/defer decision absent",
	}),
]);
