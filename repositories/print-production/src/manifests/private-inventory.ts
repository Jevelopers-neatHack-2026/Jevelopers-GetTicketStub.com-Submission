import { z } from "zod";
import {
	canonical,
	digestSchema,
	fingerprint,
	parse,
} from "../composition/primitives.js";
import type { Digest } from "../composition/primitives.js";
import { verifyArtifactIdentity } from "../composition/private-model.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import {
	fileDescriptorSchema,
	outputPolicySchema,
	outputFile,
	requireOutput,
} from "../exporters/private-policy.js";
import { packZip, inspectZip } from "../exporters/private-zip.js";
import type { exportPrivateFiles } from "../exporters/private-output.js";
import { verifyPrivateExport } from "../exporters/private-output.js";
import type { ExportContext } from "../exporters/private-output.js";
import { inspectOutputFiles } from "../exporters/private-inspect.js";
import { inspectArtifact } from "../preflight/private-inspection.js";

export const lineageSchema = z
	.object({
		batchDigest: digestSchema.nullable(),
		rowDigest: digestSchema.nullable(),
		ordinal: z.number().int().nonnegative().nullable(),
		inputDigest: digestSchema,
		previewDigest: digestSchema.nullable(),
		repairPolicyDigest: digestSchema.nullable(),
		csvFileDigest: digestSchema.optional(),
		csvPolicyDigest: digestSchema.optional(),
		jobRef: z.string().uuid().optional(),
		rowOperationRef: z.string().uuid().optional(),
	})
	.strict()
	.readonly();
export type PrivateLineage = z.infer<typeof lineageSchema>;
export function sourceDescriptor(artifact: PrivateArtifact) {
	verifyArtifactIdentity(artifact);
	const input = artifact.model.input;
	return {
		scopeDigest: fingerprint(input.scope),
		design: { ref: input.designRef, digest: input.designDigest },
		facts: { ref: input.factsRef, digest: input.factsDigest },
		approval: { ref: input.approvalRef, digest: input.approvalDigest },
		artifactIdentityDigest: verifyArtifactIdentity(artifact),
		compositionDigest: artifact.compositionHash,
		renderDigest: artifact.renderHash,
		revision: artifact.revision,
		layoutDigest: fingerprint(artifact.model.layout),
		template: {
			ref: artifact.model.layout.id,
			revision: artifact.model.layout.revision,
		},
		sourceArtworkDigests: artifact.sourceArtworkHashes,
		assets: artifact.assets.map((a) => ({
			ref: a.binding.ref,
			revision: a.binding.version,
			sourceDigest: a.binding.digest,
			displayDigest: a.renderDigest,
			permissionRef: a.binding.permissionRef,
			mime: a.mime,
			width: a.width,
			height: a.height,
		})),
		fonts: artifact.model.fonts.map((f) => ({
			ref: f.ref,
			digest: f.digest,
			licenseDigest: f.licenseDigest,
			postscriptName: f.postscriptName,
			format: f.format,
		})),
		inputPolicyRevision: input.inputPolicyRevision,
		compositionRendererRevision: input.rendererRevision,
		repairReceipts: artifact.receipts,
		parent: artifact.parent,
	};
}
export const inventorySchema = z
	.object({
		privateInventoryVersion: z.literal(1),
		kind: z.literal("private-output-inventory"),
		sourceDigest: digestSchema,
		lineage: lineageSchema,
		policy: outputPolicySchema,
		rendererDigest: digestSchema,
		constraintDigest: digestSchema,
		reportDigest: digestSchema,
		pixelDigest: digestSchema,
		files: z.array(fileDescriptorSchema).min(1).max(3).readonly(),
		source: z.string().max(100000),
		finalReport: z.string().max(100000),
		localState: z.literal("completed"),
		readiness: z.literal("external-blocked"),
		handoffEligible: z.literal(false),
	})
	.strict()
	.readonly();
export type PrivateInventory = z.infer<typeof inventorySchema>;
export type PrivateArchive = {
	readonly inventory: PrivateInventory;
	readonly manifestDigest: Digest;
	readonly archiveDigest: Digest;
	readonly files: readonly import("../storage/local-store.js").OutputFile[];
};
export async function assemblePrivateArchive(
	exported: Awaited<ReturnType<typeof exportPrivateFiles>>,
	context: ExportContext,
	lineage: PrivateLineage,
): Promise<PrivateArchive> {
	verifyPrivateExport(exported);
	const artifact = context.artifact,
		source = sourceDescriptor(artifact),
		payloads = exported.files.map((f) => outputFile(f.name, f.bytes));
	const checked = await inspectOutputFiles({
		files: payloads,
		artifact,
		policy: context.policy,
		pixelDigest: exported.pixelDigest,
	});
	const report = await inspectArtifact(
		artifact,
		context.constraints,
		context.ports,
		context.now,
		checked.evidence,
	);
	requireOutput(
		fingerprint(checked.descriptors) === fingerprint(exported.descriptors) &&
			report.reportHash === exported.report.reportHash &&
			fingerprint(context.policy) === fingerprint(exported.policy),
		"OUTPUT_INTEGRITY",
		"inventory.exportBinding",
	);
	requireOutput(
		report.draftReady && report.currentPermission === "allowed",
		"OUTPUT_PREFLIGHT",
		"inventory.readiness",
	);
	const inventory = parse(inventorySchema, {
		privateInventoryVersion: 1,
		kind: "private-output-inventory",
		sourceDigest: fingerprint(source),
		source: canonical(source),
		lineage,
		policy: exported.policy,
		rendererDigest: exported.rendererDigest,
		constraintDigest: report.constraintHash,
		reportDigest: report.reportHash,
		pixelDigest: exported.pixelDigest,
		files: exported.descriptors,
		finalReport: canonical({
			reportVersion: report.reportVersion,
			ruleVersion: report.ruleVersion,
			reportDigest: report.reportHash,
			findingsDigest: report.findingsHash,
			checkedFiles: report.checkedFiles,
			findings: report.findings,
			modelReady: report.modelReady,
			filesReady: report.filesReady,
			currentPermission: report.currentPermission,
		}),
		localState: "completed",
		readiness: "external-blocked",
		handoffEligible: false,
	});
	const manifest = outputFile(
			"private-inventory.json",
			Buffer.from(canonical(inventory)),
		),
		archive = packZip(payloads, manifest);
	await inspectZip(archive.bytes, [...payloads, manifest]);
	const manifestDigest = digestSchema.parse(manifest.digest),
		archiveDigest = digestSchema.parse(archive.digest);
	const detached = outputFile(
		"detached.json",
		Buffer.from(
			canonical({
				privateDetachedVersion: 1,
				manifestDigest,
				archiveDigest,
				sourceDigest: inventory.sourceDigest,
			}),
		),
	);
	return {
		inventory,
		manifestDigest,
		archiveDigest,
		files: [...payloads, manifest, archive, detached],
	};
}
