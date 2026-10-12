import { randomUUID } from "node:crypto";
import type { ArtifactFile } from "@jevelopers/shared-contracts";
import {
	checkProductionFile,
	productionArchiveLimits,
} from "@jevelopers/shared-contracts/production-operations";
import type { OutputFile } from "../storage/local-store.js";
import type { FileDescriptor } from "../exporters/private-policy.js";
import {
	byteHash,
	checked,
	requireCandidate,
	sha,
} from "../api/canonical-values.js";
import { nm } from "../api/canonical-layout.js";

export function canonicalFile(
	file: OutputFile,
	role: ArtifactFile["role"],
	descriptor?: FileDescriptor,
): ArtifactFile {
	const ceiling =
		role === "archive"
			? productionArchiveLimits.archive_bytes
			: role === "manifest"
				? productionArchiveLimits.manifest_bytes
				: role === "detached"
					? productionArchiveLimits.detached_bytes
					: productionArchiveLimits.entry_bytes;
	requireCandidate(
		file.length <= ceiling && file.bytes.byteLength === file.length,
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	return checked(
		checkProductionFile({
			contract: "ArtifactFile",
			schema_version: "2.0.0",
			policy_version: "1.0.0",
			artifact_id: randomUUID(),
			filename: file.name,
			role,
			byte_hash: byteHash(file.bytes),
			byte_size: file.length,
			media_type:
				descriptor?.mediaType ??
				(role === "archive" ? "application/zip" : "application/json"),
			geometry: descriptor
				? {
						width_nm: nm(descriptor.widthMm),
						height_nm: nm(descriptor.heightMm),
						width_px: descriptor.widthPx,
						height_px: descriptor.heightPx,
						effective_dpi: descriptor.dpi,
					}
				: null,
			profile_ref: null,
			characteristics: descriptor
				? {
						raster_artwork: descriptor.rasterArtwork,
						text: descriptor.text,
						vector_content: descriptor.format !== "png",
						alpha: descriptor.alpha,
					}
				: null,
			semantic_hash: descriptor
				? sha(`sha256:${descriptor.semanticDigest}`)
				: null,
		}),
	);
}
export function payloadBudget(
	files: readonly OutputFile[],
	host: { readonly maxFiles: number; readonly maxOutputBytes: number },
): void {
	requireCandidate(
		files.length <=
			Math.min(productionArchiveLimits.payloads, host.maxFiles - 3) &&
			files.every((f) => f.length <= productionArchiveLimits.entry_bytes) &&
			files.reduce((n, f) => n + f.length, 0) <=
				Math.min(productionArchiveLimits.payload_bytes, host.maxOutputBytes),
		"OUTPUT_UNSUPPORTED",
		"output",
	);
}
