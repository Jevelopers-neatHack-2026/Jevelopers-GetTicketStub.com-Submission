import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
	createProgressEmitter,
	createProgressForwarder,
} from "./ci-workload-progress.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const wire = (kind, hash) => `PP_CI_FILE ${kind} ${hash}\n`;
const root = resolve("synthetic-root");
const path = "dist/tests/unit/private-name.test.js";
const file = join(root, path);

// These events are deliberately synthetic; the native process check is below.
test("emits only one path digest per file boundary and preserves entry-file identity", () => {
	const output = [];
	const emit = createProgressEmitter((line) => output.push(line), root);
	const data = {
		entryFile: file,
		file: join(root, "private imported source"),
		name: "private customer token=secret",
	};
	for (let i = 0; i < 10; i++) emit({ type: "test:dequeue", data });
	emit({ type: "test:summary", data });
	emit({ type: "test:summary", data });
	assert.deepEqual(output, [
		wire("started", digest(path)),
		wire("summary", digest(path)),
	]);
	assert.equal(output.join("").includes("private"), false);
	assert.equal(output.join("").includes("token=secret"), false);
});

test("ignores raw output, names, failures and global or missing-file summaries", () => {
	const output = [];
	const emit = createProgressEmitter((line) => output.push(line), root);
	for (const type of [
		"test:stdout",
		"test:stderr",
		"test:fail",
		"test:enqueue",
	])
		emit({
			type,
			data: {
				file,
				name: "secret",
				message: wire("started", "0".repeat(64)),
			},
		});
	for (const value of [undefined, null, 1, {}, ""])
		emit({ type: "test:summary", data: { file: value } });
	emit({ type: "test:summary" });
	assert.deepEqual(output, []);
});

test("a file summary is diagnostic and does not claim success or completion of the union", () => {
	const output = [];
	const emit = createProgressEmitter((line) => output.push(line), root);
	emit({ type: "test:summary", data: { file, success: false } });
	const second = "dist/tests/unit/other.test.js";
	emit({ type: "test:dequeue", data: { file: join(root, second) } });
	assert.deepEqual(output, [
		wire("summary", digest(path)),
		wire("started", digest(second)),
	]);
	assert.equal(output.join("").includes("success"), false);
});

test("forwards every split of a valid record without forwarding the wire prefix", () => {
	const input = wire("started", digest(path));
	for (let split = 0; split <= input.length; split++) {
		const output = [];
		const forward = createProgressForwarder((line) => output.push(line));
		forward(Buffer.from(input.slice(0, split)));
		forward(Buffer.from(input.slice(split)));
		assert.deepEqual(
			output.map((line) => JSON.parse(line)),
			[
				{
					ciWorkloadProgress: {
						event: "started",
						filePathSha256: digest(path),
					},
				},
			],
		);
	}
});

test("drops malformed records and private text while retaining subsequent valid records", () => {
	const output = [];
	const forward = createProgressForwarder((line) => output.push(line));
	for (const line of [
		"private customer token=secret\n",
		wire("passed", digest(path)),
		wire("started", "Z".repeat(64)),
		` ${wire("started", digest(path))}`,
		wire("started", digest(path)).replace("\n", " extra\n"),
		"PP_CI_FILE started /private/path\n",
	])
		forward(Buffer.from(line));
	forward(Buffer.from(wire("summary", digest(path))));
	assert.equal(output.length, 1);
	assert.equal(JSON.parse(output[0]).ciWorkloadProgress.event, "summary");
	assert.equal(output.join("").includes("private"), false);
});

test("bounds unfinished lines and never accepts a valid-looking suffix of an oversized line", () => {
	const output = [];
	const forward = createProgressForwarder((line) => output.push(line));
	forward(Buffer.alloc(1024 * 1024, 120));
	forward(Buffer.from(wire("started", digest(path))));
	forward(Buffer.from(wire("summary", digest(path))));
	assert.equal(output.length, 1);
	assert.equal(JSON.parse(output[0]).ciWorkloadProgress.event, "summary");
});

test("does not treat an unterminated or interrupted record as evidence", () => {
	const output = [];
	const forward = createProgressForwarder((line) => output.push(line));
	forward(Buffer.from(wire("started", digest(path)).trimEnd()));
	assert.deepEqual(output, []);
});

test("handles multiple records and rejects embedded control characters", () => {
	const output = [];
	const forward = createProgressForwarder((line) => output.push(line));
	forward(
		Buffer.from(
			`\u0000${wire("started", digest(path))}${wire("started", digest(path))}${wire("summary", digest(path))}`,
		),
	);
	assert.deepEqual(
		output.map((line) => JSON.parse(line).ciWorkloadProgress.event),
		["started", "summary"],
	);
});

test("native reporter exposes progress before exit and keeps forged test stderr private", {
	timeout: 10000,
}, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pp-progress-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const name = "gate.test.mjs";
	await writeFile(
		join(directory, name),
		`
import { test } from "node:test";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
console.error("PP_CI_FILE started ${"0".repeat(64)}");
console.log("private customer token=secret");
test("private customer name", { timeout: 5000 }, async (t) => {
  while (!existsSync("release")) await setTimeout(10, undefined, { signal: t.signal });
});
`,
	);
	const environment = Object.fromEntries(
		Object.entries(process.env).filter(
			([key]) => !key.startsWith("NODE_TEST_"),
		),
	);
	const execution = promisify(execFile)(
		process.execPath,
		[
			"--test",
			`--test-reporter=${resolve(import.meta.dirname, "ci-workload-reporter.mjs")}`,
			name,
		],
		{ cwd: directory, env: environment, timeout: 8000 },
	);
	const output = [];
	execution.child.stderr.on(
		"data",
		createProgressForwarder((line) => {
			const progress = JSON.parse(line).ciWorkloadProgress;
			output.push(progress);
			if (
				progress.event === "started" &&
				progress.filePathSha256 === digest(name)
			)
				writeFileSync(
					join(directory, "release"),
					"released by observed progress",
				);
		}),
	);
	const result = await execution;
	assert.ok(
		output.some(
			(item) =>
				item.event === "started" && item.filePathSha256 === digest(name),
		),
	);
	assert.equal(
		output.some((item) => item.filePathSha256 === "0".repeat(64)),
		false,
	);
	assert.equal(result.stdout.includes("token=secret"), false);
	assert.equal(result.stderr.includes("token=secret"), false);
	assert.equal(JSON.stringify(output).includes(name), false);
});
