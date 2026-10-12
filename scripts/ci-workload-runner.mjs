import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createProgressForwarder } from "./ci-workload-progress.mjs";
import { digest, selectGroup } from "./ci-workload-plan.mjs";
import {
	reportSchema,
	totals,
	testReceiptSchema,
} from "./ci-workload-evidence.mjs";

export async function executeFiles(options) {
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("NODE_TEST_"),
		),
	);
	assert.ok(!environment.NODE_OPTIONS, "Node option overrides are forbidden.");
	const started = performance.now();
	let stdout, stderr, exitCode;
	try {
		const execution = promisify(execFile)(
			process.execPath,
			[
				"--test",
				"--test-concurrency=1",
				`--test-reporter=${resolve(import.meta.dirname, "ci-workload-reporter.mjs")}`,
				...options.files,
			],
			{
				cwd: options.root,
				env: { ...environment, ...options.environment },
				maxBuffer: 4 * 1024 * 1024,
			},
		);
		execution.child.stderr?.on(
			"data",
			createProgressForwarder(
				options.onProgress ?? ((line) => process.stderr.write(line)),
			),
		);
		({ stdout, stderr } = await execution);
		exitCode = 0;
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.ok(
			typeof error.stdout === "string" && typeof error.stderr === "string",
			"Native test process did not produce a receipt.",
		);
		stdout = error.stdout;
		stderr = error.stderr;
		exitCode = Number.isInteger(error.code) && error.code > 0 ? error.code : 1;
	}
	const report = reportSchema.parse(JSON.parse(stdout));
	assert.deepEqual(report.counts, totals(report.files));
	return {
		report,
		exitCode,
		elapsedMs: Math.ceil(performance.now() - started),
		stdoutDigest: digest(stdout),
		stderrDigest: digest(stderr),
	};
}

export async function runGroup(options) {
	const { root, plan, request } = options;
	const selected = selectGroup(plan, request.group);
	const executionNonce = randomUUID();
	const directory = join(root, "out/ci-workload-private", executionNonce);
	await mkdir(directory, { recursive: true });
	const environment = Object.fromEntries(
		["OUTPUT", "COMPOSITION", "DURABILITY"].map((kind) => [
			`PP_${kind}_EVIDENCE_DIR`,
			join(directory, kind.toLowerCase()),
		]),
	);
	const executed = await executeFiles({
		root,
		files: selected.map((file) => file.path),
		environment,
	});
	const files = executed.report.files.sort((a, b) =>
		a.path.localeCompare(b.path, "en"),
	);
	assert.deepEqual(
		files.map((file) => file.path),
		selected.map((file) => file.path),
	);
	for (const [index, file] of files.entries()) {
		assert.equal(
			digest(await readFile(join(root, file.path))),
			selected[index].digest,
			"Compiled tests changed during execution.",
		);
		file.digest = selected[index].digest;
	}
	return testReceiptSchema.parse({
		request,
		unionDigest: plan.unionDigest,
		executionNonce,
		platform: process.platform,
		node: process.versions.node,
		exitCode: executed.exitCode,
		elapsedMs: executed.elapsedMs,
		stdoutDigest: executed.stdoutDigest,
		stderrDigest: executed.stderrDigest,
		files,
		counts: executed.report.counts,
	});
}
