import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runIndependentTests } from "../../src/internal/independent-tests.js";
import { IndependentTestFailure } from "../../src/internal/independent-diagnostics.js";

const canary = fileURLToPath(
	new URL("../fixtures/durability/canary.js", import.meta.url),
);
for (const [id, extra, expected] of [
	[
		"child-exit",
		{ environment: { ...process.env, PP_DURABILITY_CANARY_FAIL: "1" } },
		1,
	],
	["counts", {}, 2],
	["artifact-missing", {}, 1],
] as const)
	test(`records finite ${id} classification while preserving nonvacuous rejection`, async () => {
		const root = await mkdtemp(join(tmpdir(), "pp-runner-diag-"));
		try {
			await assert.rejects(
				runIndependentTests({
					paths: [canary],
					evidenceDir: root,
					expectedTests: expected,
					requiredEvidence: [
						id === "artifact-missing"
							? "missing-private-name-token.json"
							: "canary-executed.json",
					],
					...extra,
				}),
				(e) => {
					assert.ok(e instanceof IndependentTestFailure);
					assert.equal(e.diagnostic.reason, id);
					assert.equal(e.diagnostic.counts["tests"], 1);
					assert.ok(e.diagnostic.stdoutDigest.length === 64);
					assert.equal(
						JSON.stringify(e.diagnostic).includes("missing-private-name-token"),
						false,
					);
					return true;
				},
			);
			const dirs = await readdir(root);
			const dir = dirs.find((d) => d.startsWith("execution-"));
			assert.ok(dir);
			const raw = await readFile(
				join(root, dir, "independent-failure.json"),
				"utf8",
			);
			assert.equal(
				raw.includes("INTENTIONAL_DURABILITY_CANARY_FAILURE"),
				false,
			);
			assert.ok(JSON.parse(raw).executionNonce);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
test("hashes sensitive failing test labels without retaining arbitrary stderr or exception text", async () => {
	const root = await mkdtemp(join(tmpdir(), "pp-runner-privacy-"));
	try {
		const path = join(root, "case.test.mjs"),
			secret = "arbitrary-customer-name-token-secret";
		await writeFile(
			path,
			`import {test} from 'node:test';test('${secret}',()=>{throw new Error('${secret}');});`,
		);
		await assert.rejects(
			runIndependentTests({
				paths: [path],
				evidenceDir: root,
				expectedTests: 1,
				requiredEvidence: [],
			}),
			(e) => {
				assert.ok(e instanceof IndependentTestFailure);
				assert.equal(e.diagnostic.reason, "child-exit");
				assert.equal(e.diagnostic.failures.length, 1);
				assert.equal(JSON.stringify(e.diagnostic).includes(secret), false);
				return true;
			},
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
