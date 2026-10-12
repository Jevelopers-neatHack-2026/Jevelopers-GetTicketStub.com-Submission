import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { suiteNames } from "../../scripts/verify/dispatcher.js";
import { assertPrivateExecution } from "../fixtures/production-output/dispatcher-proof.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";

let temporary: string,
	keep = false;
before(async () => {
	const parent = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	if (parent) await mkdir(join(parent, "named-cli"), { recursive: true });
	temporary = await mkdtemp(
		join(parent ? join(parent, "named-cli") : tmpdir(), "pp-output-cli-"),
	);
	keep = parent !== undefined;
});
after(async () => {
	if (!keep) await rm(temporary, { recursive: true, force: true });
});
function cli(args: readonly string[]) {
	const result = spawnSync(
		process.execPath,
		[
			fileURLToPath(new URL("../../scripts/verify/cli.js", import.meta.url)),
			...args,
		],
		{
			env: independentTestEnvironment(),
			encoding: "utf8",
			maxBuffer: 4 * 1024 * 1024,
		},
	);
	assert.ifError(result.error);
	return result;
}

test("fails every unimplemented suite when its registered CLI name is requested", async () => {
	// Given all pending mandatory leaves. When each CLI runs. Then none reports success.
	for (const suite of suiteNames.filter(
		(item) =>
			item !== "runtime" && item !== "artifact-storage" && item !== "release",
	)) {
		const directory = join(temporary, suite);
		const result = cli([
			"--suite",
			suite,
			"--mode",
			"offline",
			"--evidence-dir",
			directory,
		]);
		assert.equal(result.status, 1, suite);
		const evidence = JSON.parse(
			await readFile(join(directory, `${suite}.json`), "utf8"),
		);
		assert.equal(evidence.status, "failed");
		await assertPrivateExecution(suite, directory);
		assert.equal(evidence.failure.code, "SUITE_UNIMPLEMENTED", suite);
	}
});
test("aggregates real runtime evidence and pending leaves when release is requested", async () => {
	// Given incomplete external dependencies. When release runs. Then runtime passes and release fails.
	const directory = join(temporary, "release");
	const result = cli([
		"--suite",
		"release",
		"--mode",
		"offline",
		"--evidence-dir",
		directory,
	]);
	assert.equal(result.status, 1);
	const text = await readFile(join(directory, "release.json"), "utf8");
	const evidence = JSON.parse(text);
	assert.equal(evidence.failure.code, "RELEASE_INCOMPLETE");
	assert.equal(evidence.results.length, 16);
	assert.equal(evidence.results[0].status, "passed");
	assert.ok(
		evidence.results
			.slice(1)
			.filter((entry: { suite: string }) => entry.suite !== "artifact-storage")
			.every((entry: { status: string }) => entry.status === "failed"),
	);
	const storage = evidence.results.find(
		(entry: { suite: string }) => entry.suite === "artifact-storage",
	);
	assert.equal(storage.status, "passed");
	assert.equal(storage.result.mode, "local-storage-adapter-conformance");
	assert.equal(storage.result.accepted, false);
	assert.equal(storage.result.live_integration, false);
	assert.equal(storage.result.handoff_eligibility, "unproven");
	for (const suite of suiteNames)
		await assertPrivateExecution(suite, directory);
	assert.ok(
		evidence.results
			.slice(1)
			.filter((entry: { suite: string }) => entry.suite !== "artifact-storage")
			.every(
				(entry: { failure: { code: string } }) =>
					entry.failure.code === "SUITE_UNIMPLEMENTED",
			),
	);
	assert.deepEqual(evidence.externalPins, {
		sharedContracts: null,
		supplierSpecification: null,
		appConsumer: null,
		financeConsumer: null,
	});
	assert.ok(!text.includes(temporary) && !text.includes(process.cwd()));
});
