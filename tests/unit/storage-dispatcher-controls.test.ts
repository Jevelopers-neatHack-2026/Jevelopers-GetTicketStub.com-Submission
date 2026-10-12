import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resource } from "../../src/runtime/resources.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";
import { fixture } from "../fixtures/durability/fixture.js";
import { storageVerificationProbe } from "../fixtures/durability/storage-verification-probe.js";

const canary = "tests/fixtures/durability/canary.js";
const probes = [
	[
		"missing canonical test",
		"tests/integration/canonical-production-idempotency.test.js",
		null,
	],
	["missing canary", canary, null],
	[
		"incomplete counts",
		canary,
		"import {test} from 'node:test';test('extra canary one',()=>{});test('extra canary two',()=>{});",
	],
	[
		"missing evidence",
		canary,
		"import {test} from 'node:test';test('canary without evidence',()=>{});",
	],
	[
		"stale evidence",
		canary,
		"import {test} from 'node:test';import {writeFileSync} from 'node:fs';test('stale canary',()=>{writeFileSync(`${process.env.PP_DURABILITY_EVIDENCE_DIR}/canary-executed.json`,JSON.stringify({executed:true,executionNonce:'stale'}));});",
	],
] as const;

for (const [name, path, replacement] of probes)
	test(`storage CLI rejects ${name} despite an earlier passing receipt`, {
		timeout: 30000,
	}, async () => {
		using f = fixture();
		const { root } = await storageVerificationProbe(f.root);
		const target = join(root, "dist", path);
		if (replacement === null) await rm(target);
		else await writeFile(target, replacement);
		const evidenceDir = join(f.root, "evidence");
		await mkdir(evidenceDir);
		for (const name of ["artifact-storage.json", "artifact-storage-local.json"])
			await writeFile(
				join(evidenceDir, name),
				JSON.stringify({
					status: "passed",
					state: "passed-private-mechanisms",
				}),
			);
		const result = spawnSync(
			process.execPath,
			[
				join(root, "dist/scripts/verify/cli.js"),
				"--suite",
				"artifact-storage",
				"--mode",
				"offline",
				"--evidence-dir",
				evidenceDir,
			],
			{ env: independentTestEnvironment(), timeout: 25000, encoding: "utf8" },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 1);
		const outer = z
			.object({
				status: z.literal("failed"),
				failure: z.object({ code: z.literal("RUNTIME_FAILURE") }),
			})
			.parse(
				JSON.parse(
					await readFile(join(evidenceDir, "artifact-storage.json"), "utf8"),
				),
			);
		assert.equal(outer.failure.code, "RUNTIME_FAILURE");
		const local = z
			.object({
				state: z.literal("failed-private-mechanisms"),
				diagnostic: z
					.object({
						reason: z.string(),
						counts: z.object({ tests: z.number().nullable() }),
					})
					.optional(),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(evidenceDir, "artifact-storage-local.json"),
						"utf8",
					),
				),
			);
		const reasons = {
			"incomplete counts": "counts",
			"missing evidence": "artifact-missing",
			"stale evidence": "artifact-schema",
		} as const;
		if (name === "missing canonical test" || name === "missing canary")
			assert.equal(local.diagnostic, undefined);
		else assert.equal(local.diagnostic?.reason, reasons[name]);
		if (name === "incomplete counts")
			assert.equal(local.diagnostic?.counts.tests, 81);
	});

for (const args of [
	[],
	["--suite", "unknown", "--mode", "offline", "--evidence-dir", "unused"],
])
	test(`storage command retains missing/unknown argument refusal for ${JSON.stringify(args)}`, () => {
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(resource("dist/scripts/verify/cli.js")), ...args],
			{
				env: independentTestEnvironment(),
				encoding: "utf8",
			},
		);
		assert.ifError(result.error);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /INVALID_ARGUMENTS/);
	});
