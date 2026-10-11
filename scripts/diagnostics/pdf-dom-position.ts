import type { BrowserContext } from "playwright";
import { z } from "zod";
import type { PrivateArtifact } from "../../src/composition/private-model.js";
import { fingerprint } from "../../src/composition/primitives.js";
const number = z.number().finite().min(-1000000).max(1000000);
const point = z.object({ x: number, y: number }).strict();
const rowsSchema = z
	.array(
		z
			.object({
				value: z.string().max(512),
				family: z.string().max(128),
				advance: number,
				bounds: z
					.object({ x: number, y: number, width: number, height: number })
					.strict(),
				matrix: z.array(number).length(6),
				chars: z
					.array(
						z
							.object({
								index: z.number().int().min(0).max(255),
								start: point,
								end: point,
							})
							.strict(),
					)
					.max(256),
			})
			.strict(),
	)
	.max(16);
export async function domPositions(
	context: BrowserContext,
	artifact: PrivateArtifact,
) {
	const page = await context.newPage();
	try {
		const { width, height } = artifact.model.layout;
		await page.setContent(
			`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; script-src 'none'; base-uri 'none'"><style>@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${artifact.svg}</body></html>`,
		);
		const observed = await page.evaluate(async () => {
			await document.fonts.ready;
			const texts = [...document.querySelectorAll("text")];
			await Promise.all(
				texts.map((text) =>
					document.fonts.load(
						`${text.getAttribute("font-size")}px '${text.getAttribute("font-family")}'`,
						text.textContent ?? "",
					),
				),
			);
			return texts.map((text) => {
				const b = text.getBBox(),
					m = text.getScreenCTM();
				return {
					value: text.textContent ?? "",
					family: text.getAttribute("font-family") ?? "",
					advance: text.getComputedTextLength(),
					bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
					matrix: m ? [m.a, m.b, m.c, m.d, m.e, m.f] : [],
					chars: Array.from(
						{ length: Math.min(text.getNumberOfChars(), 257) },
						(_, index) => {
							const start = text.getStartPositionOfChar(index),
								end = text.getEndPositionOfChar(index);
							return {
								index,
								start: { x: start.x, y: start.y },
								end: { x: end.x, y: end.y },
							};
						},
					),
				};
			});
		});
		return rowsSchema
			.parse(observed)
			.map(({ value, family, ...coordinates }) => ({
				textDigest: fingerprint(value),
				fontFamilyDigest: fingerprint(family),
				...coordinates,
			}));
	} finally {
		await page.close();
	}
}
