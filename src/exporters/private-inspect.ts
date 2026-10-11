import saxModule from "sax";
import { digest, fingerprint } from "../composition/primitives.js";
import { hash } from "../internal/durability.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import {
	artifactIdentityHash,
	verifyArtifactIdentity,
} from "../composition/private-model.js";
import { finalFileEvidence } from "../preflight/private-inspection.js";
import type { FinalFileEvidence } from "../preflight/private-inspection.js";
import { fileDescriptorSchema, requireOutput } from "./private-policy.js";
import type { OutputPolicy, FileDescriptor } from "./private-policy.js";
import type { OutputFile } from "../storage/local-store.js";
import { inspectPng } from "./private-png.js";
import { inspectPdf } from "./private-pdf.js";

export function inspectSvg(bytes: Uint8Array, artifact: PrivateArtifact) {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	requireOutput(text === artifact.svg, "OUTPUT_CONTENT", "svg.exactSource");
	const sax = saxModule.parser(true),
		names: string[] = [],
		images: string[] = [];
	sax.ondoctype = () => {
		requireOutput(false, "OUTPUT_INTEGRITY", "svg.doctype");
	};
	sax.onprocessinginstruction = () => {
		requireOutput(false, "OUTPUT_INTEGRITY", "svg.processingInstruction");
	};
	sax.onopentag = (node) => {
		requireOutput(
			[
				"svg",
				"defs",
				"style",
				"clipPath",
				"rect",
				"g",
				"image",
				"text",
				"ellipse",
			].includes(node.name),
			"OUTPUT_INTEGRITY",
			"svg.element",
		);
		names.push(node.name);
		for (const [key, raw] of Object.entries(node.attributes)) {
			const value = typeof raw === "string" ? raw : raw.value;
			requireOutput(
				!key.toLowerCase().startsWith("on"),
				"OUTPUT_INTEGRITY",
				"svg.event",
			);
			if (key === "href") {
				requireOutput(
					/^data:image\/(png|svg\+xml);base64,/.test(value),
					"OUTPUT_INTEGRITY",
					"svg.resource",
				);
				images.push(
					digest(Buffer.from(value.slice(value.indexOf(",") + 1), "base64")),
				);
			}
		}
	};
	sax.write(text).close();
	requireOutput(
		names[0] === "svg" &&
			images.length ===
				artifact.model.input.nodes.filter(
					(n) => n.visible && (n.kind === "artwork" || n.kind === "overlay"),
				).length &&
			images.every((h) => artifact.assets.some((a) => a.renderDigest === h)),
		"OUTPUT_INTEGRITY",
		"svg.assets",
	);
	return {
		semanticDigest: fingerprint({
			composition: artifact.compositionHash,
			images,
			texts: artifact.texts.map((t) => t.field.sourceDigest),
		}),
		images,
	};
}
export async function inspectOutputFiles(options: {
	readonly files: readonly OutputFile[];
	readonly artifact: PrivateArtifact;
	readonly policy: OutputPolicy;
	readonly pixelDigest: string;
}) {
	const { files, artifact, policy } = options;
	verifyArtifactIdentity(artifact);
	requireOutput(
		files.length === artifact.model.layout.exports.length &&
			new Set(files.map((f) => f.name)).size === files.length,
		"OUTPUT_INTEGRITY",
		"files.inventory",
	);
	const descriptors: FileDescriptor[] = [],
		evidence: FinalFileEvidence[] = [];
	for (const format of artifact.model.layout.exports) {
		const file = files.find((f) => f.name === `output.${format}`);
		requireOutput(
			file !== undefined &&
				file.length === file.bytes.length &&
				file.length <= policy.maxBytes &&
				file.digest === hash(file.bytes),
			"OUTPUT_INTEGRITY",
			`files.${format}`,
		);
		let semanticDigest: string, observation: unknown;
		switch (format) {
			case "svg":
				observation = inspectSvg(file.bytes, artifact);
				semanticDigest = fingerprint(observation);
				break;
			case "png":
				observation = inspectPng(file.bytes, {
					widthMm: artifact.model.layout.width,
					heightMm: artifact.model.layout.height,
					policy,
					pixelDigest: options.pixelDigest,
				});
				semanticDigest = fingerprint(observation);
				break;
			case "pdf":
				observation = await inspectPdf(file.bytes, artifact);
				semanticDigest = fingerprint(observation);
				break;
			default: {
				const unreachable: never = format;
				return unreachable;
			}
		}
		descriptors.push(
			fileDescriptorSchema.parse({
				name: file.name,
				format,
				mediaType:
					format === "svg"
						? "image/svg+xml"
						: format === "png"
							? "image/png"
							: "application/pdf",
				length: file.length,
				digest: file.digest,
				widthMm: artifact.model.layout.width,
				heightMm: artifact.model.layout.height,
				widthPx:
					format === "png"
						? Math.round((artifact.model.layout.width * policy.dpi) / 25.4)
						: null,
				heightPx:
					format === "png"
						? Math.round((artifact.model.layout.height * policy.dpi) / 25.4)
						: null,
				dpi: format === "png" ? policy.dpi : null,
				profile: "srgb",
				alpha: false,
				rasterArtwork: artifact.assets.some((a) => a.mime === "image/png"),
				text: format === "png" ? "rasterized" : "embedded",
				semanticDigest,
			}),
		);
		evidence.push(
			finalFileEvidence({
				format,
				compositionHash: artifact.compositionHash,
				renderHash: artifact.renderHash,
				artifactIdentityHash: artifactIdentityHash(artifact),
				svgDigest: digest(artifact.svg),
				fileDigest: digest(file.bytes),
				parserRevision:
					"private-output-inspector-1_sax-1.6.1_pngjs-7.0.0_pdf-lib-1.17.1_pdfjs-6.4.299",
				checks: ["dimensions", "content", "fonts", "container", "profile"].map(
					(name) => ({
						name,
						state: "passed",
						evidenceDigest: fingerprint({
							name,
							fileDigest: file.digest,
							observation,
						}),
					}),
				),
			}),
		);
	}
	return { descriptors, evidence };
}
