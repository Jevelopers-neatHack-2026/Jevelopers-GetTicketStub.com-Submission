import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	verifyProductionBundleFiles,
	parseProductionCanonicalBytes,
	productionArchiveLimits,
} from "@jevelopers/shared-contracts/production-operations";
import { contract, checked } from "../api/canonical-values.js";
import { hash } from "../internal/durability.js";
import type { runIndependentTests } from "../internal/independent-tests.js";
import { VerificationFailure } from "../runtime/errors.js";

const fileSchema = z.object({
	name: z
		.string()
		.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
		.refine((s) => !s.includes("..")),
	digest: z.string().regex(/^[a-f0-9]{64}$/),
	length: z.number().int().nonnegative().max(32000000),
});
const corpusSchema = z.object({
	artifacts: z.array(fileSchema).min(6).max(64),
});

// This inventories emitted evidence, not arbitrary SDK byte views. All reads create fresh Buffers.
export async function measureExporterEvidence(directory: string) {
	const files: {
		readonly path: string;
		readonly digest: string;
		readonly length: number;
	}[] = [];
	let total = 0;
	let entries = 0;
	async function walk(relative: string): Promise<void> {
		for (const entry of (
			await readdir(join(directory, relative), { withFileTypes: true })
		).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			const path = relative ? `${relative}/${entry.name}` : entry.name;
			entries += 1;
			if (entries > 4096 || path.split("/").length > 32)
				throw new VerificationFailure(
					"RUNTIME_FAILURE",
					"Exporter evidence inventory exceeds its finite bound.",
				);
			if (entry.isDirectory()) await walk(path);
			else {
				const size = (await lstat(join(directory, path))).size;
				if (
					!entry.isFile() ||
					size > 32000000 ||
					files.length >= 4096 ||
					total + size > 536870912
				)
					throw new VerificationFailure(
						"RUNTIME_FAILURE",
						"Exporter evidence requires bounded regular files.",
					);
				const bytes = await readFile(join(directory, path));
				if (bytes.length !== size)
					throw new VerificationFailure(
						"RUNTIME_FAILURE",
						"Exporter evidence length changed during measurement.",
					);
				total += bytes.length;
				files.push({ path, digest: hash(bytes), length: bytes.length });
			}
		}
	}
	await walk("");
	return {
		files,
		totalBytes: total,
		digest: hash(JSON.stringify(files)),
	} as const;
}

export async function requireExporterEvidence(
	result: Awaited<ReturnType<typeof runIndependentTests>>,
) {
	for (const artifact of result.artifacts) {
		const bytes = await readFile(join(result.evidenceDir, artifact.path));
		if (
			hash(bytes) !== artifact.digest ||
			!z
				.object({ executionNonce: z.literal(result.executionNonce) })
				.safeParse(JSON.parse(bytes.toString("utf8"))).success
		)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Exporter execution evidence changed or was replayed.",
			);
	}
	const canonical = result.artifacts.some(
		(a) => a.path === "canonical-exporter-proof.json",
	);
	const indexPath = canonical
		? "canonical-exporter-proof.json"
		: "corpus-index.json";
	const raw: unknown = JSON.parse(
		await readFile(join(result.evidenceDir, indexPath), "utf8"),
	);
	const index = corpusSchema.parse(raw);
	if (
		new Set(index.artifacts.map((f) => f.name)).size !== index.artifacts.length
	)
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Exporter corpus has duplicate names.",
		);
	const directory = canonical
		? join(result.evidenceDir, "bundle")
		: result.evidenceDir;
	const files = await Promise.all(
		index.artifacts.map(async (file) => {
			const bytes = await readFile(join(directory, file.name));
			if (bytes.length !== file.length || hash(bytes) !== file.digest)
				throw new VerificationFailure(
					"RUNTIME_FAILURE",
					"Exporter corpus payload is missing or tampered.",
				);
			return { filename: file.name, bytes };
		}),
	);
	if (canonical) {
		const proof = z
			.object({
				commitment: z.unknown(),
				integrity: z.literal("passed"),
				eligibility: z.literal("blocked"),
				byteRoute: z.literal("fresh-output-buffers-and-sqlite-reads"),
			})
			.parse(raw);
		const manifest = files.find((f) => f.filename === "manifest.json");
		if (!manifest)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Canonical supplied manifest evidence is missing.",
			);
		const bundle = checked(
			parseProductionCanonicalBytes(
				"ProductionBundle",
				"2.0.0",
				manifest.bytes,
				productionArchiveLimits.manifest_bytes,
			),
		);
		const verified = checked(
			verifyProductionBundleFiles(files, {
				scope: { tenant_id: bundle.tenant_id, project_id: bundle.project_id },
				trusted_commitment: contract("ProductionBundleRef", proof.commitment),
			}),
		);
		if (verified.integrity !== "passed" || verified.eligibility !== "blocked")
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Canonical byte proof must retain blocked eligibility.",
			);
	}
}
