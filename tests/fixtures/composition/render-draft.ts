import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PNG } from "pngjs";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { z } from "zod";
import type { PrivateArtifact } from "../../../src/composition/private-model.js";
import { recheckPermissions } from "../../../src/composition/private-model.js";
import type { CompositionPorts } from "../../../src/composition/private-model.js";
import { digest, fingerprint } from "../../../src/composition/primitives.js";
import { finalFileEvidence } from "../../../src/preflight/private-inspection.js";
import { assertEnvironment } from "../../../src/runtime/environment.js";
import { openOfflineBrowser } from "../../../src/exporters/offline-browser.js";
import { readResource } from "../../../src/runtime/resources.js";

const fontsSchema = z.object({
	fonts: z.array(
		z.object({
			postScriptName: z.string(),
			isCustomFont: z.boolean(),
			glyphCount: z.number(),
		}),
	),
});
export async function renderDraft(
	artifact: PrivateArtifact,
	ports: CompositionPorts,
	output: string,
) {
	await recheckPermissions(artifact, ports, "export", 1000);
	const { pins, receipt } = await assertEnvironment();
	for (const [name, expected] of [
		["sax", "1.6.1"],
		["@fontsource/noto-sans-arabic", "5.3.0"],
	] as const) {
		const metadata = z
			.object({ version: z.literal(expected) })
			.parse(
				JSON.parse(
					(await readResource(`node_modules/${name}/package.json`)).toString(),
				),
			);
		assert.equal(metadata.version, expected);
	}
	const { browser, context, denied, binarySha256, sandbox } =
		await openOfflineBrowser(pins);
	try {
		const { width, height } = artifact.model.layout,
			widthPx = Math.round((width * 96) / 25.4),
			heightPx = Math.round((height * 96) / 25.4);
		const page = await context.newPage();
		await page.setViewportSize({ width: widthPx, height: heightPx });
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
				[...document.querySelectorAll("image")].map(async (element) => {
					const image = new Image();
					image.src = element.getAttribute("href") ?? "";
					await image.decode();
				}),
			);
		});
		const metrics = await page.evaluate(() =>
			[...document.querySelectorAll("text")].map((text) => {
				const b = text.getBBox();
				return {
					id: text.id,
					value: text.textContent ?? "",
					advance: text.getComputedTextLength(),
					bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
					rect: text.getBoundingClientRect().toJSON(),
					font: text.getAttribute("font-family"),
				};
			}),
		);
		const expected = artifact.texts
			.flatMap((text) =>
				text.state === "measured"
					? text.lines.map((line) => ({ line, font: text.font }))
					: [],
			)
			.filter((row) => row.line.value.length > 0);
		assert.equal(
			metrics.filter((m) => m.value.length > 0).length,
			expected.length,
		);
		for (const [i, actual] of metrics
			.filter((m) => m.value.length > 0)
			.entries()) {
			const row = expected[i];
			assert.ok(row);
			assert.equal(actual.value, row.line.value);
			assert.equal(actual.font, `font-${row.font.digest}`);
			assert.ok(
				Math.abs(actual.advance - row.line.advance) < 0.03,
				`Independent shaping mismatch: ${actual.advance} vs ${row.line.advance}`,
			);
			assert.ok(
				Math.abs(actual.bounds.x - row.line.x) < 0.03,
				`Browser anchor mismatch: ${actual.bounds.x} vs ${row.line.x}`,
			);
			assert.ok(actual.bounds.width >= row.line.bounds.width - 0.05);
		}
		const cdp = await context.newCDPSession(page);
		const platformFonts = [];
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
				const actual = fontsSchema.parse(
					await cdp.send("CSS.getPlatformFontsForNode", { nodeId }),
				);
				const row = expected[i];
				assert.ok(row);
				assert.ok(actual.fonts.length > 0);
				assert.ok(
					actual.fonts.every(
						(f) =>
							f.isCustomFont &&
							f.postScriptName === row.font.postscriptName &&
							f.glyphCount > 0,
					),
				);
				platformFonts.push(actual.fonts);
			}
		} finally {
			await cdp.detach();
		}
		const png = await page.screenshot({ type: "png", animations: "disabled" }),
			pdf = await page.pdf({
				preferCSSPageSize: true,
				printBackground: true,
				displayHeaderFooter: false,
				tagged: false,
			});
		assert.equal(denied.length, 0);
		const decoded = PNG.sync.read(png);
		assert.equal(decoded.width, widthPx);
		assert.equal(decoded.height, heightPx);
		const ink = metrics.map((m) => {
			const rect = z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number(),
					height: z.number(),
				})
				.parse(m.rect);
			let count = 0;
			for (
				let y = Math.max(0, Math.floor(rect.y));
				y < Math.min(heightPx, Math.ceil(rect.y + rect.height));
				y++
			)
				for (
					let x = Math.max(0, Math.floor(rect.x));
					x < Math.min(widthPx, Math.ceil(rect.x + rect.width));
					x++
				)
					if ((decoded.data[(y * widthPx + x) * 4] ?? 255) < 100) count++;
			return count;
		});
		assert.ok(ink.every((count) => count > 10));
		const parsed = await PDFDocument.load(pdf, { updateMetadata: false });
		assert.equal(parsed.getPageCount(), 1);
		assert.ok(Math.abs(parsed.getPage(0).getWidth() - (width * 72) / 25.4) < 1);
		assert.ok(
			Math.abs(parsed.getPage(0).getHeight() - (height * 72) / 25.4) < 1,
		);
		const fontResources = parsed
			.getPage(0)
			.node.Resources()
			?.lookup(PDFName.of("Font"), PDFDict);
		assert.ok(fontResources);
		const embeddedFonts: string[] = [];
		for (const [, ref] of fontResources.entries()) {
			const font = parsed.context.lookup(ref, PDFDict),
				name = font.get(PDFName.of("BaseFont"));
			assert.ok(name instanceof PDFName);
			const ps = name.decodeText().replace(/^[A-Z]{6}\+/, "");
			assert.ok(artifact.model.fonts.some((f) => f.postscriptName === ps));
			const descriptor = font
				.lookup(PDFName.of("DescendantFonts"), PDFArray)
				.lookup(0, PDFDict)
				.lookup(PDFName.of("FontDescriptor"), PDFDict);
			const program = descriptor.lookup(PDFName.of("FontFile2"));
			assert.ok(
				program instanceof PDFRawStream && program.getContents().length > 0,
			);
			embeddedFonts.push(ps);
		}
		const task = getDocument({
			data: Uint8Array.from(pdf),
			useSystemFonts: false,
			disableFontFace: true,
		});
		let extracted: string[] = [];
		try {
			const parsedPdf = await task.promise;
			const content = await (await parsedPdf.getPage(1)).getTextContent();
			extracted = content.items.flatMap((item) =>
				"str" in item && item.str.length ? [item.str] : [],
			);
		} finally {
			await task.destroy();
		}
		const pdfContentExact = expected.every((row) =>
			extracted
				.join("")
				.normalize("NFC")
				.includes(row.line.value.normalize("NFC")),
		);
		const epoch = new Date("2000-01-01T00:00:00Z");
		parsed.setCreationDate(epoch);
		parsed.setModificationDate(epoch);
		const normalizedPdf = await parsed.save({ useObjectStreams: false });
		const outputDpi = Math.min(
			decoded.width / (width / 25.4),
			decoded.height / (height / 25.4),
		);
		const fileEvidence = ["svg", "png", "pdf"].map((format) =>
			finalFileEvidence({
				format,
				compositionHash: artifact.compositionHash,
				renderHash: artifact.renderHash,
				fileDigest: digest(
					format === "svg" ? artifact.svg : format === "png" ? png : pdf,
				),
				parserRevision: "fixture-draft-inspector-1",
				checks: ["dimensions", "content", "fonts", "container", "profile"].map(
					(name) => ({
						name,
						state:
							name === "profile"
								? "unknown"
								: format === "png" &&
										name === "dimensions" &&
										outputDpi < artifact.model.layout.minDpi
									? "failed"
									: format === "pdf" && name === "content" && !pdfContentExact
										? "failed"
										: "passed",
						evidenceDigest: fingerprint({
							format,
							name,
							metrics,
							ink,
							extracted,
							embeddedFonts,
							outputDpi,
						}),
					}),
				),
			}),
		);
		const evidence = {
			mode: "synthetic-draft-only",
			environment: receipt,
			browser: { binarySha256, sandbox },
			compositionHash: artifact.compositionHash,
			sourceArtworkHashes: artifact.sourceArtworkHashes,
			renderHash: artifact.renderHash,
			pixelHash: digest(decoded.data),
			normalizedPdfHash: digest(normalizedPdf),
			metrics,
			platformFonts,
			ink,
			extracted,
			pdfContentExact,
			embeddedFonts,
			outputDpi,
			networkRequests: denied.length,
			fileEvidence,
		};
		await mkdir(output, { recursive: true });
		await Promise.all([
			writeFile(join(output, "draft.svg"), artifact.svg),
			writeFile(join(output, "draft.png"), png),
			writeFile(join(output, "draft.pdf"), pdf),
			writeFile(join(output, "draft.normalized.pdf"), normalizedPdf),
			writeFile(
				join(output, "evidence.json"),
				JSON.stringify(evidence, null, 2),
			),
		]);
		return { ...evidence, png, pdf, normalizedPdf };
	} finally {
		await browser.close();
	}
}
