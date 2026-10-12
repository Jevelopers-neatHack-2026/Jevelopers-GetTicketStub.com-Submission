import type { Page, BrowserContext } from "playwright";
import { z } from "zod";
import { PNG } from "pngjs";
import { digest, fingerprint } from "../composition/primitives.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import { requireOutput } from "./private-policy.js";
import type { OutputPolicy } from "./private-policy.js";
import { normalizePng } from "./private-png.js";
import { normalizePdf } from "./private-pdf.js";

async function loadPage(page: Page, artifact: PrivateArtifact): Promise<void> {
	const { width, height } = artifact.model.layout;
	await page.setContent(
		`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; script-src 'none'; base-uri 'none'"><style>@page{size:${width}mm ${height}mm;margin:0}html,body{margin:0}svg{display:block}</style></head><body>${artifact.svg}</body></html>`,
	);
	await page.evaluate(async () => {
		await document.fonts.ready;
		for (const text of document.querySelectorAll("text"))
			await document.fonts.load(
				`${text.getAttribute("font-size")}px '${text.getAttribute("font-family")}'`,
				text.textContent ?? "",
			);
		await Promise.all(
			[...document.querySelectorAll("image")].map(async (e) => {
				const image = new Image();
				image.src = e.getAttribute("href") ?? "";
				await image.decode();
			}),
		);
	});
}
export async function renderFiles(
	context: BrowserContext,
	artifact: PrivateArtifact,
	policy: OutputPolicy,
) {
	const page = await context.newPage(),
		{ width, height } = artifact.model.layout;
	const widthPx = Math.round((width * policy.dpi) / 25.4),
		heightPx = Math.round((height * policy.dpi) / 25.4);
	requireOutput(
		widthPx > 0 && heightPx > 0 && widthPx * heightPx <= policy.maxPixels,
		"OUTPUT_LIMIT",
		"pixels",
	);
	try {
		await page.setViewportSize({ width: widthPx, height: heightPx });
		await loadPage(page, artifact);
		const metrics = await page.evaluate(() =>
			[...document.querySelectorAll("text")].map((t) => ({
				value: t.textContent ?? "",
				font: t.getAttribute("font-family"),
				advance: t.getComputedTextLength(),
				x: t.getBBox().x,
			})),
		);
		const expected = artifact.texts.flatMap((t) =>
			t.state === "measured"
				? t.lines
						.filter((l) => l.value.length > 0)
						.map((line) => ({ line, font: t.font }))
				: [],
		);
		requireOutput(
			metrics.length === expected.length,
			"OUTPUT_CONTENT",
			"render.textCount",
		);
		for (const [i, m] of metrics.entries()) {
			const e = expected[i];
			requireOutput(
				e !== undefined &&
					m.value === e.line.value &&
					m.font === `font-${e.font.digest}` &&
					Math.abs(m.advance - e.line.advance) < 0.03 &&
					Math.abs(m.x - e.line.x) < 0.03,
				"OUTPUT_CONTENT",
				"render.shaping",
			);
		}
		const cdp = await context.newCDPSession(page),
			platformFonts = [];
		try {
			await cdp.send("DOM.enable");
			await cdp.send("CSS.enable");
			const doc = z
				.object({ root: z.object({ nodeId: z.number() }) })
				.parse(await cdp.send("DOM.getDocument"));
			const nodes = z.object({ nodeIds: z.array(z.number()) }).parse(
				await cdp.send("DOM.querySelectorAll", {
					nodeId: doc.root.nodeId,
					selector: "text",
				}),
			);
			for (const [i, nodeId] of nodes.nodeIds.entries()) {
				const observed = z
					.object({
						fonts: z.array(
							z.object({
								postScriptName: z.string(),
								isCustomFont: z.boolean(),
								glyphCount: z.number(),
							}),
						),
					})
					.parse(await cdp.send("CSS.getPlatformFontsForNode", { nodeId }));
				const e = expected[i];
				requireOutput(
					e !== undefined &&
						observed.fonts.length > 0 &&
						observed.fonts.every(
							(f) =>
								f.isCustomFont &&
								f.postScriptName === e.font.postscriptName &&
								f.glyphCount > 0,
						),
					"OUTPUT_CONTENT",
					"render.platformFont",
				);
				platformFonts.push(observed.fonts);
			}
		} finally {
			await cdp.detach();
		}
		await page.locator("body > svg").evaluate(
			(svg, size) => {
				svg.setAttribute("width", `${size.width}px`);
				svg.setAttribute("height", `${size.height}px`);
			},
			{ width: widthPx, height: heightPx },
		);
		const screenshot = await page.screenshot({
			type: "png",
			animations: "disabled",
		});
		const pixels = PNG.sync.read(screenshot);
		const png = normalizePng(screenshot, policy.dpi);
		let pdf: Uint8Array | null = null;
		if (artifact.model.layout.exports.includes("pdf")) {
			await loadPage(page, artifact);
			pdf = await normalizePdf(
				await page.pdf({
					preferCSSPageSize: true,
					printBackground: true,
					displayHeaderFooter: false,
					tagged: false,
				}),
				artifact,
			);
		}
		return {
			png,
			pdf,
			pixelDigest: digest(pixels.data),
			proof: {
				metricsDigest: fingerprint(metrics),
				platformFontsDigest: fingerprint(platformFonts),
				widthPx,
				heightPx,
			},
		};
	} finally {
		await page.close();
	}
}
