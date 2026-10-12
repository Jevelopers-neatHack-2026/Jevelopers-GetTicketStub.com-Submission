import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";
import {
	exporterCanonicalTests,
	exporterOutputPaths,
} from "../../src/exporters/exporter-suite.js";
import { measureExporterEvidence } from "../../src/exporters/exporter-evidence.js";
import { hash } from "../../src/internal/durability.js";
import { assertPrivateExecution } from "../fixtures/production-output/dispatcher-proof.js";

test("named exporter CLI succeeds only with complete current local and supplied-manifest executions", {
	timeout: 300000,
}, async () => {
	const directory = await mkdtemp(join(tmpdir(), "pp-exporter-command-"));
	try {
		const when = spawnSync(
			process.execPath,
			[
				fileURLToPath(new URL("../../scripts/verify/cli.js", import.meta.url)),
				"--suite",
				"exporters",
				"--mode",
				"offline",
				"--evidence-dir",
				directory,
			],
			{ env: independentTestEnvironment(), encoding: "utf8", timeout: 290000 },
		);
		assert.ifError(when.error);
		assert.equal(when.status, 0, when.stderr);
		await assertPrivateExecution("exporters", directory);
		const outer = z
			.object({
				status: z.literal("passed"),
				result: z.object({
					mode: z.literal("local-exporter-adapter-conformance"),
					accepted: z.literal(false),
					live_integration: z.literal(false),
					handoff_eligibility: z.literal("unproven"),
					externalState: z.literal("external-blocked"),
					authority: z.literal("injected-test-host"),
					criteria: z.array(z.string()).length(6),
					source: z.object({
						git: z.object({
							revision: z.string(),
							tree: z.string(),
							state: z.enum(["clean", "dirty"]),
						}),
						digest: z.string(),
					}),
					build: z.object({
						digest: z.string(),
						gitCorrespondence: z.literal("unproven"),
					}),
					compiledTests: z.array(
						z.object({ path: z.string(), digest: z.string() }),
					),
					checks: z.object({
						output: z.object({
							tests: z.literal(51),
							passed: z.literal(51),
							executionNonce: z.string().uuid(),
						}),
						canonical: z.object({
							tests: z.literal(13),
							passed: z.literal(13),
							executionNonce: z.string().uuid(),
						}),
					}),
					evidence: z.object({ output: z.unknown(), canonical: z.unknown() }),
				}),
			})
			.parse(
				JSON.parse(await readFile(join(directory, "exporters.json"), "utf8")),
			);
		const local = z
			.object({ evidenceDir: z.string() })
			.parse(
				JSON.parse(
					await readFile(join(directory, "exporters-local.json"), "utf8"),
				),
			);
		assert.deepEqual(
			outer.result.evidence.output,
			await measureExporterEvidence(local.evidenceDir),
		);
		const canonicalParent = join(directory, "exporters/local/canonical");
		const { readdir } = await import("node:fs/promises");
		const execution = (await readdir(canonicalParent)).find((name) =>
			name.startsWith("execution-"),
		);
		assert.ok(execution);
		assert.deepEqual(
			outer.result.evidence.canonical,
			await measureExporterEvidence(join(canonicalParent, execution)),
		);
		assert.notEqual(
			outer.result.checks.output.executionNonce,
			outer.result.checks.canonical.executionNonce,
		);
		assert.equal(
			outer.result.source.git.revision,
			execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
		);
		assert.deepEqual(
			outer.result.compiledTests.map((f) => f.path),
			[
				...new Set([
					...exporterOutputPaths,
					...Object.keys(exporterCanonicalTests),
				]),
			].sort(),
		);
		for (const file of outer.result.compiledTests)
			assert.equal(
				file.digest,
				hash(
					await readFile(
						fileURLToPath(new URL(`../${file.path}`, import.meta.url)),
					),
				),
			);
		assert.ok(
			!(await readFile(join(directory, "exporters.json"), "utf8")).includes(
				directory,
			),
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
