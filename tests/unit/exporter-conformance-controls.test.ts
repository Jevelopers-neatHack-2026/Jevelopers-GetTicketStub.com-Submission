import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { verifyExporterConformance } from "../../src/exporters/exporter-suite.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";
import { storageVerificationProbe } from "../fixtures/durability/storage-verification-probe.js";

for (const claim of [
	undefined,
	{ tests: 51, passed: 51, exitCode: 0 },
	{ mode: "local-exporter-adapter-conformance", accepted: true },
])
	test("rejects caller claims instead of accepting upstream execution", async () => {
		await assert.rejects(
			async () => Reflect.apply(verifyExporterConformance, undefined, [claim]),
			(error: unknown) =>
				error instanceof VerificationFailure &&
				error.code === "RUNTIME_FAILURE",
		);
	});

const faults = [
	"missing-test",
	"failing-canary",
	"false-canary",
	"stale-canary",
	"missing-evidence",
	"source-change",
	"build-change",
	"test-change",
	"tampered-payload",
	"canonical-false-canary",
	"canonical-stale-canary",
	"canonical-missing-evidence",
] as const;
for (const fault of faults)
	test(`named exporter CLI rejects ${fault} in a disposable compiled checkout`, {
		timeout: 300000,
	}, async () => {
		const root = await mkdtemp(join(tmpdir(), "pp-exporter-control-"));
		try {
			const probe = await storageVerificationProbe(root);
			const canary = join(
				probe.root,
				"dist/tests/fixtures/production-output/canary.js",
			);
			const prefix =
				"import {test} from 'node:test';import {readFileSync,writeFileSync,readdirSync,appendFileSync} from 'node:fs';import {join,dirname} from 'node:path';";
			const emit =
				"const d=process.env.PP_OUTPUT_EVIDENCE_DIR;const nonce=process.env.PP_DURABILITY_EXECUTION_NONCE;writeFileSync(join(d,'production-output-canary.json'),JSON.stringify({executed:true,executionNonce:nonce}));";
			let action = emit;
			switch (fault) {
				case "missing-test":
					await rm(
						join(
							probe.root,
							"dist/tests/unit/production-output-containers.test.js",
						),
					);
					break;
				case "failing-canary":
					action = "throw new Error('intentional canary failure');";
					break;
				case "false-canary":
					action = emit.replace("executed:true", "executed:false");
					break;
				case "stale-canary":
					action = emit.replace(
						"executionNonce:nonce",
						"executionNonce:'11111111-1111-4111-8111-111111111111'",
					);
					break;
				case "missing-evidence":
					action = "";
					break;
				case "source-change":
					action += `appendFileSync(${JSON.stringify(join(probe.root, "src/exporters/exporter-suite.ts"))},'\\n');`;
					break;
				case "build-change":
					action += `appendFileSync(${JSON.stringify(join(probe.root, "dist/src/exporters/exporter-evidence.js"))},'\\n');`;
					break;
				case "test-change":
					action += `appendFileSync(${JSON.stringify(join(probe.root, "dist/tests/unit/production-output-containers.test.js"))},'\\n');`;
					break;
				case "tampered-payload":
					action +=
						"if(d.includes('/canonical/')){const parent=dirname(dirname(d));const original=join(parent,readdirSync(parent).find(n=>n.startsWith('execution-')));appendFileSync(join(original,'output.png'),'tampered');}";
					break;
				case "canonical-false-canary":
					action = emit.replace(
						"executed:true",
						"executed:!d.includes('/canonical/')",
					);
					break;
				case "canonical-stale-canary":
					action = emit.replace(
						"executionNonce:nonce",
						"executionNonce:d.includes('/canonical/')?'11111111-1111-4111-8111-111111111111':nonce",
					);
					break;
				case "canonical-missing-evidence":
					action = `const d=process.env.PP_OUTPUT_EVIDENCE_DIR;if(!d.includes('/canonical/')){${emit}}`;
					break;
				default: {
					const unreachable: never = fault;
					throw new Error(String(unreachable));
				}
			}
			if (fault !== "missing-test")
				await writeFile(
					canary,
					`${prefix}test('exporter fault canary',()=>{${action}});`,
				);
			const directory = join(root, "evidence");
			await mkdir(directory);
			await writeFile(
				join(directory, "exporters.json"),
				JSON.stringify({ status: "passed", accepted: true }),
			);
			await writeFile(
				join(directory, "exporters-local.json"),
				JSON.stringify({
					state: "passed-private-mechanisms",
					conformance: { accepted: true },
				}),
			);
			const when = spawnSync(
				process.execPath,
				[
					probe.cli,
					"--suite",
					"exporters",
					"--mode",
					"offline",
					"--evidence-dir",
					directory,
				],
				{
					env: independentTestEnvironment(),
					encoding: "utf8",
					timeout: 290000,
				},
			);
			assert.ifError(when.error);
			assert.equal(when.status, 1, fault);
			const outer: unknown = JSON.parse(
				await readFile(join(directory, "exporters.json"), "utf8"),
			);
			assert.ok(
				typeof outer === "object" &&
					outer !== null &&
					"status" in outer &&
					outer.status === "failed",
			);
			const local = z
				.object({
					state: z.literal("failed-private-mechanisms"),
					failure: z.object({
						code: z.literal("RUNTIME_FAILURE"),
						message: z.string(),
					}),
					diagnostic: z.object({ reason: z.string() }).optional(),
				})
				.passthrough()
				.parse(
					JSON.parse(
						await readFile(join(directory, "exporters-local.json"), "utf8"),
					),
				);
			assert.ok(!("conformance" in local));
			switch (fault) {
				case "missing-test":
					assert.equal(local.diagnostic, undefined);
					assert.equal(
						local.failure.message,
						"Runtime operation failed; no unsanitized exception was recorded.",
					);
					break;
				case "failing-canary":
					assert.equal(local.diagnostic?.reason, "child-exit");
					break;
				case "false-canary":
				case "canonical-false-canary":
					assert.equal(local.diagnostic?.reason, "artifact-schema");
					break;
				case "missing-evidence":
				case "canonical-missing-evidence":
					assert.equal(local.diagnostic?.reason, "artifact-missing");
					break;
				case "stale-canary":
				case "canonical-stale-canary":
					assert.match(
						local.failure.message,
						/execution evidence changed or was replayed/,
					);
					break;
				case "source-change":
				case "build-change":
				case "test-change":
					assert.match(
						local.failure.message,
						/source\/build\/test custody changed/,
					);
					break;
				case "tampered-payload":
					assert.match(
						local.failure.message,
						/corpus payload is missing or tampered/,
					);
					break;
				default: {
					const unreachable: never = fault;
					throw new Error(String(unreachable));
				}
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
