import { create } from "fontkit";
import type { Font } from "fontkit";
import { z } from "zod";
import {
	CompositionError,
	coordinateSchema,
	digest,
	digestSchema,
	fingerprint,
	freeze,
	parse,
	positiveSchema,
	precise,
	rectSchema,
	refSchema,
	requireCore,
	revisionSchema,
} from "../composition/primitives.js";
import type { Digest, Rect } from "../composition/primitives.js";

export const fontDescriptorSchema = z
	.object({
		ref: refSchema,
		digest: digestSchema,
		licenseDigest: digestSchema,
		license: z.literal("OFL-1.1"),
		provenance: z.string().url().max(512),
		postscriptName: revisionSchema,
		format: z.enum(["woff2", "truetype"]),
	})
	.strict()
	.readonly();
export type FontDescriptor = z.infer<typeof fontDescriptorSchema>;
export type PinnedFont = {
	readonly descriptor: FontDescriptor;
	readonly base64: string;
};
export function pinFont(
	value: unknown,
	bytes: Uint8Array,
	licenseBytes: Uint8Array,
): PinnedFont {
	const descriptor = parse(fontDescriptorSchema, value);
	requireCore(
		bytes.length > 0 &&
			bytes.length <= 2 * 1024 * 1024 &&
			digest(bytes) === descriptor.digest &&
			digest(licenseBytes) === descriptor.licenseDigest &&
			Buffer.from(licenseBytes)
				.toString("utf8")
				.includes("SIL OPEN FONT LICENSE"),
		"FONT_INVALID",
		`fonts.${descriptor.ref}.pin`,
	);
	const font = readFont(Buffer.from(bytes));
	requireCore(
		font.postscriptName === descriptor.postscriptName &&
			font.unitsPerEm > 0 &&
			font.type === (descriptor.format === "woff2" ? "WOFF2" : "TTF"),
		"FONT_INVALID",
		`fonts.${descriptor.ref}.identity`,
	);
	return freeze({ descriptor, base64: Buffer.from(bytes).toString("base64") });
}
function readFont(bytes: Buffer): Font {
	try {
		const font = create(bytes);
		requireCore("layout" in font, "FONT_INVALID", "font.collection");
		return font;
	} catch (error) {
		if (error instanceof CompositionError) throw error;
		if (error instanceof Error)
			throw new CompositionError("FONT_INVALID", "font.parse");
		throw error;
	}
}
const exactSchema = z
	.string()
	.max(8192)
	.refine(
		(value) =>
			![...value].some((char) => {
				const cp = char.codePointAt(0) ?? 0;
				return (
					(cp < 32 && cp !== 10) ||
					(cp >= 0x7f && cp <= 0x9f) ||
					(cp >= 0xd800 && cp <= 0xdfff) ||
					[
						0xfffe, 0xffff, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
						0x2067, 0x2068, 0x2069,
					].includes(cp)
				);
			}),
		"Unsupported control character",
	);
const displaySchema = z
	.object({ kind: z.literal("display"), value: exactSchema })
	.strict()
	.readonly();
const dateSchema = z
	.object({
		kind: z.literal("datetime"),
		value: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/),
		timezone: z.string().min(1).max(100),
		locale: z.string().min(1).max(100),
		options: z
			.object({
				year: z.literal("numeric"),
				month: z.enum(["numeric", "2-digit", "short", "long"]),
				day: z.enum(["numeric", "2-digit"]),
				hour: z.literal("2-digit"),
				minute: z.literal("2-digit"),
				hourCycle: z.enum(["h23", "h12"]),
			})
			.strict()
			.readonly(),
	})
	.strict()
	.readonly();
export const textFieldSchema = z
	.object({
		fieldRef: refSchema,
		rowRef: refSchema,
		sourceRef: refSchema,
		sourceDigest: digestSchema,
		source: z.discriminatedUnion("kind", [displaySchema, dateSchema]),
		formatRevision: revisionSchema,
		required: z.boolean(),
		fontOrder: z.array(refSchema).min(1).max(16).readonly(),
		sizeMm: positiveSchema,
		lineHeight: positiveSchema,
		wrap: z.enum(["none", "grapheme"]),
		align: z.enum(["start", "center", "end"]),
		direction: z.enum(["ltr", "rtl"]),
		language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
		baseline: z.literal("alphabetic"),
		bounds: rectSchema,
		color: z.string().regex(/^#[0-9a-f]{6}$/),
		letterSpacingMm: coordinateSchema.refine((v) => v === 0),
	})
	.strict()
	.readonly();
export type TextField = z.infer<typeof textFieldSchema>;
export type TextLine = {
	readonly value: string;
	readonly x: number;
	readonly baseline: number;
	readonly advance: number;
	readonly glyphs: readonly number[];
	readonly bounds: Rect;
};
export type TextLayout =
	| {
			readonly state: "measured";
			readonly field: TextField;
			readonly sourceValue: string;
			readonly formattedValue: string;
			readonly font: FontDescriptor;
			readonly lines: readonly TextLine[];
			readonly bounds: Rect;
			readonly overflow: boolean;
			readonly fontDecision: "primary" | "approved-fallback";
			readonly evidenceDigest: Digest;
	  }
	| {
			readonly state: "blocked";
			readonly field: TextField;
			readonly code:
				| "TEXT_REQUIRED"
				| "FONT_MISSING"
				| "GLYPH_MISSING"
				| "TEXT_DIRECTION_UNSUPPORTED"
				| "TEXT_FORMAT";
	  };

export function formatField(field: TextField): string {
	requireCore(
		digest(field.source.value) === field.sourceDigest,
		"RENDER_INTEGRITY",
		`fields.${field.fieldRef}.source`,
	);
	switch (field.source.kind) {
		case "display":
			return field.source.value;
		case "datetime": {
			const date = new Date(field.source.value);
			requireCore(
				Number.isFinite(date.getTime()) &&
					date.toISOString() ===
						(field.source.value.includes(".")
							? field.source.value
							: field.source.value.replace(/Z$/, ".000Z")),
				"INVALID_INPUT",
				`fields.${field.fieldRef}.date`,
			);
			try {
				requireCore(
					Intl.DateTimeFormat.supportedLocalesOf([field.source.locale])
						.length === 1,
					"INVALID_INPUT",
					"text.locale",
				);
				return new Intl.DateTimeFormat(field.source.locale, {
					...field.source.options,
					timeZone: field.source.timezone,
				}).format(date);
			} catch (error) {
				if (error instanceof CompositionError) throw error;
				if (error instanceof Error)
					throw new CompositionError(
						"INVALID_INPUT",
						`fields.${field.fieldRef}.format`,
					);
				throw error;
			}
		}
		default: {
			const unreachable: never = field.source;
			return unreachable;
		}
	}
}
function boundsOf(rects: readonly Rect[], fallback: Rect): Rect {
	if (!rects.length)
		return { x: fallback.x, y: fallback.y, width: 0, height: 0 };
	const x = Math.min(...rects.map((r) => r.x)),
		y = Math.min(...rects.map((r) => r.y));
	return {
		x: precise(x),
		y: precise(y),
		width: precise(Math.max(...rects.map((r) => r.x + r.width)) - x),
		height: precise(Math.max(...rects.map((r) => r.y + r.height)) - y),
	};
}
export function layoutText(
	field: TextField,
	fonts: readonly PinnedFont[],
): TextLayout {
	let value: string;
	try {
		value = formatField(field);
	} catch (error) {
		if (error instanceof CompositionError)
			return freeze({ state: "blocked", field, code: "TEXT_FORMAT" });
		throw error;
	}
	if (field.required && value.length === 0)
		return freeze({ state: "blocked", field, code: "TEXT_REQUIRED" });
	const hasRtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(value);
	const hasLtr = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/u.test(
		value,
	);
	if (
		(hasRtl && (field.direction !== "rtl" || hasLtr)) ||
		(hasLtr && field.direction !== "ltr")
	)
		return freeze({
			state: "blocked",
			field,
			code: "TEXT_DIRECTION_UNSUPPORTED",
		});
	let selected:
		| { readonly font: Font; readonly pinned: PinnedFont }
		| undefined;
	let present = false;
	for (const ref of field.fontOrder) {
		const pinned = fonts.find((f) => f.descriptor.ref === ref);
		if (!pinned) continue;
		present = true;
		requireCore(
			digest(Buffer.from(pinned.base64, "base64")) === pinned.descriptor.digest,
			"FONT_INVALID",
			`fonts.${ref}.hash`,
		);
		const font = readFont(Buffer.from(pinned.base64, "base64"));
		if (
			[...value]
				.filter((c) => c !== "\n")
				.every((c) => font.hasGlyphForCodePoint(c.codePointAt(0) ?? 0)) &&
			value
				.split("\n")
				.every((line) =>
					font
						.layout(line, undefined, undefined, field.language, field.direction)
						.glyphs.every((g) => g.id !== 0),
				)
		) {
			selected = { font, pinned };
			break;
		}
	}
	if (!selected)
		return freeze({
			state: "blocked",
			field,
			code: present ? "GLYPH_MISSING" : "FONT_MISSING",
		});
	const { font, pinned } = selected,
		scale = field.sizeMm / font.unitsPerEm;
	const shape = (text: string) =>
		font.layout(text, undefined, undefined, field.language, field.direction);
	const values: string[] = [];
	for (const paragraph of value.split("\n")) {
		if (field.wrap === "none" || paragraph === "") {
			values.push(paragraph);
			continue;
		}
		let line = "";
		for (const { segment } of new Intl.Segmenter(field.language, {
			granularity: "grapheme",
		}).segment(paragraph)) {
			if (
				line !== "" &&
				shape(line + segment).advanceWidth * scale > field.bounds.width
			) {
				values.push(line);
				line = segment;
			} else line += segment;
		}
		values.push(line);
	}
	const lines = values.map((text, index) => {
		const run = shape(text),
			advance = precise(run.advanceWidth * scale);
		const offset =
			field.align === "center"
				? (field.bounds.width - advance) / 2
				: (field.align === "start") === (field.direction === "ltr")
					? 0
					: field.bounds.width - advance;
		const x = precise(field.bounds.x + offset),
			baseline = precise(
				field.bounds.y +
					font.ascent * scale +
					index * field.sizeMm * field.lineHeight,
			);
		let penX = 0,
			penY = 0;
		const glyphBounds = run.glyphs
			.map((glyph, i) => {
				const pos = run.positions[i];
				requireCore(pos !== undefined, "FONT_INVALID", "font.positions");
				const b = glyph.bbox;
				const result = {
					x: x + (penX + pos.xOffset + b.minX) * scale,
					y: baseline - (penY + pos.yOffset + b.maxY) * scale,
					width: (b.maxX - b.minX) * scale,
					height: (b.maxY - b.minY) * scale,
				};
				penX += pos.xAdvance;
				penY += pos.yAdvance;
				return result;
			})
			.filter((b) => b.width > 0 && b.height > 0);
		return {
			value: text,
			x,
			baseline,
			advance,
			glyphs: run.glyphs.map((g) => g.id),
			bounds: boundsOf(glyphBounds, { x, y: baseline, width: 0, height: 0 }),
		};
	});
	const bounds = boundsOf(
		lines.map((l) => l.bounds),
		field.bounds,
	);
	const overflow =
		lines.some((l) => l.advance > field.bounds.width + 1e-6) ||
		bounds.x < field.bounds.x - 1e-6 ||
		bounds.y < field.bounds.y - 1e-6 ||
		bounds.x + bounds.width > field.bounds.x + field.bounds.width + 1e-6 ||
		bounds.y + bounds.height > field.bounds.y + field.bounds.height + 1e-6;
	const evidence = {
		field,
		sourceValue: field.source.value,
		formattedValue: value,
		font: pinned.descriptor,
		lines,
		bounds,
		overflow,
		fontDecision:
			pinned.descriptor.ref === field.fontOrder[0]
				? ("primary" as const)
				: ("approved-fallback" as const),
	};
	return freeze({
		state: "measured",
		...evidence,
		evidenceDigest: fingerprint(evidence),
	});
}
