import { readFile, readdir, stat } from "node:fs/promises";
import { chromium } from "playwright";
import { z } from "zod";
import type { ProductionRuntime } from "@jevelopers/shared-contracts";
import { assertEnvironment } from "../runtime/environment.js";
import { readResource, sha256 } from "../runtime/resources.js";
import { fingerprint } from "../composition/primitives.js";
import type { OutputPolicy } from "../exporters/private-policy.js";
import { pdfSemanticRevision } from "../exporters/private-pdf-semantic-identity.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import { requireCandidate, sha, same } from "./canonical-values.js";

async function implementationFiles(
	directory: URL,
	prefix = "",
	allFiles = false,
): Promise<readonly (readonly [string, string])[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: (readonly [string, string])[] = [];
	for (const entry of entries.sort((a, b) =>
		a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
	)) {
		const path = `${prefix}${entry.name}`;
		if (entry.isDirectory())
			files.push(
				...(await implementationFiles(
					new URL(`${entry.name}/`, directory),
					`${path}/`,
					allFiles,
				)),
			);
		else if (allFiles || entry.name.endsWith(".js")) {
			requireCandidate(entry.isFile(), "INTEGRITY_FAILURE", "integrity");
			files.push([
				path,
				sha256(await readFile(new URL(entry.name, directory))),
			]);
		}
	}
	return files;
}

async function dependencyCommitments() {
	const lock = z
		.object({
			packages: z.record(
				z.string(),
				z.object({
					dev: z.boolean().optional(),
					optional: z.boolean().optional(),
				}),
			),
		})
		.parse(JSON.parse((await readResource("package-lock.json")).toString()));
	const sources: (readonly [string, string])[] = [];
	for (const [path, metadata] of Object.entries(lock.packages).sort(
		([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
	)) {
		if (path === "" || metadata.dev === true) continue;
		requireCandidate(
			/^node_modules\/(?:@[a-z0-9_-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9_-]+\/)?[a-z0-9._-]+)*$/.test(
				path,
			) && !path.split("/").includes(".."),
			"INTEGRITY_FAILURE",
			"integrity",
		);
		const directory = new URL(
			`${path}/`,
			new URL("../../../", import.meta.url),
		);
		try {
			const info = await stat(directory);
			requireCandidate(info.isDirectory(), "INTEGRITY_FAILURE", "integrity");
		} catch (error) {
			if (
				metadata.optional === true &&
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				sources.push([path, "absent-optional"]);
				continue;
			}
			throw error;
		}
		const files = await implementationFiles(directory, "", true);
		sources.push([path, fingerprint(files)]);
	}
	return sources;
}

export async function measureCanonicalRuntime(policy: OutputPolicy) {
	const { pins, receipt } = await assertEnvironment();
	const binary = sha256(await readFile(chromium.executablePath()));
	const expectedBinary =
		receipt.platform === "darwin"
			? pins.browser.executableSha256.darwin
			: pins.browser.executableSha256.linux;
	requireCandidate(binary === expectedBinary, "HASH_MISMATCH", "integrity");
	const sourceFiles = await implementationFiles(
		new URL("../", import.meta.url),
	);
	const sourceDigest = sha(`sha256:${fingerprint(sourceFiles)}`);
	const securitySources = await Promise.all(
		[
			"page-renderer.mjs",
			"renderer-chroot.mjs",
			"renderer-root-identity.mjs",
			"seccomp-policy.mjs",
		].map(async (name) => [
			name,
			sha256(await readResource(`scripts/security/${name}`)),
		]),
	);
	const privateRendererDigest = sha(`sha256:${fingerprint(pins)}`);
	const dependencySources = await dependencyCommitments();
	const configuration = {
		policy,
		environment: receipt,
		binary,
		securitySources,
		dependencySources,
	};
	return {
		mapping_version: "canonical-private-runtime/v1" as const,
		source_digest: sourceDigest,
		private_renderer_digest: privateRendererDigest,
		browser_digest: sha(`sha256:${binary}`),
		renderer_commitment: sha(
			`sha256:${fingerprint({ role: "renderer", sourceDigest, privateRendererDigest, configuration })}`,
		),
		parser_commitment: sha(
			`sha256:${fingerprint({ role: "parser", sourceDigest, parser: pdfSemanticRevision, configuration })}`,
		),
		configuration,
	};
}
export type CanonicalRuntimeMeasurement = Awaited<
	ReturnType<typeof measureCanonicalRuntime>
>;

export async function resolveRuntimeRecord(
	runtime: CandidateRuntime,
	policy: OutputPolicy,
) {
	const ref = runtime.context.runtime.runtime_ref;
	requireCandidate(ref.contract === "ProductionRuntime", "INVALID_INPUT");
	const record: ProductionRuntime = await runtime.resolve({
		...ref,
		contract: "ProductionRuntime",
		schema_version: "1.0.0",
	});
	const measurement = await measureCanonicalRuntime(policy);
	requireCandidate(
		record.source_revision === runtime.host.producer.source_revision &&
			record.renderer_commitment === measurement.renderer_commitment &&
			record.parser_commitment === measurement.parser_commitment,
		"HASH_MISMATCH",
		"integrity",
	);
	const key = `runtime:${record.id}:${record.revision}`;
	const prior = runtime.state.get(key);
	requireCandidate(
		prior === null || same(prior, record),
		"HASH_MISMATCH",
		"integrity",
	);
	runtime.state.put(key, record);
	runtime.state.put(
		`runtime-mapping:${record.id}:${record.revision}`,
		measurement,
	);
	return { record, measurement };
}
