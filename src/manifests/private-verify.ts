import {
	canonical,
	digest,
	digestSchema,
	fingerprint,
	parse,
} from "../composition/primitives.js";
import type { Digest } from "../composition/primitives.js";
import { z } from "zod";
import { recheckPermissions } from "../composition/private-model.js";
import { inspectOutputFiles } from "../exporters/private-inspect.js";
import { inspectArtifact } from "../preflight/private-inspection.js";
import type { ExportContext } from "../exporters/private-output.js";
import { outputFile, requireOutput } from "../exporters/private-policy.js";
import { inspectZip } from "../exporters/private-zip.js";
import { inventorySchema, sourceDescriptor } from "./private-inventory.js";
import type { OutputFile } from "../storage/local-store.js";
import { LocalArtifactStore } from "../storage/local-store.js";
import type { Id, Scope } from "../internal/durability.js";

export type ArchiveTrust = {
	readonly manifestDigest: Digest;
	readonly archiveDigest: Digest;
	readonly lineageDigest: Digest;
};
export async function verifyPrivateArchive(request: {
	readonly files: readonly OutputFile[];
	readonly trust: ArchiveTrust;
	readonly context: ExportContext;
}) {
	const { files, trust, context } = request;
	await recheckPermissions(
		context.artifact,
		context.ports,
		"export",
		context.now,
	);
	const manifest = files.find((f) => f.name === "private-inventory.json"),
		archive = files.find((f) => f.name === "archive.zip"),
		detached = files.find((f) => f.name === "detached.json");
	requireOutput(
		manifest !== undefined && archive !== undefined && detached !== undefined,
		"OUTPUT_INTEGRITY",
		"archive.required",
	);
	requireOutput(
		digest(manifest.bytes) === trust.manifestDigest &&
			digest(archive.bytes) === trust.archiveDigest,
		"OUTPUT_INTEGRITY",
		"archive.detachedTrust",
	);
	const inventory = parse(
		inventorySchema,
		JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes),
		),
	);
	requireOutput(
		canonical(inventory) === Buffer.from(manifest.bytes).toString() &&
			canonical(sourceDescriptor(context.artifact)) === inventory.source &&
			digest(inventory.source) === inventory.sourceDigest &&
			fingerprint(inventory.lineage) === trust.lineageDigest &&
			fingerprint(inventory.policy) === fingerprint(context.policy),
		"OUTPUT_INTEGRITY",
		"archive.lineage",
	);
	const detach = parse(
		z
			.object({
				privateDetachedVersion: z.literal(1),
				manifestDigest: digestSchema,
				archiveDigest: digestSchema,
				sourceDigest: digestSchema,
			})
			.strict(),
		JSON.parse(Buffer.from(detached.bytes).toString()),
	);
	requireOutput(
		detach.manifestDigest === trust.manifestDigest &&
			detach.archiveDigest === trust.archiveDigest &&
			detach.sourceDigest === inventory.sourceDigest,
		"OUTPUT_INTEGRITY",
		"archive.detached",
	);
	const names = [
		...inventory.files.map((f) => f.name),
		"private-inventory.json",
		"archive.zip",
		"detached.json",
	];
	requireOutput(
		files.length === names.length &&
			new Set(files.map((f) => f.name)).size === files.length &&
			files.every(
				(f) =>
					names.includes(f.name) &&
					f.length === f.bytes.length &&
					String(f.digest) === digest(f.bytes),
			),
		"OUTPUT_INTEGRITY",
		"archive.fileSet",
	);
	const payloads = inventory.files.map((d) => {
		const file = files.find((f) => f.name === d.name);
		requireOutput(
			file !== undefined &&
				String(file.digest) === d.digest &&
				file.length === d.length,
			"OUTPUT_INTEGRITY",
			"archive.payloadHash",
		);
		return outputFile(file.name, file.bytes);
	});
	await inspectZip(archive.bytes, [...payloads, manifest]);
	const observed = await inspectOutputFiles({
		files: payloads,
		artifact: context.artifact,
		policy: inventory.policy,
		pixelDigest: inventory.pixelDigest,
	});
	requireOutput(
		fingerprint(observed.descriptors) === fingerprint(inventory.files),
		"OUTPUT_INTEGRITY",
		"archive.descriptors",
	);
	const report = await inspectArtifact(
		context.artifact,
		context.constraints,
		context.ports,
		context.now,
		observed.evidence,
	);
	requireOutput(
		report.draftReady &&
			report.currentPermission === "allowed" &&
			report.reportHash === inventory.reportDigest &&
			report.constraintHash === inventory.constraintDigest,
		"OUTPUT_PREFLIGHT",
		"archive.report",
	);
	return {
		state: "completed" as const,
		readiness: "external-blocked" as const,
		handoffEligible: false as const,
		inventory,
		manifestDigest: trust.manifestDigest,
		archiveDigest: trust.archiveDigest,
	};
}
export async function retrievePrivateArchive(request: {
	readonly store: LocalArtifactStore;
	readonly scope: Scope;
	readonly publication: Id;
	readonly trust: ArchiveTrust;
	readonly context: ExportContext;
}) {
	requireOutput(
		fingerprint(request.scope) ===
			fingerprint(request.context.artifact.model.input.scope),
		"OUTPUT_INTEGRITY",
		"access.scope",
	);
	const stored = request.store.retrieve(request.scope, request.publication);
	return verifyPrivateArchive({
		files: stored.files,
		trust: request.trust,
		context: request.context,
	});
}
