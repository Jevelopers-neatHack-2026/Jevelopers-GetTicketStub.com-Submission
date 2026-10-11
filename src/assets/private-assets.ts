import { PNG } from "pngjs";
import { crc32, inflateSync } from "node:zlib";
import sax from "sax";
import { z } from "zod";
import {
	CompositionError,
	digest,
	digestSchema,
	escapeXml,
	fingerprint,
	freeze,
	parse,
	positiveSchema,
	refSchema,
	requireCore,
	revisionSchema,
	scopeSchema,
} from "../composition/primitives.js";
import type { Digest, Scope } from "../composition/primitives.js";

export const assetBindingSchema = z
	.object({
		ref: refSchema,
		version: revisionSchema,
		digest: digestSchema,
		permissionRef: refSchema,
		scope: scopeSchema,
		purpose: z.enum(["artwork", "overlay"]),
		normalization: z.enum(["none", "safe-container-v1"]),
	})
	.strict()
	.readonly();
export type AssetBinding = z.infer<typeof assetBindingSchema>;
export type PermissionStage =
	| "compose"
	| "inspect"
	| "repair"
	| "export"
	| "handoff";
const decisionSchema = z
	.object({
		state: z.enum(["allowed", "denied", "revoked", "unknown"]),
		ref: refSchema,
		version: revisionSchema,
		digest: digestSchema,
		permissionRef: refSchema,
		scope: scopeSchema,
		purpose: z.enum(["artwork", "overlay"]),
		validUntil: z.number().int().nonnegative(),
		appliesTo: z.union([digestSchema, z.literal("source")]),
	})
	.strict()
	.readonly();
export type PermissionDecision = z.infer<typeof decisionSchema>;
export type AssetPorts = {
	readonly resolve: (
		scope: Scope,
		ref: AssetBinding["ref"],
		version: string,
	) => Promise<Uint8Array | null>;
	readonly permission: (request: {
		readonly binding: AssetBinding;
		readonly stage: PermissionStage;
		readonly now: number;
		readonly composition: Digest | null;
	}) => Promise<unknown>;
};
export async function checkPermission(
	binding: AssetBinding,
	ports: AssetPorts,
	stage: PermissionStage,
	now: number,
	composition: Digest | null,
): Promise<PermissionDecision> {
	requireCore(
		Number.isSafeInteger(now) && now >= 0,
		"INVALID_INPUT",
		"permission.clock",
	);
	try {
		const decision = parse(
			decisionSchema,
			await ports.permission({ binding, stage, now, composition }),
		);
		requireCore(
			decision.state === "allowed" &&
				decision.validUntil > now &&
				decision.ref === binding.ref &&
				decision.version === binding.version &&
				decision.digest === binding.digest &&
				decision.permissionRef === binding.permissionRef &&
				fingerprint(decision.scope) === fingerprint(binding.scope) &&
				decision.purpose === binding.purpose &&
				(composition === null
					? decision.appliesTo === "source"
					: decision.appliesTo === composition),
			"PERMISSION_BLOCKED",
			`assets.${binding.ref}.permission`,
		);
		return decision;
	} catch (error) {
		if (error instanceof Error)
			throw new CompositionError(
				"PERMISSION_BLOCKED",
				`assets.${binding.ref}.permission`,
			);
		throw error;
	}
}
export const assetLimits = Object.freeze({
	bytes: 2 * 1024 * 1024,
	pixels: 4 * 1024 * 1024,
	dimension: 4096,
	depth: 16,
	elements: 2048,
	attributes: 16,
});
export type ParsedAsset = {
	readonly binding: AssetBinding;
	readonly mime: "image/png" | "image/svg+xml";
	readonly width: number;
	readonly height: number;
	readonly alpha: boolean;
	readonly color: "srgb" | "unknown";
	readonly sourceBase64: string;
	readonly renderBase64: string;
	readonly renderDigest: Digest;
	readonly derivative: null | {
		readonly policy: "safe-container-v1";
		readonly source: Digest;
		readonly result: Digest;
	};
};

function parsePng(bytes: Buffer) {
	requireCore(
		bytes.length >= 33 &&
			bytes
				.subarray(0, 8)
				.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		"ASSET_UNSAFE",
		"png.signature",
	);
	const width = bytes.readUInt32BE(16),
		height = bytes.readUInt32BE(20);
	requireCore(
		bytes.readUInt32BE(8) === 13 && bytes.toString("ascii", 12, 16) === "IHDR",
		"ASSET_UNSAFE",
		"png.header",
	);
	requireCore(
		bytes[24] === 8 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0,
		"ASSET_UNSUPPORTED",
		"png.encoding",
	);
	const channels =
		bytes[25] === 0 || bytes[25] === 3
			? 1
			: bytes[25] === 2
				? 3
				: bytes[25] === 4
					? 2
					: bytes[25] === 6
						? 4
						: 0;
	requireCore(channels > 0, "ASSET_UNSUPPORTED", "png.colorType");
	requireCore(
		width > 0 &&
			height > 0 &&
			width <= assetLimits.dimension &&
			height <= assetLimits.dimension &&
			width * height <= assetLimits.pixels,
		"ASSET_LIMIT",
		"png.pixels",
	);
	let offset = 8,
		ended = false,
		color: "srgb" | "unknown" = "unknown";
	const singletons = new Set<string>(),
		compressedParts: Buffer[] = [];
	while (offset < bytes.length) {
		requireCore(offset + 12 <= bytes.length, "ASSET_UNSAFE", "png.chunk");
		const length = bytes.readUInt32BE(offset);
		const type = bytes.toString("ascii", offset + 4, offset + 8);
		requireCore(
			length <= assetLimits.bytes &&
				offset + length + 12 <= bytes.length &&
				[
					"IHDR",
					"IDAT",
					"IEND",
					"PLTE",
					"tRNS",
					"sRGB",
					"gAMA",
					"cHRM",
					"pHYs",
				].includes(type),
			"ASSET_UNSAFE",
			"png.container",
		);
		requireCore(
			[...bytes.subarray(offset + 4, offset + 8)].every(
				(v) => (v >= 65 && v <= 90) || (v >= 97 && v <= 122),
			) &&
				crc32(bytes.subarray(offset + 4, offset + 8 + length)) ===
					bytes.readUInt32BE(offset + 8 + length),
			"ASSET_UNSAFE",
			"png.crc",
		);
		if (type === "IDAT")
			compressedParts.push(bytes.subarray(offset + 8, offset + 8 + length));
		else {
			requireCore(
				!singletons.has(type) &&
					(compressedParts.length === 0 || type === "IEND") &&
					(type !== "IHDR" || offset === 8),
				"ASSET_UNSAFE",
				"png.chunkOrder",
			);
			singletons.add(type);
		}
		if (type === "sRGB") {
			requireCore(
				length === 1 && bytes[offset + 8] === 0,
				"ASSET_UNSAFE",
				"png.profile",
			);
			color = "srgb";
		}
		if (type === "gAMA")
			requireCore(
				length === 4 && bytes.readUInt32BE(offset + 8) === 45455,
				"ASSET_UNSUPPORTED",
				"png.gamma",
			);
		if (type === "cHRM")
			throw new CompositionError("ASSET_UNSUPPORTED", "png.chromaticity");
		offset += length + 12;
		if (type === "IEND") {
			requireCore(
				length === 0 && offset === bytes.length,
				"ASSET_UNSAFE",
				"png.trailing",
			);
			ended = true;
			break;
		}
	}
	requireCore(ended, "ASSET_UNSAFE", "png.end");
	try {
		const compressed = Buffer.concat(compressedParts),
			rawSize = (width * channels + 1) * height;
		requireCore(compressed.length > 0, "ASSET_UNSAFE", "png.data");
		const inflated: unknown = inflateSync(compressed, {
			maxOutputLength: rawSize,
			info: true,
		});
		const decodedStream = z
			.object({
				buffer: z.instanceof(Buffer),
				engine: z.object({ bytesWritten: z.number() }),
			})
			.parse(inflated);
		requireCore(
			decodedStream.buffer.length === rawSize &&
				decodedStream.engine.bytesWritten === compressed.length,
			"ASSET_UNSAFE",
			"png.deflateEnvelope",
		);
		const decoded = PNG.sync.read(bytes, { checkCRC: true });
		requireCore(
			decoded.width === width && decoded.height === height,
			"ASSET_UNSAFE",
			"png.dimensions",
		);
		let alpha = false;
		for (let i = 3; i < decoded.data.length; i += 4)
			if (decoded.data[i] !== 255) alpha = true;
		return {
			width,
			height,
			alpha,
			color,
			normalized: bytes,
		};
	} catch (error) {
		if (error instanceof CompositionError) throw error;
		if (error instanceof RangeError)
			throw new CompositionError("ASSET_LIMIT", "png.decompression");
		if (error instanceof Error)
			throw new CompositionError("ASSET_UNSAFE", "png.decode");
		throw error;
	}
}

const svgAttributes: Readonly<Record<string, readonly string[]>> =
	Object.freeze({
		svg: ["xmlns", "width", "height", "viewBox"],
		g: ["fill", "stroke", "stroke-width", "opacity"],
		rect: [
			"x",
			"y",
			"width",
			"height",
			"rx",
			"ry",
			"fill",
			"stroke",
			"stroke-width",
			"opacity",
		],
		circle: ["cx", "cy", "r", "fill", "stroke", "stroke-width", "opacity"],
		ellipse: [
			"cx",
			"cy",
			"rx",
			"ry",
			"fill",
			"stroke",
			"stroke-width",
			"opacity",
		],
		line: ["x1", "y1", "x2", "y2", "stroke", "stroke-width", "opacity"],
		polyline: ["points", "fill", "stroke", "stroke-width", "opacity"],
		polygon: ["points", "fill", "stroke", "stroke-width", "opacity"],
		title: [],
		desc: [],
	});
function parseSvg(bytes: Buffer) {
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch (error) {
		if (error instanceof Error)
			throw new CompositionError("ASSET_UNSAFE", "svg.encoding");
		throw error;
	}
	const options = { xmlns: true, strictEntities: true };
	const parser = sax.parser(true, options);
	const parts: string[] = [],
		stack: string[] = [];
	let count = 0,
		width = 0,
		height = 0,
		alpha = false;
	parser.onerror = () => {
		throw new CompositionError("ASSET_UNSAFE", "svg.xml");
	};
	parser.ondoctype = () => {
		throw new CompositionError("ASSET_UNSAFE", "svg.doctype");
	};
	parser.onprocessinginstruction = () => {
		throw new CompositionError("ASSET_UNSAFE", "svg.processing");
	};
	parser.oncdata = () => {
		throw new CompositionError("ASSET_UNSAFE", "svg.cdata");
	};
	parser.onopentag = (tag) => {
		requireCore(
			"uri" in tag && "prefix" in tag,
			"ASSET_UNSAFE",
			"svg.namespace",
		);
		const allowed = svgAttributes[tag.name];
		count++;
		requireCore(
			allowed !== undefined &&
				tag.uri === "http://www.w3.org/2000/svg" &&
				tag.prefix === "" &&
				count <= assetLimits.elements &&
				stack.length < assetLimits.depth &&
				Object.keys(tag.attributes).length <= assetLimits.attributes,
			"ASSET_UNSAFE",
			"svg.element",
		);
		requireCore(
			stack.length > 0
				? tag.name !== "svg" && !["title", "desc"].includes(stack.at(-1) ?? "")
				: tag.name === "svg",
			"ASSET_UNSAFE",
			"svg.root",
		);
		const attributes: Record<string, string> = {};
		for (const attr of Object.values(tag.attributes)) {
			requireCore(
				typeof attr !== "string",
				"ASSET_UNSAFE",
				"svg.namespaceAttribute",
			);
			requireCore(allowed.includes(attr.name), "ASSET_UNSAFE", "svg.attribute");
			if (attr.name === "xmlns")
				requireCore(
					attr.value === "http://www.w3.org/2000/svg",
					"ASSET_UNSAFE",
					"svg.namespace",
				);
			else if (["fill", "stroke"].includes(attr.name))
				requireCore(
					/^(#[0-9a-fA-F]{6}|none)$/.test(attr.value),
					"ASSET_UNSAFE",
					"svg.paint",
				);
			else {
				const tokens = attr.value.trim().split(/[\s,]+/);
				requireCore(
					tokens.length <= 4096 &&
						tokens.every(
							(v) =>
								/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(v) &&
								Math.abs(Number(v)) <= 10000,
						),
					"ASSET_UNSAFE",
					"svg.number",
				);
				if (attr.name === "points")
					requireCore(
						tokens.length >= 4 && tokens.length % 2 === 0,
						"ASSET_UNSAFE",
						"svg.points",
					);
				else if (attr.name === "viewBox")
					requireCore(
						tokens.length === 4 &&
							tokens[0] === "0" &&
							tokens[1] === "0" &&
							Number(tokens[2]) > 0 &&
							Number(tokens[3]) > 0,
						"ASSET_UNSAFE",
						"svg.viewBox",
					);
				else
					requireCore(
						tokens.length === 1 &&
							(!["width", "height", "r", "rx", "ry", "stroke-width"].includes(
								attr.name,
							) ||
								Number(attr.value) >= 0),
						"ASSET_UNSAFE",
						"svg.scalar",
					);
				if (attr.name === "opacity") {
					requireCore(
						Number(attr.value) >= 0 && Number(attr.value) <= 1,
						"ASSET_UNSAFE",
						"svg.opacity",
					);
					alpha ||= Number(attr.value) < 1;
				}
			}
			attributes[attr.name] = attr.value;
		}
		if (tag.name === "svg") {
			width = positiveSchema.parse(Number(attributes["width"]));
			height = positiveSchema.parse(Number(attributes["height"]));
			requireCore(
				width <= assetLimits.dimension &&
					height <= assetLimits.dimension &&
					width * height <= assetLimits.pixels,
				"ASSET_LIMIT",
				"svg.dimensions",
			);
			requireCore(
				attributes["viewBox"] === `0 0 ${width} ${height}`,
				"ASSET_UNSAFE",
				"svg.viewBox",
			);
		}
		parts.push(
			`<${tag.name}${Object.entries(attributes)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
				.join("")}>`,
		);
		stack.push(tag.name);
	};
	parser.ontext = (value) => {
		if (stack.at(-1) === "title" || stack.at(-1) === "desc")
			parts.push(escapeXml(value));
		else requireCore(value.trim() === "", "ASSET_UNSAFE", "svg.text");
	};
	parser.onclosetag = (name) => {
		requireCore(stack.pop() === name, "ASSET_UNSAFE", "svg.nesting");
		parts.push(`</${name}>`);
	};
	try {
		parser.write(text).close();
	} catch (error) {
		if (error instanceof CompositionError) throw error;
		if (error instanceof Error)
			throw new CompositionError("ASSET_UNSAFE", "svg.parse");
		throw error;
	}
	requireCore(
		count > 0 && width > 0 && height > 0 && stack.length === 0,
		"ASSET_UNSAFE",
		"svg.empty",
	);
	return {
		width,
		height,
		alpha: true,
		color: "srgb" as const,
		normalized: Buffer.from(parts.join("")),
		paintHasAlpha: alpha,
	};
}

export function parseAsset(
	binding: AssetBinding,
	bytes: Uint8Array,
): ParsedAsset {
	requireCore(
		bytes.byteLength > 0 && bytes.byteLength <= assetLimits.bytes,
		"ASSET_LIMIT",
		`assets.${binding.ref}`,
	);
	const source = Buffer.from(bytes);
	requireCore(
		digest(source) === binding.digest,
		"ASSET_HASH",
		`assets.${binding.ref}`,
	);
	const isPng = source[0] === 137 && source[1] === 80;
	requireCore(
		!isPng || binding.normalization === "none",
		"ASSET_UNSUPPORTED",
		"png.normalization",
	);
	requireCore(
		binding.purpose !== "artwork" || isPng,
		"ASSET_UNSUPPORTED",
		"artwork.raster",
	);
	const parsed = isPng ? parsePng(source) : parseSvg(source);
	const render =
		binding.normalization === "safe-container-v1" ? parsed.normalized : source;
	requireCore(
		binding.purpose !== "artwork" || binding.normalization === "none",
		"ASSET_UNSUPPORTED",
		"artwork.normalization",
	);
	const renderDigest = digest(render);
	return freeze({
		binding,
		mime: isPng ? ("image/png" as const) : ("image/svg+xml" as const),
		width: parsed.width,
		height: parsed.height,
		alpha: parsed.alpha,
		color: parsed.color,
		sourceBase64: source.toString("base64"),
		renderBase64: render.toString("base64"),
		renderDigest,
		derivative:
			renderDigest === binding.digest
				? null
				: {
						policy: "safe-container-v1" as const,
						source: binding.digest,
						result: renderDigest,
					},
	});
}
export async function resolveAsset(
	binding: AssetBinding,
	scope: Scope,
	ports: AssetPorts,
	now: number,
): Promise<ParsedAsset> {
	requireCore(
		fingerprint(scope) === fingerprint(binding.scope),
		"PERMISSION_BLOCKED",
		`assets.${binding.ref}.scope`,
	);
	await checkPermission(binding, ports, "compose", now, null);
	let bytes: Uint8Array | null;
	try {
		bytes = await ports.resolve(scope, binding.ref, binding.version);
	} catch (error) {
		if (error instanceof Error)
			throw new CompositionError("ASSET_MISSING", `assets.${binding.ref}`);
		throw error;
	}
	requireCore(bytes !== null, "ASSET_MISSING", `assets.${binding.ref}`);
	return parseAsset(binding, bytes);
}
