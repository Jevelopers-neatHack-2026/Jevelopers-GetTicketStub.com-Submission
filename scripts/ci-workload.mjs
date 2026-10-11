import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { groups, workloadPlan } from "./ci-workload-plan.mjs";
import {
	requestSchema,
	phaseSchema,
	phaseNames,
	validateGroup,
	aggregateReceipts,
	completeCounts,
} from "./ci-workload-evidence.mjs";
import { runGroup } from "./ci-workload-runner.mjs";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, "out/ci-workload");
const requestPath = join(root, "out/ci-workload-request.json");
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const write = (path, value) =>
	writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
async function groupInputs() {
	assert.deepEqual(
		(await readdir(join(root, "out/ci-workload-input"))).sort(),
		groups.map((group) => `${group}.json`).sort(),
	);
	return Promise.all(
		groups.map((group) =>
			json(join(root, "out/ci-workload-input", `${group}.json`)),
		),
	);
}

try {
	assert.equal(process.versions.node, "24.21.0");
	assert.equal(process.cwd(), root);
	const [command, ...args] = process.argv.slice(2);
	switch (command) {
		case "prepare": {
			assert.equal(args.length, 4);
			const [group, revision, runId, attempt] = args;
			const request = requestSchema.parse({ group, revision, runId, attempt });
			assert.equal(
				execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
				revision,
			);
			await mkdir(directory, { recursive: true });
			await write(requestPath, request);
			break;
		}
		case "plan": {
			assert.equal(args.length, 0);
			console.log(JSON.stringify(await workloadPlan(root)));
			break;
		}
		case "phase": {
			assert.equal(args.length, 2);
			requestSchema.parse(await json(requestPath));
			assert.match(args[1], /^(0|[1-9][0-9]{0,2})$/);
			const phase = phaseSchema.parse({
				name: args[0],
				exitCode: Number(args[1]),
			});
			await write(join(directory, `${phase.name}.phase.json`), phase);
			break;
		}
		case "run": {
			assert.equal(args.length, 0);
			const request = requestSchema.parse(await json(requestPath));
			const plan = await workloadPlan(root);
			assert.equal(
				execFileSync(process.execPath, ["scripts/environment.mjs"], {
					encoding: "utf8",
				}),
				"",
			);
			if (request.group === "aggregate") {
				const receipt = aggregateReceipts(plan, request, await groupInputs());
				await write(join(directory, "aggregate.tests.json"), receipt);
				console.log(
					JSON.stringify({
						workloadUnion: {
							counts: receipt.counts,
							unionDigest: receipt.unionDigest,
							passed: receipt.passed,
						},
					}),
				);
				process.exitCode = receipt.passed ? 0 : 1;
			} else {
				const receipt = await runGroup({ root, plan, request });
				await write(join(directory, `${request.group}.tests.json`), receipt);
				console.log(
					JSON.stringify({
						workloadGroup: {
							group: request.group,
							counts: receipt.counts,
							elapsedMs: receipt.elapsedMs,
							executionNonce: receipt.executionNonce,
							unionDigest: receipt.unionDigest,
						},
					}),
				);
				process.exitCode =
					receipt.exitCode === 0 &&
					completeCounts(receipt.counts) &&
					receipt.files.every(
						(file) => file.success && completeCounts(file.counts),
					)
						? 0
						: 1;
			}
			break;
		}
		case "finish": {
			assert.equal(args.length, 0);
			const request = requestSchema.parse(await json(requestPath));
			const tests = await json(join(directory, `${request.group}.tests.json`));
			const phases = await Promise.all(
				phaseNames.map((name) => json(join(directory, `${name}.phase.json`))),
			);
			assert.deepEqual(
				phases.map((phase) => phaseSchema.parse(phase).name),
				phaseNames,
			);
			const receipt = { tests, phases };
			if (request.group === "aggregate")
				assert.deepEqual(
					tests,
					aggregateReceipts(
						await workloadPlan(root),
						request,
						await groupInputs(),
					),
				);
			else assert.deepEqual(tests.request, request);
			const passed =
				request.group === "aggregate"
					? tests.passed
					: validateGroup(await workloadPlan(root), receipt).tests.exitCode ===
							0 &&
						completeCounts(tests.counts) &&
						tests.files.every(
							(file) => file.success && completeCounts(file.counts),
						);
			await write(join(directory, `${request.group}.json`), receipt);
			process.exitCode =
				passed && phases.every((phase) => phase.exitCode === 0) ? 0 : 1;
			break;
		}
		default:
			throw new Error("Unknown workload command.");
	}
} catch (error) {
	if (!(error instanceof Error)) throw error;
	console.error(JSON.stringify({ code: "CI_WORKLOAD_INVALID_OR_INCOMPLETE" }));
	process.exitCode = 1;
}
