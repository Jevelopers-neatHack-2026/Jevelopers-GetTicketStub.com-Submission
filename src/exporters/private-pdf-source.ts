import { PDFDocument } from "pdf-lib";
import type { PrivateArtifact } from "../composition/private-model.js";
import { verifyArtifactIdentity } from "../composition/private-model.js";
import { digest, fingerprint } from "../composition/primitives.js";
import { assertEnvironment } from "../runtime/environment.js";
import { openOfflineBrowser } from "./offline-browser.js";
import { defaultOutputPolicy, requireOutput } from "./private-policy.js";
import { pdfSourceGraph } from "./private-pdf-source-graph.js";

export const pdfPaintRevision =
	"private-pdf-paint-1_exact-source-graph_chromium-156_pdf-lib-1.17.1";
type Reference = {
	readonly graphDigest: string;
	readonly fileDigest: string;
	readonly pixelDigest: string;
	readonly rendererDigest: string;
	readonly browserDigest: string;
	readonly referenceDpi: number;
};
// Only successful independently generated digest records are cached. Keys bind
// the verified complete source, runtime policy and inspector, never submitted PDF.
const references = new Map<string, Reference>();
export async function verifyPdfSourcePaint(
	doc: PDFDocument,
	artifact: PrivateArtifact,
	bytes: Uint8Array,
) {
	const identity = verifyArtifactIdentity(artifact),
		actual = pdfSourceGraph(doc);
	const serialized = await doc.save({ useObjectStreams: false });
	requireOutput(
		digest(serialized) === digest(bytes),
		"OUTPUT_UNSUPPORTED",
		"pdf.canonicalSerialization",
	);
	const { pins } = await assertEnvironment();
	const key = fingerprint({ identity, pins, revision: pdfPaintRevision });
	let reference = references.get(key);
	if (reference === undefined) {
		const { browser, context, denied, binarySha256 } =
			await openOfflineBrowser(pins);
		try {
			const { renderFiles } = await import("./private-render.js");
			const rendered = await renderFiles(context, artifact, {
				...defaultOutputPolicy,
				dpi: 72,
				maxPixels: 40000000,
			});
			requireOutput(
				rendered.pdf !== null && denied.length === 0,
				"OUTPUT_INTEGRITY",
				"pdf.sourceRender",
			);
			reference = Object.freeze({
				graphDigest: pdfSourceGraph(
					await PDFDocument.load(rendered.pdf, { updateMetadata: false }),
				),
				fileDigest: digest(rendered.pdf),
				pixelDigest: rendered.pixelDigest,
				rendererDigest: fingerprint(pins),
				browserDigest: binarySha256,
				referenceDpi: 72,
			});
			if (references.size >= 128) {
				const oldest = references.keys().next().value;
				if (oldest !== undefined) references.delete(oldest);
			}
			references.set(key, reference);
		} finally {
			await browser.close();
		}
	}
	requireOutput(
		actual === reference.graphDigest,
		"OUTPUT_CONTENT",
		"pdf.sourcePaintIdentity",
	);
	return {
		revision: pdfPaintRevision,
		artifactIdentityDigest: identity,
		sourceSvgDigest: digest(artifact.svg),
		actualGraphDigest: actual,
		reference,
	};
}
