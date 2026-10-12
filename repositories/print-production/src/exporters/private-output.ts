import { z } from "zod";
import {
	recheckPermissions,
	verifyArtifactIdentity,
} from "../composition/private-model.js";
import type {
	CompositionPorts,
	PrivateArtifact,
} from "../composition/private-model.js";
import { freeze, fingerprint } from "../composition/primitives.js";
import { hash } from "../internal/durability.js";
import type { ResolvedConstraints } from "../templates/private-layout.js";
import { inspectArtifact } from "../preflight/private-inspection.js";
import { assertEnvironment } from "../runtime/environment.js";
import { readResource } from "../runtime/resources.js";
import { openOfflineBrowser } from "./offline-browser.js";
import { renderFiles } from "./private-render.js";
import { inspectOutputFiles } from "./private-inspect.js";
import {
	resolveOutputPolicy,
	outputFile,
	requireOutput,
} from "./private-policy.js";
import type { OutputPolicy } from "./private-policy.js";

export type ExportContext = {
	readonly artifact: PrivateArtifact;
	readonly constraints: ResolvedConstraints | null;
	readonly ports: CompositionPorts;
	readonly now: number;
	readonly policy: OutputPolicy;
};
const issuedExports = new WeakMap<object, string>();
function exportReceiptDigest(
	result: Awaited<ReturnType<typeof exportPrivateFiles>>,
): string {
	return fingerprint({
		files: result.files.map((f) => ({
			name: f.name,
			digest: f.digest,
			length: f.length,
			actual: hash(f.bytes),
		})),
		descriptors: result.descriptors,
		evidence: result.evidence,
		report: result.report,
		policy: result.policy,
		pixelDigest: result.pixelDigest,
		rendererDigest: result.rendererDigest,
		browser: result.browser,
		proof: result.proof,
	});
}
export function verifyPrivateExport(
	result: Awaited<ReturnType<typeof exportPrivateFiles>>,
): void {
	requireOutput(
		issuedExports.get(result) === exportReceiptDigest(result),
		"OUTPUT_INTEGRITY",
		"export.issuedReceipt",
	);
}
export async function exportPrivateFiles(request: ExportContext) {
	const artifact = freeze({ ...request.artifact }),
		policy = resolveOutputPolicy(request.policy);
	verifyArtifactIdentity(artifact);
	requireOutput(
		policy.dpi >=
			Math.max(artifact.model.layout.minDpi, request.constraints?.minDpi ?? 0),
		"OUTPUT_UNSUPPORTED",
		"dpi.minimum",
	);
	const initial = await inspectArtifact(
		artifact,
		request.constraints,
		request.ports,
		request.now,
	);
	requireOutput(
		initial.modelReady && initial.currentPermission === "allowed",
		"OUTPUT_PREFLIGHT",
		"model",
	);
	await recheckPermissions(artifact, request.ports, "export", request.now);
	const { pins, receipt } = await assertEnvironment();
	for (const [name, version] of [
		["sax", "1.6.1"],
		["pdfjs-dist", "6.4.299"],
		["csv-parse", "6.1.0"],
		["fflate", "0.8.2"],
		["yauzl", "3.2.0"],
	] as const)
		z.object({ version: z.literal(version) }).parse(
			JSON.parse(
				(await readResource(`node_modules/${name}/package.json`)).toString(),
			),
		);
	const { browser, context, denied, binarySha256, sandbox } =
		await openOfflineBrowser(pins);
	try {
		const rendered = await renderFiles(context, artifact, policy);
		requireOutput(denied.length === 0, "OUTPUT_INTEGRITY", "network");
		const files = artifact.model.layout.exports.map((format) => {
			switch (format) {
				case "svg":
					return outputFile("output.svg", Buffer.from(artifact.svg));
				case "png":
					return outputFile("output.png", rendered.png);
				case "pdf":
					requireOutput(
						rendered.pdf !== null,
						"OUTPUT_INTEGRITY",
						"pdf.missing",
					);
					return outputFile("output.pdf", rendered.pdf);
				default: {
					const unreachable: never = format;
					return unreachable;
				}
			}
		});
		const checked = await inspectOutputFiles({
			files,
			artifact,
			policy,
			pixelDigest: rendered.pixelDigest,
		});
		const report = await inspectArtifact(
			artifact,
			request.constraints,
			request.ports,
			request.now,
			checked.evidence,
		);
		requireOutput(
			report.draftReady && report.currentPermission === "allowed",
			"OUTPUT_PREFLIGHT",
			"finalFiles",
		);
		const result = {
			files,
			...checked,
			report,
			policy,
			pixelDigest: rendered.pixelDigest,
			proof: rendered.proof,
			environment: receipt,
			browser: { binarySha256, sandbox },
			rendererDigest: fingerprint(pins),
			networkRequests: denied.length,
			handoffEligible: false as const,
		};
		issuedExports.set(result, exportReceiptDigest(result));
		return result;
	} finally {
		await browser.close();
	}
}
