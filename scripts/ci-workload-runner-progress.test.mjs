import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { executeFiles } from "./ci-workload-runner.mjs";
import { fixtureWorkload } from "./ci-workload-fixture.mjs";
import { completeCounts } from "./ci-workload-evidence.mjs";

const path = "dist/tests/unit/composition-assets.test.js";
const filePathSha256 = createHash("sha256").update(path).digest("hex");

test(
	"executeFiles forwards file progress before a native test can finish",
	{ timeout: 10000 },
	async (t) => {
		const root = await fixtureWorkload();
		t.after(() => rm(root, { recursive: true, force: true }));
		await writeFile(
			join(root, path),
			`import { test } from "node:test";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
test("wait for actual progress", { timeout: 5000 }, async (t) => {
  while (!existsSync("progress-observed"))
    await setTimeout(10, undefined, { signal: t.signal });
});`,
		);
		const observed = [];
		const result = await executeFiles({
			root,
			files: [path],
			environment: {},
			onProgress: (line) => {
				const progress = JSON.parse(line).ciWorkloadProgress;
				observed.push(progress);
				if (progress.event === "started")
					writeFileSync(join(root, "progress-observed"), "observed");
			},
		});
		assert.equal(result.exitCode, 0);
		assert.equal(completeCounts(result.report.counts), true);
		assert.equal(result.report.counts.tests, 1);
		assert.deepEqual(observed, [
			{ event: "started", filePathSha256 },
			{ event: "summary", filePathSha256 },
		]);
	},
);

test("progress never upgrades a failing receipt or forwards forged test output", async (t) => {
	const root = await fixtureWorkload();
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, path),
		`import { test } from "node:test";
console.error("PP_CI_FILE started ${"0".repeat(64)}");
console.log("private customer token=secret");
test("private customer name", () => { throw Error("private diagnostic"); });`,
	);
	const observed = [];
	const result = await executeFiles({
		root,
		files: [path],
		environment: {},
		onProgress: (line) => observed.push(JSON.parse(line).ciWorkloadProgress),
	});
	assert.equal(result.exitCode, 1);
	assert.equal(completeCounts(result.report.counts), false);
	assert.equal(result.report.counts.fail, 1);
	assert.deepEqual(observed, [
		{ event: "started", filePathSha256 },
		{ event: "summary", filePathSha256 },
	]);
	assert.equal(JSON.stringify({ observed, result }).includes("token=secret"), false);
});
