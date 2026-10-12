import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { verifyStorageConformance } from "../../src/exporters/storage-suite.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import {
	independentTestEnvironment,
	runIndependentTests,
	durabilityTestFiles,
	durabilityExpectedTests,
	durabilityProcessEvidence,
} from "../../src/internal/independent-tests.js";
import { fixture } from "../fixtures/durability/fixture.js";
import { storageVerificationProbe } from "../fixtures/durability/storage-verification-probe.js";

for (const label of ["fabricated", "replayed"])
	test(`conformance rejects a ${label} caller result instead of adopting its claimed execution`, async () => {
		using f = fixture();
		const supplied =
			label === "replayed"
				? await runIndependentTests({
						paths: [
							...durabilityTestFiles["artifact-storage"],
							"fixtures/durability/canary.js",
						].map((path) =>
							fileURLToPath(new URL(`../${path}`, import.meta.url)),
						),
						evidenceDir: f.root,
						expectedTests: durabilityExpectedTests["artifact-storage"] + 1,
						requiredEvidence: [
							...durabilityProcessEvidence,
							"canary-executed.json",
						],
					})
				: {
						command: [],
						exitCode: 0,
						tests: 80,
						passed: 80,
						expectedTests: 80,
						artifacts: [],
						executionNonce: label,
						evidenceDir: f.root,
					};
		await assert.rejects(
			async () =>
				Reflect.apply(verifyStorageConformance, undefined, [supplied, f.root]),
			(error: unknown) =>
				error instanceof VerificationFailure &&
				error.code === "RUNTIME_FAILURE",
		);
	});

for (const target of [
	"dist/src/storage/local-store.js",
	"dist/tests/unit/durability-storage.test.js",
	"src/exporters/storage-suite.ts",
])
	test(`named CLI invalidates changed ${target} custody during the original phase`, {
		timeout: 30000,
	}, async () => {
		using f = fixture();
		const probe = await storageVerificationProbe(f.root);
		await writeFile(
			probe.canary,
			`import {test} from 'node:test';import {appendFileSync} from 'node:fs';import {evidence} from './evidence.js';test('custody fault canary',()=>{evidence('canary-executed',{executed:true});appendFileSync(${JSON.stringify(join(probe.root, target))},'\\n');});`,
		);
		const directory = join(f.root, "evidence");
		const result = spawnSync(
			process.execPath,
			[
				probe.cli,
				"--suite",
				"artifact-storage",
				"--mode",
				"offline",
				"--evidence-dir",
				directory,
			],
			{ env: independentTestEnvironment(), encoding: "utf8", timeout: 25000 },
		);
		assert.ifError(result.error);
		assert.equal(result.status, 1);
		const local = z
			.object({
				state: z.literal("failed-private-mechanisms"),
				failure: z.object({
					code: z.literal("RUNTIME_FAILURE"),
					message: z.literal(
						"Storage source/build/test custody changed during execution.",
					),
				}),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(directory, "artifact-storage-local.json"),
						"utf8",
					),
				),
			);
		assert.equal(local.failure.code, "RUNTIME_FAILURE");
	});

test("named CLI refuses original evidence altered during the canonical phase even with its genuine nonce", {
	timeout: 360000,
}, async () => {
	using f = fixture();
	const probe = await storageVerificationProbe(f.root);
	await writeFile(
		probe.canary,
		`import {test} from 'node:test';import {readFileSync,writeFileSync,readdirSync} from 'node:fs';import {join,dirname} from 'node:path';import {evidence} from './evidence.js';test('evidence custody fault canary',()=>{evidence('canary-executed',{executed:true});const d=process.env.PP_DURABILITY_EVIDENCE_DIR;if(d.includes('/canonical/')){const root=dirname(dirname(d));const p=join(root,readdirSync(root).find(n=>n.startsWith('execution-')),'storage-process-race.json');const v=JSON.parse(readFileSync(p,'utf8'));v.tampered=true;writeFileSync(p,JSON.stringify(v));}});`,
	);
	const directory = join(f.root, "evidence");
	const result = spawnSync(
		process.execPath,
		[
			probe.cli,
			"--suite",
			"artifact-storage",
			"--mode",
			"offline",
			"--evidence-dir",
			directory,
		],
		{ env: independentTestEnvironment(), encoding: "utf8", timeout: 350000 },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 1);
	const local = z
		.object({
			state: z.literal("failed-private-mechanisms"),
			failure: z.object({
				message: z.literal(
					"Storage execution evidence changed or was replayed.",
				),
			}),
		})
		.parse(
			JSON.parse(
				await readFile(join(directory, "artifact-storage-local.json"), "utf8"),
			),
		);
	assert.match(local.failure.message, /evidence changed/);
});

test("custody measurements explicitly label unavailable Git without substituting the parent repository", async () => {
	using f = fixture();
	const probe = await storageVerificationProbe(f.root);
	const path = join(probe.root, "measure.mjs");
	await writeFile(
		path,
		`import {measureStorageCustody} from './dist/src/exporters/storage-custody.js';const v=await measureStorageCustody(['fixtures/durability/canary.js']);console.log(JSON.stringify(v.source.git));`,
	);
	const result = z
		.object({
			state: z.literal("unavailable"),
			revision: z.null(),
			tree: z.null(),
			statusDigest: z.null(),
		})
		.parse(
			JSON.parse(
				execFileSync(process.execPath, [path], {
					env: independentTestEnvironment(),
					encoding: "utf8",
					timeout: 25000,
				}),
			),
		);
	assert.equal(result.revision, null);
});
