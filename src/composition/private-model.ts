import { z } from "zod";
import {
	assetBindingSchema,
	resolveAsset,
	checkPermission,
} from "../assets/private-assets.js";
import type {
	AssetPorts,
	ParsedAsset,
	PermissionStage,
} from "../assets/private-assets.js";
import { resolveLayout } from "../templates/private-layout.js";
import type { PrivateLayout } from "../templates/private-layout.js";
import { layoutText, textFieldSchema } from "../typography/private-text.js";
import type { PinnedFont, TextLayout } from "../typography/private-text.js";
import {
	CompositionError,
	colorSchema,
	contains,
	coordinateSchema,
	digest,
	digestSchema,
	escapeXml,
	fingerprint,
	freeze,
	parse,
	precise,
	rectSchema,
	refSchema,
	requireCore,
	revisionSchema,
	scopeSchema,
	transformSchema,
} from "./primitives.js";
import type { Digest, Rect } from "./primitives.js";

const common = {
	id: refSchema,
	slot: refSchema,
	order: z.number().int().min(0).max(10000),
	visible: z.boolean(),
	transform: transformSchema,
	clip: rectSchema.nullable(),
	opacity: coordinateSchema.refine((v) => v >= 0 && v <= 1),
	blend: z.enum(["normal", "multiply", "screen"]),
};
const image = {
	...common,
	asset: assetBindingSchema,
	box: rectSchema,
	fit: z.enum(["contain", "cover", "exact"]),
	anchor: z.enum(["center", "top-left", "bottom-right"]),
	crop: rectSchema.nullable(),
};
export const nodeSchema = z.discriminatedUnion("kind", [
	z
		.object({ ...image, kind: z.literal("artwork") })
		.strict()
		.readonly(),
	z
		.object({ ...image, kind: z.literal("overlay") })
		.strict()
		.readonly(),
	z
		.object({ ...common, kind: z.literal("text"), field: textFieldSchema })
		.strict()
		.readonly(),
	z
		.object({
			...common,
			kind: z.literal("shape"),
			shape: z.enum(["rect", "ellipse"]),
			box: rectSchema,
			fill: colorSchema,
			stroke: colorSchema,
			strokeWidth: coordinateSchema.refine((v) => v >= 0 && v <= 20),
		})
		.strict()
		.readonly(),
	z
		.object({
			...common,
			kind: z.literal("guide"),
			tag: z.enum(["trim", "bleed", "safe"]),
			box: rectSchema,
		})
		.strict()
		.readonly(),
]);
export type LayoutNode = z.infer<typeof nodeSchema>;
const inputSchema = z
	.object({
		privateVersion: z.literal(1),
		scope: scopeSchema,
		designRef: refSchema,
		designDigest: digestSchema,
		factsRef: refSchema,
		factsDigest: digestSchema,
		approvalRef: refSchema,
		approvalDigest: digestSchema,
		inputPolicyRevision: revisionSchema,
		rendererRevision: z.literal("private-svg-v1_fontkit-2.0.4_sax-1.6.1"),
		nodes: z.array(nodeSchema).min(1).max(256).readonly(),
	})
	.strict()
	.readonly();
export type CompositionInput = z.infer<typeof inputSchema>;
export type PrivateModel = {
	readonly input: CompositionInput;
	readonly layout: PrivateLayout;
	readonly fonts: readonly PinnedFont["descriptor"][];
};
export type PrivateArtifact = {
	readonly model: PrivateModel;
	readonly compositionHash: Digest;
	readonly sourceArtworkHashes: readonly Digest[];
	readonly assets: readonly ParsedAsset[];
	readonly fontBytes: readonly PinnedFont[];
	readonly texts: readonly TextLayout[];
	readonly svg: string;
	readonly renderHash: Digest;
	readonly revision: Digest;
	readonly parent: Digest | null;
	readonly receipts: readonly Digest[];
};
export type CompositionPorts = AssetPorts & {
	readonly compositionPermission: (request: {
		readonly model: PrivateModel;
		readonly compositionHash: Digest;
		readonly stage: PermissionStage;
		readonly now: number;
	}) => Promise<unknown>;
};
const compositionDecisionSchema = z
	.object({
		state: z.enum(["allowed", "denied", "unknown", "revoked"]),
		compositionHash: digestSchema,
		approvalRef: refSchema,
		approvalDigest: digestSchema,
		validUntil: z.number().int().nonnegative(),
	})
	.strict()
	.readonly();
export function requirePhysicalTextSize(
	node: Extract<LayoutNode, { kind: "text" }>,
	minMm: number,
	maxMm: number,
): number {
	requireCore(
		node.transform.scaleX === node.transform.scaleY,
		"INVALID_INPUT",
		`nodes.${node.id}.textScale`,
	);
	const physicalMm = node.field.sizeMm * node.transform.scaleY;
	requireCore(
		physicalMm >= minMm && physicalMm <= maxMm,
		"INVALID_INPUT",
		`nodes.${node.id}.physicalTextSize`,
	);
	return physicalMm;
}
function requireImageScale(
	node: Extract<LayoutNode, { kind: "artwork" | "overlay" }>,
): void {
	requireCore(
		node.transform.scaleX === node.transform.scaleY,
		"INVALID_INPUT",
		`nodes.${node.id}.imageScale`,
	);
}
export async function recheckPermissions(
	artifact: PrivateArtifact,
	ports: CompositionPorts,
	stage: PermissionStage,
	now: number,
): Promise<void> {
	for (const asset of artifact.assets)
		await checkPermission(
			asset.binding,
			ports,
			stage,
			now,
			artifact.compositionHash,
		);
	try {
		const decision = parse(
			compositionDecisionSchema,
			await ports.compositionPermission({
				model: artifact.model,
				compositionHash: artifact.compositionHash,
				stage,
				now,
			}),
		);
		requireCore(
			decision.state === "allowed" &&
				decision.compositionHash === artifact.compositionHash &&
				decision.approvalRef === artifact.model.input.approvalRef &&
				decision.approvalDigest === artifact.model.input.approvalDigest &&
				decision.validUntil > now,
			"PERMISSION_BLOCKED",
			"composition.permission",
		);
	} catch (error) {
		if (error instanceof Error)
			throw new CompositionError(
				"PERMISSION_BLOCKED",
				"composition.permission",
			);
		throw error;
	}
}

export function parseComposition(
	value: unknown,
	layout: PrivateLayout,
): CompositionInput {
	const input = parse(inputSchema, value);
	requireCore(
		new Set(input.nodes.map((n) => n.id)).size === input.nodes.length &&
			new Set(input.nodes.map((n) => n.order)).size === input.nodes.length,
		"INVALID_INPUT",
		"nodes.duplicates",
	);
	const fields = input.nodes
		.filter((n) => n.kind === "text")
		.map((n) => `${n.field.rowRef}/${n.field.fieldRef}`);
	requireCore(
		new Set(fields).size === fields.length,
		"INVALID_INPUT",
		"fields.duplicates",
	);
	for (const node of input.nodes) {
		const slot = layout.slots.find((s) => s.id === node.slot);
		requireCore(
			slot !== undefined &&
				slot.kind === node.kind &&
				Math.abs(node.transform.rotation) <= slot.maxRotation,
			"INVALID_INPUT",
			`nodes.${node.id}.slot`,
		);
		if (node.kind === "text") {
			requirePhysicalTextSize(node, slot.minFontMm, slot.maxFontMm);
			requireCore(
				node.field.sizeMm >= slot.minFontMm &&
					node.field.sizeMm <= slot.maxFontMm &&
					node.field.fontOrder.every((f) => slot.allowedFonts.includes(f)) &&
					contains(slot.bounds, node.field.bounds) &&
					(!slot.required || node.field.required),
				"INVALID_INPUT",
				`nodes.${node.id}.textPolicy`,
			);
		}
		if (node.kind === "artwork" || node.kind === "overlay") {
			requireImageScale(node);
			requireCore(
				node.asset.purpose === node.kind &&
					slot.fits.includes(node.fit) &&
					(node.crop === null || slot.allowCrop) &&
					(node.fit !== "cover" || slot.allowCrop),
				"INVALID_INPUT",
				`nodes.${node.id}.placementPolicy`,
			);
		}
	}
	return freeze({
		...input,
		nodes: [...input.nodes].sort((a, b) => a.order - b.order),
	});
}
export function imagePlacement(
	node: Extract<LayoutNode, { kind: "artwork" | "overlay" }>,
	asset: ParsedAsset,
): Rect {
	requireImageScale(node);
	const source = node.crop ?? {
		x: 0,
		y: 0,
		width: asset.width,
		height: asset.height,
	};
	requireCore(
		contains({ x: 0, y: 0, width: asset.width, height: asset.height }, source),
		"INVALID_GEOMETRY",
		`nodes.${node.id}.crop`,
	);
	const ratio = source.width / source.height;
	if (node.fit === "exact") {
		requireCore(
			Math.abs(node.box.width / node.box.height - ratio) < 1e-6,
			"INVALID_GEOMETRY",
			`nodes.${node.id}.aspect`,
		);
		return node.box;
	}
	const scale =
		node.fit === "contain"
			? Math.min(node.box.width / source.width, node.box.height / source.height)
			: Math.max(
					node.box.width / source.width,
					node.box.height / source.height,
				);
	const width = source.width * scale,
		height = source.height * scale;
	requireCore(
		precise(width) > 0 && precise(height) > 0,
		"INVALID_GEOMETRY",
		`nodes.${node.id}.precision`,
	);
	const offset =
		node.anchor === "center" ? 0.5 : node.anchor === "top-left" ? 0 : 1;
	return {
		x: precise(node.box.x + (node.box.width - width) * offset),
		y: precise(node.box.y + (node.box.height - height) * offset),
		width: precise(width),
		height: precise(height),
	};
}
function transformString(node: LayoutNode): string {
	const t = node.transform;
	return `translate(${t.x} ${t.y}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY})`;
}
function boxAttributes(box: Rect): string {
	return `x="${precise(box.x)}" y="${precise(box.y)}" width="${precise(box.width)}" height="${precise(box.height)}"`;
}
export function renderSvgWithFonts(
	model: PrivateModel,
	assets: readonly ParsedAsset[],
	texts: readonly TextLayout[],
	fonts: readonly PinnedFont[],
	proof = false,
): string {
	const { layout } = model;
	const styles = fonts
		.map(
			(f) =>
				`@font-face{font-family:'font-${f.descriptor.digest}';src:url(data:${f.descriptor.format === "woff2" ? "font/woff2" : "font/ttf"};base64,${f.base64}) format('${f.descriptor.format}');font-weight:400;font-style:normal;font-display:block}`,
		)
		.join("");
	const layers: string[] = [],
		clips: string[] = [];
	for (const node of model.input.nodes) {
		if (
			!node.visible ||
			(node.kind === "guide" && (!proof || !layout.includeProofGuides))
		)
			continue;
		const clipId = `clip-${node.id}`;
		if (node.clip)
			clips.push(
				`<clipPath id="${clipId}"><rect ${boxAttributes(node.clip)}/></clipPath>`,
			);
		let body: string;
		switch (node.kind) {
			case "artwork":
			case "overlay": {
				const asset = assets.find(
					(a) =>
						a.binding.ref === node.asset.ref &&
						a.binding.version === node.asset.version &&
						a.binding.digest === node.asset.digest,
				);
				requireCore(
					asset !== undefined,
					"ASSET_MISSING",
					`nodes.${node.id}.asset`,
				);
				const placement = imagePlacement(node, asset);
				const crop = node.crop ?? {
					x: 0,
					y: 0,
					width: asset.width,
					height: asset.height,
				};
				body = `<svg ${boxAttributes(placement)} viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" overflow="hidden"><image x="0" y="0" width="${asset.width}" height="${asset.height}" href="data:${asset.mime};base64,${asset.renderBase64}"/></svg>`;
				if (node.fit === "cover")
					body = `<svg ${boxAttributes(node.box)} viewBox="${node.box.x} ${node.box.y} ${node.box.width} ${node.box.height}" overflow="hidden">${body}</svg>`;
				break;
			}
			case "text": {
				const text = texts.find(
					(t) =>
						t.field.fieldRef === node.field.fieldRef &&
						t.field.rowRef === node.field.rowRef,
				);
				requireCore(
					text !== undefined,
					"RENDER_INTEGRITY",
					`nodes.${node.id}.text`,
				);
				body =
					text.state === "blocked"
						? ""
						: text.lines
								.map((line, index) =>
									line.value === ""
										? ""
										: `<text id="text-${node.id}-${index}" data-field="${node.field.fieldRef}" data-row="${node.field.rowRef}" x="${precise(line.x + (node.field.direction === "rtl" ? line.advance : 0))}" y="${line.baseline}" font-family="font-${text.font.digest}" font-size="${node.field.sizeMm}" fill="${node.field.color}" direction="${node.field.direction}" text-anchor="start" xml:space="preserve" style="white-space:pre;unicode-bidi:isolate;text-rendering:geometricPrecision">${escapeXml(line.value)}</text>`,
								)
								.join("");
				break;
			}
			case "shape":
				body =
					node.shape === "rect"
						? `<rect ${boxAttributes(node.box)} fill="${node.fill}" stroke="${node.stroke}" stroke-width="${node.strokeWidth}"/>`
						: `<ellipse cx="${precise(node.box.x + node.box.width / 2)}" cy="${precise(node.box.y + node.box.height / 2)}" rx="${precise(node.box.width / 2)}" ry="${precise(node.box.height / 2)}" fill="${node.fill}" stroke="${node.stroke}" stroke-width="${node.strokeWidth}"/>`;
				break;
			case "guide":
				body = `<rect data-guide="${node.tag}" ${boxAttributes(node.box)} fill="none" stroke="#ff00ff" stroke-width="0.1"/>`;
				break;
			default: {
				const unreachable: never = node;
				return unreachable;
			}
		}
		layers.push(
			`<g id="node-${node.id}" transform="${transformString(node)}" opacity="${node.opacity}" style="mix-blend-mode:${node.blend}"${node.clip ? ` clip-path="url(#${clipId})"` : ""}>${body}</g>`,
		);
	}
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}mm" height="${layout.height}mm" viewBox="0 0 ${layout.width} ${layout.height}"><defs><style>${styles}</style>${clips.join("")}</defs><rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${layout.background}"/>${layers.join("")}</svg>`;
}
export async function composeArtifact(
	value: unknown,
	layoutValue: unknown,
	fonts: readonly PinnedFont[],
	ports: CompositionPorts,
	now: number,
): Promise<PrivateArtifact> {
	const layout = resolveLayout(layoutValue),
		input = parseComposition(value, layout);
	requireCore(
		new Set(fonts.map((f) => f.descriptor.ref)).size === fonts.length &&
			fonts.every((f) => layout.fonts.includes(f.descriptor.ref)),
		"INVALID_INPUT",
		"fonts.policy",
	);
	const orderedFonts = [...fonts].sort((a, b) =>
		a.descriptor.ref < b.descriptor.ref
			? -1
			: a.descriptor.ref > b.descriptor.ref
				? 1
				: 0,
	);
	for (const font of orderedFonts)
		requireCore(
			digest(Buffer.from(font.base64, "base64")) === font.descriptor.digest,
			"FONT_INVALID",
			`fonts.${font.descriptor.ref}.hash`,
		);
	const model = freeze({
			input,
			layout,
			fonts: orderedFonts.map((f) => f.descriptor),
		}),
		compositionHash = fingerprint(model);
	const assets: ParsedAsset[] = [];
	for (const node of input.nodes)
		if (node.kind === "artwork" || node.kind === "overlay") {
			if (
				!assets.some((a) => fingerprint(a.binding) === fingerprint(node.asset))
			)
				assets.push(await resolveAsset(node.asset, input.scope, ports, now));
		}
	const texts = input.nodes
		.filter((n) => n.kind === "text")
		.map((n) => layoutText(n.field, orderedFonts));
	const svg = renderSvgWithFonts(model, assets, texts, orderedFonts),
		renderHash = digest(svg);
	const artifact = freeze({
		model,
		compositionHash,
		sourceArtworkHashes: assets
			.filter((a) => a.binding.purpose === "artwork")
			.map((a) => a.binding.digest),
		assets,
		fontBytes: orderedFonts,
		texts,
		svg,
		renderHash,
		revision: fingerprint({ compositionHash, renderHash }),
		parent: null,
		receipts: [],
	});
	await recheckPermissions(artifact, ports, "compose", now);
	return artifact;
}
