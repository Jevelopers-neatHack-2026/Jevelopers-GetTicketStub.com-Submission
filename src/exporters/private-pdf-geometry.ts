import { requireOutput } from "./private-policy.js";
import type { PdfToken } from "./private-pdf-tokens.js";
export type Matrix = readonly [number, number, number, number, number, number];
export type Box = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};
export const identityMatrix: Matrix = [1, 0, 0, 1, 0, 0];
export function numbers(args: readonly PdfToken[], count: number): number[] {
	requireOutput(
		args.length === count && args.every((a) => typeof a === "number"),
		"OUTPUT_UNSUPPORTED",
		"pdf.operands",
	);
	return args.map((a) => {
		requireOutput(typeof a === "number", "OUTPUT_UNSUPPORTED", "pdf.number");
		return a;
	});
}
export function matrix(args: readonly PdfToken[]): Matrix {
	const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = numbers(args, 6);
	return [a, b, c, d, e, f];
}
export function multiply(a: Matrix, b: Matrix): Matrix {
	return [
		a[0] * b[0] + a[2] * b[1],
		a[1] * b[0] + a[3] * b[1],
		a[0] * b[2] + a[2] * b[3],
		a[1] * b[2] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4],
		a[1] * b[4] + a[3] * b[5] + a[5],
	];
}
export function point(
	m: Matrix,
	x: number,
	y: number,
): readonly [number, number] {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
export function boxOf(points: readonly (readonly [number, number])[]): Box {
	requireOutput(points.length > 0, "OUTPUT_UNSUPPORTED", "pdf.emptyPath");
	const xs = points.map((p) => p[0]),
		ys = points.map((p) => p[1]);
	return {
		x: Math.min(...xs),
		y: Math.min(...ys),
		width: Math.max(...xs) - Math.min(...xs),
		height: Math.max(...ys) - Math.min(...ys),
	};
}
export function includesBox(outer: Box, inner: Box): boolean {
	return (
		inner.x >= outer.x - 0.06 &&
		inner.y >= outer.y - 0.06 &&
		inner.x + inner.width <= outer.x + outer.width + 0.06 &&
		inner.y + inner.height <= outer.y + outer.height + 0.06
	);
}
export function intersects(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width - 0.01 &&
		a.x + a.width > b.x + 0.01 &&
		a.y < b.y + b.height - 0.01 &&
		a.y + a.height > b.y + 0.01
	);
}
