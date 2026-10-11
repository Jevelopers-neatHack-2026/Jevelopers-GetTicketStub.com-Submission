import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { assertEnvironment } from "./environment.js";
import { requireCheck } from "./errors.js";
import { readResource, sha256 } from "./resources.js";
import { loadCalibrationFont } from "../typography/calibration-font.js";
import {
	openOfflineBrowser,
	probeNetwork,
} from "../exporters/offline-browser.js";
import { inspectCalibration } from "../preflight/calibration-output.js";

const fixtureSchema = z
	.object({
		widthMm: z.literal(101.6),
		heightMm: z.literal(50.8),
		widthPx: z.literal(384),
		heightPx: z.literal(192),
		widthPt: z.literal(288),
		heightPt: z.literal(144),
		fontSizePx: z.literal(18),
		lines: z.array(z.string()).length(3),
	})
	.strict();
const documentSchema = z
	.object({ root: z.object({ nodeId: z.number() }).passthrough() })
	.passthrough();
const nodesSchema = z.object({ nodeIds: z.array(z.number()) }).passthrough();
const fontsSchema = z
	.object({
		fonts: z.array(
			z.object({
				familyName: z.string(),
				postScriptName: z.string(),
				isCustomFont: z.boolean(),
				glyphCount: z.number(),
			}),
		),
	})
	.passthrough();

/** Local synthetic fixture adapter only. No production input or approval authority. */
export async function renderCalibration(outputDirectory: string) {
	const { pins, receipt } = await assertEnvironment();
	const fixtureBytes = await readResource("tests/fixtures/calibration.json");
	const fixture = fixtureSchema.parse(JSON.parse(fixtureBytes.toString()));
	const svgBytes = await readResource("tests/fixtures/calibration.svg");
	const font = await loadCalibrationFont(
		pins,
		fixture.lines,
		fixture.fontSizePx,
	);
	const svg = svgBytes
		.toString()
		.replace(
			">",
			`><style>@font-face{font-family:'PP Calibration';src:url(data:font/woff2;base64,${font.bytes.toString("base64")}) format('woff2');font-weight:400;font-style:normal;font-display:block}</style>`,
		);
	const { browser, context, denied, binarySha256, sandbox } =
		await openOfflineBrowser(pins);
	try {
		await probeNetwork(context, denied);
		const probeDenied = [...denied];
		denied.length = 0;
		const page = await context.newPage();
		await page.setContent(
			`<html lang="en-US"><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; script-src 'none'; base-uri 'none'"><style>@page{size:101.6mm 50.8mm;margin:0}html,body{margin:0;width:384px;height:192px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`,
		);
		await page.evaluate(async () => {
			await document.fonts.ready;
			await document.fonts.load("18px 'PP Calibration'");
		});
		const metrics = await page.evaluate(() => {
			const svgElement = document.querySelector("svg");
			const rect = svgElement?.getBoundingClientRect();
			return {
				width: rect?.width,
				height: rect?.height,
				locale: navigator.language,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				fontsLoaded: document.fonts.check("18px 'PP Calibration'"),
				lines: [...document.querySelectorAll("text")].map((element) => ({
					text: element.textContent,
					width: element.getComputedTextLength(),
				})),
			};
		});
		requireCheck(
			metrics.width === fixture.widthPx &&
				metrics.height === fixture.heightPx &&
				metrics.locale === pins.locale &&
				metrics.timezone === pins.timezone,
			"DIMENSION_MISMATCH",
			"Browser physical dimensions or locale differ from the profile.",
		);
		requireCheck(
			metrics.fontsLoaded &&
				JSON.stringify(metrics.lines.map((line) => line.text)) ===
					JSON.stringify(fixture.lines),
			"CONTENT_MISMATCH",
			"Browser corpus or font readiness differs from the fixture.",
		);
		for (const [index, line] of metrics.lines.entries()) {
			const width = font.expectedWidths[index];
			requireCheck(
				width !== undefined && Math.abs(line.width - width) < 0.1,
				"CALIBRATION_FAILURE",
				"Browser shaping width differs from independently shaped font metrics.",
			);
		}
		const cdp = await context.newCDPSession(page);
		await cdp.send("DOM.enable");
		await cdp.send("CSS.enable");
		const doc = documentSchema.parse(await cdp.send("DOM.getDocument"));
		const nodes = nodesSchema.parse(
			await cdp.send("DOM.querySelectorAll", {
				nodeId: doc.root.nodeId,
				selector: "text",
			}),
		);
		const platformFonts = [];
		for (const nodeId of nodes.nodeIds) {
			const result = fontsSchema.parse(
				await cdp.send("CSS.getPlatformFontsForNode", { nodeId }),
			);
			requireCheck(
				result.fonts.length === 1 &&
					result.fonts.every(
						(item) =>
							item.isCustomFont &&
							item.postScriptName === font.postscriptName &&
							item.glyphCount > 0,
					),
				"FONT_FALLBACK",
				"Actual painted glyphs must use only the pinned custom font.",
			);
			platformFonts.push(result.fonts);
		}
		requireCheck(
			platformFonts.length === fixture.lines.length,
			"FONT_FALLBACK",
			"Every calibration text node must have font provenance.",
		);
		const png = await page.screenshot({ type: "png", animations: "disabled" });
		const pdf = await page.pdf({
			preferCSSPageSize: true,
			printBackground: true,
			displayHeaderFooter: false,
			tagged: false,
		});
		requireCheck(
			denied.length === 0,
			"NETWORK_POLICY_FAILURE",
			"Calibration attempted an external resource request.",
		);
		const { normalizedPdf, ...inspection } = await inspectCalibration(
			png,
			pdf,
			fixture,
		);
		await mkdir(outputDirectory, { recursive: true });
		await Promise.all([
			writeFile(join(outputDirectory, "calibration.svg"), svg),
			writeFile(join(outputDirectory, "calibration.png"), png),
			writeFile(join(outputDirectory, "calibration.pdf"), pdf),
			writeFile(
				join(outputDirectory, "calibration.normalized.pdf"),
				normalizedPdf,
			),
		]);
		return {
			environment: receipt,
			browser: {
				version: browser.version(),
				revision: pins.browser.revision,
				binarySha256,
				sandbox,
			},
			font: {
				sha256: font.sha256,
				postscriptName: font.postscriptName,
				platformFonts,
				glyphCounts: font.glyphCounts,
			},
			fixture: {
				svgSha256: sha256(svgBytes),
				profileSha256: sha256(fixtureBytes),
				widthMm: fixture.widthMm,
				heightMm: fixture.heightMm,
			},
			network: { mode: "offline", calibrationRequests: 0, probeDenied },
			metrics,
			inspection,
			artifacts: [
				"calibration.svg",
				"calibration.png",
				"calibration.pdf",
				"calibration.normalized.pdf",
			],
		};
	} finally {
		await browser.close();
	}
}

export async function verifyRuntime(outputDirectory: string) {
	const first = await renderCalibration(join(outputDirectory, "render-1"));
	const second = await renderCalibration(join(outputDirectory, "render-2"));
	requireCheck(
		first.inspection.pngPixelSha256 === second.inspection.pngPixelSha256 &&
			first.inspection.pdfNormalizedByteSha256 ===
				second.inspection.pdfNormalizedByteSha256 &&
			first.inspection.pdfSemanticSha256 ===
				second.inspection.pdfSemanticSha256,
		"DETERMINISM_FAILURE",
		"Repeat renders differ after documented normalization.",
	);
	return {
		first,
		second,
		repeat: {
			pngBytesEqual:
				first.inspection.pngByteSha256 === second.inspection.pngByteSha256,
			pngPixelsEqual: true,
			pdfNormalizedBytesEqual: true,
			pdfSemanticsEqual: true,
			pdfRawBytesEqual:
				first.inspection.pdfByteSha256 === second.inspection.pdfByteSha256,
			normalization:
				"PNG decoded RGBA; PDF reserialized after fixed creation/modification dates; PDF semantics only page geometry and NFC text, not visual equivalence.",
		},
	};
}
