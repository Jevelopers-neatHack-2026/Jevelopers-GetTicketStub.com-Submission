import { createHash } from "node:crypto";
import { z } from "zod";

export const digestSchema = z
	.string()
	.regex(/^[a-f0-9]{64}$/)
	.brand<"CompositionDigest">();
export type Digest = z.infer<typeof digestSchema>;
export const refSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
	.brand<"CompositionRef">();
export const revisionSchema = z
	.string()
	.min(1)
	.max(100)
	.regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const coordinateSchema = z
	.number()
	.finite()
	.min(-10000)
	.max(10000)
	.refine(
		(v) => Math.abs(v * 1e6 - Math.round(v * 1e6)) < 1e-5,
		"Six decimal places maximum",
	);
export const positiveSchema = coordinateSchema.refine((v) => v > 0);
export const rectSchema = z
	.object({
		x: coordinateSchema,
		y: coordinateSchema,
		width: positiveSchema,
		height: positiveSchema,
	})
	.strict()
	.readonly();
export type Rect = z.infer<typeof rectSchema>;
export const scopeSchema = z
	.object({ tenant: refSchema, project: refSchema })
	.strict()
	.readonly();
export type Scope = z.infer<typeof scopeSchema>;
export const transformSchema = z
	.object({
		x: coordinateSchema,
		y: coordinateSchema,
		scaleX: positiveSchema,
		scaleY: positiveSchema,
		rotation: coordinateSchema.refine((v) => v >= -180 && v <= 180),
	})
	.strict()
	.readonly();
export type Transform = z.infer<typeof transformSchema>;
export const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
export type CoreCode =
	| "INVALID_INPUT"
	| "INVALID_GEOMETRY"
	| "REVISION_CONFLICT"
	| "ASSET_MISSING"
	| "ASSET_HASH"
	| "ASSET_LIMIT"
	| "ASSET_UNSAFE"
	| "ASSET_UNSUPPORTED"
	| "PERMISSION_BLOCKED"
	| "FONT_INVALID"
	| "RENDER_INTEGRITY";
export class CompositionError extends Error {
	constructor(
		readonly code: CoreCode,
		readonly path: string,
	) {
		super(`${code} at ${path}`);
		this.name = "CompositionError";
	}
}
export function requireCore(
	value: boolean,
	code: CoreCode,
	path: string,
): asserts value {
	if (!value) throw new CompositionError(code, path);
}

// Inspect descriptors before schema parsing: input must be inert JSON, never getters or executable objects.
function inert(value: unknown, seen: Set<object>, depth: number): void {
	requireCore(depth <= 32, "INVALID_INPUT", "input.depth");
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return;
	if (typeof value === "number") {
		requireCore(Number.isFinite(value), "INVALID_INPUT", "input.number");
		return;
	}
	requireCore(
		typeof value === "object" && value !== null,
		"INVALID_INPUT",
		"input.type",
	);
	requireCore(
		!Array.isArray(value) || value.length <= 10000,
		"INVALID_INPUT",
		"input.arrayLength",
	);
	requireCore(
		!seen.has(value) &&
			(Array.isArray(value) ||
				Object.getPrototypeOf(value) === Object.prototype),
		"INVALID_INPUT",
		"input.object",
	);
	seen.add(value);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	requireCore(
		Reflect.ownKeys(value).length <= 10000 &&
			Object.getOwnPropertySymbols(value).length === 0,
		"INVALID_INPUT",
		"input.keys",
	);
	for (const [key, descriptor] of Object.entries(descriptors)) {
		requireCore(
			"value" in descriptor &&
				key !== "__proto__" &&
				key !== "constructor" &&
				key !== "prototype",
			"INVALID_INPUT",
			"input.property",
		);
		inert(descriptor.value, seen, depth + 1);
	}
	seen.delete(value);
}
export function parse<S extends z.ZodType>(
	schema: S,
	value: unknown,
): z.output<S> {
	inert(value, new Set(), 0);
	const result = schema.safeParse(value);
	if (!result.success)
		throw new CompositionError(
			"INVALID_INPUT",
			result.error.issues[0]?.path.join(".") ?? "input",
		);
	return freeze(result.data);
}
export function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
export function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
			.join(",")}}`;
	const encoded = JSON.stringify(value);
	requireCore(encoded !== undefined, "INVALID_INPUT", "identity");
	return encoded;
}
export function digest(bytes: Uint8Array | string): Digest {
	return digestSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}
export function fingerprint(value: unknown): Digest {
	return digest(canonical(value));
}
export function precise(n: number): number {
	return Math.round(n * 1e6) / 1e6;
}
export function contains(outer: Rect, inner: Rect): boolean {
	return (
		inner.x >= outer.x - 1e-6 &&
		inner.y >= outer.y - 1e-6 &&
		inner.x + inner.width <= outer.x + outer.width + 1e-6 &&
		inner.y + inner.height <= outer.y + outer.height + 1e-6
	);
}
export function overlaps(a: Rect, b: Rect): boolean {
	return (
		a.x < b.x + b.width - 1e-6 &&
		a.x + a.width > b.x + 1e-6 &&
		a.y < b.y + b.height - 1e-6 &&
		a.y + a.height > b.y + 1e-6
	);
}
export function transformed(rect: Rect, t: Transform): Rect {
	const angle = (t.rotation * Math.PI) / 180;
	const points = [
		[rect.x, rect.y],
		[rect.x + rect.width, rect.y],
		[rect.x, rect.y + rect.height],
		[rect.x + rect.width, rect.y + rect.height],
	].map(([x = 0, y = 0]) => ({
		x: t.x + x * t.scaleX * Math.cos(angle) - y * t.scaleY * Math.sin(angle),
		y: t.y + x * t.scaleX * Math.sin(angle) + y * t.scaleY * Math.cos(angle),
	}));
	const x = Math.min(...points.map((p) => p.x));
	const y = Math.min(...points.map((p) => p.y));
	return {
		x: precise(x),
		y: precise(y),
		width: precise(Math.max(...points.map((p) => p.x)) - x),
		height: precise(Math.max(...points.map((p) => p.y)) - y),
	};
}
export function escapeXml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
