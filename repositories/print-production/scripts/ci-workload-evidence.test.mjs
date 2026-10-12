import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { groups, workloadPlan, selectGroup } from "./ci-workload-plan.mjs";
import { executeFiles } from "./ci-workload-runner.mjs";
import {
	aggregateReceipts,
	validateGroup,
	phaseNames,
} from "./ci-workload-evidence.mjs";
import { fixtureWorkload } from "./ci-workload-fixture.mjs";

let root, plan, values;
const request = {
	group: "aggregate",
	revision: "a".repeat(40),
	runId: "1",
	attempt: "1",
};
before(async () => {
	root = await fixtureWorkload();
	plan = await workloadPlan(root);
	values = [];
	for (const group of groups) {
		const selected = selectGroup(plan, group);
		const run = await executeFiles({
			root,
			files: selected.map((file) => file.path),
			environment: {},
		});
		values.push({
			tests: {
				request: { ...request, group },
				unionDigest: plan.unionDigest,
				executionNonce: randomUUID(),
				platform: "linux",
				node: "24.21.0",
				exitCode: run.exitCode,
				elapsedMs: run.elapsedMs,
				stdoutDigest: run.stdoutDigest,
				stderrDigest: run.stderrDigest,
				files: run.report.files
					.sort((a, b) => a.path.localeCompare(b.path, "en"))
					.map((file, index) => ({ ...file, digest: selected[index].digest })),
				counts: run.report.counts,
			},
			phases: phaseNames.map((name) => ({ name, exitCode: 0 })),
		});
	}
});
after(async () => rm(root, { recursive: true, force: true }));

test("aggregates exhaustive real native fixture counts when the receipt union matches", () => {
	const result = aggregateReceipts(plan, request, values);
	assert.deepEqual(result.counts, {
		tests: 492,
		pass: 492,
		fail: 0,
		cancelled: 0,
		skipped: 0,
		todo: 0,
	});
	assert.equal(result.files.length, 48);
	assert.equal(result.passed, true);
});

for (const fault of [
	"missing-group",
	"duplicate-group",
	"omitted-file",
	"overlap",
	"stale-revision",
	"stale-attempt",
	"stale-run",
	"macos",
	"reused-nonce",
	"altered-digest",
	"wrong-count",
	"zero-file",
	"missing-phase",
	"extra-field",
]) {
	test(`rejects incomplete or stale evidence when ${fault} occurs`, () => {
		const input = structuredClone(values);
		switch (fault) {
			case "missing-group":
				input.pop();
				break;
			case "duplicate-group":
				input[1] = input[0];
				break;
			case "omitted-file":
				input[2].tests.files.pop();
				break;
			case "overlap":
				input[2].tests.files.push(input[0].tests.files[0]);
				break;
			case "stale-revision":
				input[0].tests.request.revision = "b".repeat(40);
				break;
			case "stale-attempt":
				input[0].tests.request.attempt = "2";
				break;
			case "stale-run":
				input[0].tests.request.runId = "2";
				break;
			case "macos":
				input[0].tests.platform = "darwin";
				break;
			case "reused-nonce":
				input[1].tests.executionNonce = input[0].tests.executionNonce;
				break;
			case "altered-digest":
				input[0].tests.files[0].digest = "0".repeat(64);
				break;
			case "wrong-count":
				input[0].tests.counts.tests++;
				break;
			case "zero-file":
				input[0].tests.files[0].counts.tests = 0;
				break;
			case "missing-phase":
				input[0].phases.pop();
				break;
			case "extra-field":
				input[0].tests.files[0].rawError = "secret";
				break;
			default:
				assert.fail("Unhandled evidence fault.");
		}
		assert.throws(() => aggregateReceipts(plan, request, input));
	});
}

for (const fault of ["phase", "exit", "test", "skip"]) {
	test(`propagates failure without masking group counts when ${fault} fails`, () => {
		const input = structuredClone(values);
		switch (fault) {
			case "phase":
				input[0].phases[0].exitCode = 1;
				break;
			case "exit":
				input[0].tests.exitCode = 1;
				break;
			case "test":
				input[0].tests.files[0].success = false;
				break;
			case "skip":
				input[0].tests.files[0].counts.pass--;
				input[0].tests.files[0].counts.skipped++;
				input[0].tests.counts = { ...input[0].tests.files[0].counts };
				break;
			default:
				assert.fail("Unhandled failure fault.");
		}
		assert.equal(aggregateReceipts(plan, request, input).passed, false);
		assert.equal(validateGroup(plan, input[0]).tests.counts.tests, 1);
	});
}
