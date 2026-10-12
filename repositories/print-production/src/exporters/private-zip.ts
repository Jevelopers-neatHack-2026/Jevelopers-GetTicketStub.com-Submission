import { zipSync } from "fflate";
import { fromBuffer } from "yauzl";
import type { Entry, ZipFile } from "yauzl";
import { crc32 } from "node:zlib";
import { z } from "zod";
import { requireOutput, outputFile } from "./private-policy.js";
import type { OutputFile } from "../storage/local-store.js";
import { hash } from "../internal/durability.js";

export const zipLimitsSchema = z
	.object({
		maxFiles: z.number().int().positive().max(1000),
		maxBytes: z.number().int().positive().max(64000000),
		maxEntryBytes: z.number().int().positive().max(32000000),
	})
	.strict()
	.readonly();
export type ZipLimits = z.infer<typeof zipLimitsSchema>;
export const defaultZipLimits: ZipLimits = {
	maxFiles: 64,
	maxBytes: 32000000,
	maxEntryBytes: 16000000,
};
export function safeZipPath(name: string): void {
	requireOutput(
		name.length > 0 &&
			name.length <= 128 &&
			/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) &&
			name
				.split("/")
				.every((s) => s.length > 0 && s !== "." && !s.includes("..")),
		"OUTPUT_INTEGRITY",
		"zip.path",
	);
}
export function packZip(
	payloads: readonly OutputFile[],
	manifest: OutputFile,
	limits: ZipLimits = defaultZipLimits,
): OutputFile {
	limits = zipLimitsSchema.parse(limits);
	const files = [...payloads, manifest].sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	);
	requireOutput(
		files.length > 0 &&
			files.length <= limits.maxFiles &&
			new Set(files.map((f) => f.name)).size === files.length,
		"OUTPUT_LIMIT",
		"zip.files",
	);
	let total = 0;
	const entries: Record<string, Uint8Array> = {};
	for (const file of files) {
		safeZipPath(file.name);
		total += file.length;
		requireOutput(
			file.length === file.bytes.length && hash(file.bytes) === file.digest,
			"OUTPUT_INTEGRITY",
			"zip.payload",
		);
		requireOutput(
			total <= limits.maxBytes && file.length <= limits.maxEntryBytes,
			"OUTPUT_LIMIT",
			"zip.bytes",
		);
		entries[file.name] = file.bytes;
	}
	const bytes = zipSync(entries, {
		level: 0,
		mtime: new Date("2000-01-01T00:00:00Z"),
		os: 3,
		attrs: 0o100644 << 16,
	});
	requireOutput(bytes.length <= limits.maxBytes, "OUTPUT_LIMIT", "zip.archive");
	return outputFile("archive.zip", bytes);
}
export async function inspectZip(
	bytes: Uint8Array,
	expected: readonly OutputFile[],
	limits: ZipLimits = defaultZipLimits,
): Promise<readonly OutputFile[]> {
	limits = zipLimitsSchema.parse(limits);
	requireOutput(
		bytes.length <= limits.maxBytes &&
			expected.length <= limits.maxFiles &&
			new Set(expected.map((f) => f.name)).size === expected.length,
		"OUTPUT_LIMIT",
		"zip.input",
	);
	const buffer = Buffer.from(bytes);
	const zip = await new Promise<ZipFile>((resolve, reject) =>
		fromBuffer(
			buffer,
			{ lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
			(error, value) => (error ? reject(error) : resolve(value)),
		),
	);
	const entries = await new Promise<readonly OutputFile[]>(
		(resolve, reject) => {
			const files: OutputFile[] = [];
			let total = 0;
			zip.on("error", reject);
			zip.on("end", () => resolve(files));
			zip.on("entry", (entry: Entry) => {
				void (async () => {
					safeZipPath(entry.fileName);
					requireOutput(
						files.length < limits.maxFiles &&
							!files.some((f) => f.name === entry.fileName) &&
							!entry.isEncrypted() &&
							entry.compressionMethod === 0 &&
							entry.externalFileAttributes >>> 16 === 0o100644,
						"OUTPUT_INTEGRITY",
						"zip.entry",
					);
					const e = expected.find((f) => f.name === entry.fileName);
					requireOutput(
						e !== undefined &&
							entry.uncompressedSize === e.length &&
							entry.uncompressedSize <= limits.maxEntryBytes,
						"OUTPUT_INTEGRITY",
						"zip.inventory",
					);
					total += entry.uncompressedSize;
					requireOutput(
						total <= limits.maxBytes,
						"OUTPUT_LIMIT",
						"zip.expansion",
					);
					const stream = await new Promise<import("node:stream").Readable>(
						(res, rej) =>
							zip.openReadStream(entry, (error, stream) =>
								error ? rej(error) : res(stream),
							),
					);
					const chunks: Buffer[] = [];
					let length = 0;
					for await (const raw of stream) {
						const chunk = z.instanceof(Buffer).parse(raw);
						length += chunk.length;
						requireOutput(
							length <= entry.uncompressedSize,
							"OUTPUT_LIMIT",
							"zip.stream",
						);
						chunks.push(chunk);
					}
					const data = Buffer.concat(chunks);
					requireOutput(
						length === e.length &&
							hash(data) === e.digest &&
							crc32(data) === entry.crc32,
						"OUTPUT_INTEGRITY",
						"zip.hash",
					);
					files.push(outputFile(entry.fileName, data));
					zip.readEntry();
				})().catch(reject);
			});
			zip.readEntry();
		},
	).finally(() => zip.close());
	requireOutput(
		entries.length === expected.length,
		"OUTPUT_INTEGRITY",
		"zip.fileSet",
	);
	const manifest = entries.at(-1);
	requireOutput(manifest !== undefined, "OUTPUT_INTEGRITY", "zip.empty");
	const canonical = packZip(entries.slice(0, -1), manifest, limits);
	requireOutput(
		Buffer.from(canonical.bytes).equals(buffer),
		"OUTPUT_INTEGRITY",
		"zip.canonicalContainer",
	);
	return entries;
}
