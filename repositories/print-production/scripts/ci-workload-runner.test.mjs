import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { executeFiles } from "./ci-workload-runner.mjs";
import { fixtureWorkload } from "./ci-workload-fixture.mjs";
import { completeCounts } from "./ci-workload-evidence.mjs";

for (const fault of [
	"failure",
	"skip",
	"todo",
	"zero",
	"cancelled",
	"child-canary",
]) {
	test(`keeps native failure evidence when ${fault} occurs`, async (t) => {
		const root = await fixtureWorkload();
		t.after(() => rm(root, { recursive: true, force: true }));
		const path = "dist/tests/unit/composition-assets.test.js";
		const cases = {
			failure:
				"test('fails',()=>{throw Error('private customer token=secret')});",
			skip: "test('skips',{skip:true},()=>{});",
			todo: "test('pending',{todo:true},()=>{});",
			zero: "",
			cancelled: "test('deadline',{timeout:10},()=>new Promise(()=>{}));",
			"child-canary":
				"import {spawnSync} from 'node:child_process'; test('propagates canary',()=>{const r=spawnSync(process.execPath,['--test','dist/tests/unit/canary.test.js'],{env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('NODE_TEST_')))}); if(r.status!==0) throw Error('child failed');});",
		};
		if (fault === "child-canary")
			await writeFile(
				join(root, "dist/tests/unit/canary.test.js"),
				"import {test} from 'node:test'; test('canary',()=>{throw Error('deliberate')});",
			);
		await writeFile(
			join(root, path),
			`import {test} from 'node:test'; console.log('private customer token=secret'); ${cases[fault]}`,
		);
		if (fault === "zero") {
			await assert.rejects(
				executeFiles({ root, files: [path], environment: {} }),
			);
			return;
		}
		const result = await executeFiles({ root, files: [path], environment: {} });
		assert.equal(completeCounts(result.report.counts), false);
		assert.equal(JSON.stringify(result).includes("token=secret"), false);
		assert.equal(result.report.files.length, 1);
		assert.equal(result.report.files[0].path, path);
		if (["failure", "cancelled", "child-canary"].includes(fault))
			assert.equal(result.exitCode, 1);
	});
}

test("records exact native counts and output digests when all files pass", async (t) => {
	const root = await fixtureWorkload();
	t.after(() => rm(root, { recursive: true, force: true }));
	const result = await executeFiles({
		root,
		files: [
			"dist/tests/unit/composition-assets.test.js",
			"dist/tests/contract/public-entry.test.js",
		],
		environment: {},
	});
	assert.deepEqual(result.report.counts, {
		tests: 446,
		pass: 446,
		fail: 0,
		cancelled: 0,
		skipped: 0,
		todo: 0,
	});
	assert.equal(result.exitCode, 0);
	assert.equal(result.report.files.length, 2);
});
