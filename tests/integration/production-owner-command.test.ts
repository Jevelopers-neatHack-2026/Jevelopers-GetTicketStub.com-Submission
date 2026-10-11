import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	mkdtemp,
	realpath,
	mkdir,
	readFile,
	writeFile,
	rm,
	readdir,
	symlink,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { z } from "zod";
import {
	checkout,
	fixtureDirectory,
	digest,
	payloadHash,
	configurationSchema,
	requestSchema,
} from "../../scripts/integration-evals/protocol.js";
import type { OwnerRequest } from "../../scripts/integration-evals/protocol.js";

const cli = join(checkout, "dist/scripts/integration-evals/cli.js");
const exec = promisify(execFile);
const record = z.record(z.string(), z.unknown());
const responseSchema = z.fromJSONSchema(
	JSON.parse(
		await readFile(join(fixtureDirectory, "OwnerResponse.schema.json"), "utf8"),
	),
);
const evidenceSchema = z.object({
	id: z.string(),
	requirement: z.string(),
	path: z.string(),
	sha256: z.string(),
	revision: z.string(),
	created_at: z.string(),
	original_cutoff: z.string(),
	kind: z.string(),
	limitations: z.array(z.string()),
});
const responseFields = z.object({
	component_revision: z.string(),
	mode: z.literal("mock-only"),
	origin: z.literal("synthetic"),
	observations: z.object({
		typed_rejection: z.boolean(),
		production_artifacts: z.number().int(),
	}),
	evidence: z.array(evidenceSchema),
	cost: z.null(),
	cost_status: z.literal("unknown"),
});
async function given() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "pp-owner-test-")));
	const staging = join(root, "artifacts");
	await mkdir(staging);
	const revision = (
		await exec("git", ["rev-parse", "HEAD"], { cwd: checkout })
	).stdout.trim();
	const browserRoot =
		process.env["PLAYWRIGHT_BROWSERS_PATH"] ??
		(process.platform === "linux"
			? "/ms-playwright"
			: join(homedir(), "Library/Caches/ms-playwright"));
	const pins = record.parse(
		JSON.parse(
			await readFile(join(checkout, "docs/runtime/pins.json"), "utf8"),
		),
	);
	const config = configurationSchema.parse({
		schema_version: "print-invalid-owner/v1",
		case_id: "print-invalid",
		fixture_id: "asset-negative",
		supplement_id: "print-invalid-synthetic/v1",
		payload_sha256: payloadHash,
		mode: "mock-only",
		origin: "synthetic",
		accepted: false,
		node_sha256: digest(await readFile(process.execPath)),
		browser_root: await realpath(browserRoot),
		renderer_image:
			process.platform === "linux"
				? z.object({ reference: z.string() }).parse(pins["image"]).reference
				: null,
	});
	const configuration = join(root, "configuration.json");
	await writeFile(configuration, JSON.stringify(config));
	const request = requestSchema.parse({
		case: JSON.parse(
			await readFile(join(fixtureDirectory, "case.json"), "utf8"),
		),
		run_id: "owner-characterization",
		component_revision: revision,
		configuration_artifact: configuration,
		artifact_directory: staging,
		namespace: "owner-characterization-print-invalid",
		seed: 19,
		clock: "2026-10-10T12:05:00+00:00",
		providers: [],
	});
	const environment = {
		PATH: process.env["PATH"] ?? "",
		HOME: root,
		TMPDIR: root,
		IE_NAMESPACE: request.namespace,
		IE_MODE: "mock-only",
		IE_SEED: String(request.seed),
		IE_CLOCK: request.clock,
		IE_ARTIFACT_DIR: staging,
	};
	const invoke = (
		command = "run",
		input: unknown = request,
		env = environment,
		target = cli,
	) =>
		new Promise<{
			readonly code: number | null;
			readonly signal: NodeJS.Signals | null;
			readonly stdout: string;
			readonly stderr: string;
		}>((resolve, reject) => {
			const child = spawn(
				process.execPath,
				target === cli ? [target, command] : [target],
				{
					cwd: checkout,
					env,
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 30000,
				},
			);
			let stdout = "",
				stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk: string) => {
				stderr += chunk;
			});
			child.on("error", reject);
			child.stdin.on("error", (error) => {
				if (!("code" in error) || error.code !== "EPIPE") reject(error);
			});
			child.on("close", (code, signal) =>
				resolve({ code, signal, stdout, stderr }),
			);
			child.stdin.end(
				typeof input === "string" ? input : JSON.stringify(input),
			);
		});
	return {
		root,
		staging,
		config,
		request,
		environment,
		invoke,
		owned: join(staging, `pp-${request.namespace}`),
		async [Symbol.asyncDispose]() {
			await rm(root, { recursive: true, force: true });
		},
	};
}
function parsedResponse(stdout: string) {
	const raw: unknown = JSON.parse(stdout);
	responseSchema.parse(raw);
	return responseFields.parse(raw);
}

test("owner command executes original quarantined bytes, measures zero publications, retains schema-valid joined evidence and cleans only its namespace", async () => {
	await using fixture = await given();
	assert.equal(
		digest(await readFile(join(fixtureDirectory, "asset-negative.txt"))),
		payloadHash,
	);
	await writeFile(join(fixture.staging, "unrelated.json"), "keep");
	const when = await fixture.invoke();
	assert.equal(when.code, 0, when.stderr);
	assert.equal(when.stdout.trim().split("\n").length, 1);
	const response = parsedResponse(when.stdout);
	assert.equal(response.component_revision, fixture.request.component_revision);
	assert.deepEqual(response.observations, {
		typed_rejection: true,
		production_artifacts: 0,
	});
	assert.deepEqual(
		new Set(response.evidence.map((e) => e.requirement)),
		new Set(["ART-04", "IE-05D.AC1"]),
	);
	assert.equal(new Set(response.evidence.map((e) => e.id)).size, 6);
	for (const evidence of response.evidence) {
		assert.equal(evidence.revision, fixture.request.component_revision);
		assert.equal(evidence.created_at, fixture.request.clock);
		assert.equal(evidence.original_cutoff, fixture.request.clock);
		assert.ok(evidence.limitations.some((l) => l.includes("logical scenario")));
		assert.ok(evidence.path.startsWith(`pp-${fixture.request.namespace}/`));
		assert.equal(
			digest(await readFile(join(fixture.staging, evidence.path))),
			evidence.sha256,
		);
	}
	const trace = z
		.object({
			result: z.object({
				ok: z.literal(false),
				error: z.object({
					code: z.literal("PREFLIGHT_FAILED"),
					blocking_condition: z.literal("preflight"),
				}),
			}),
			before: z.object({ publications: z.literal(0), files: z.literal(0) }),
			after: z.object({
				publications: z.literal(0),
				files: z.literal(0),
				blobs: z.literal(0),
				staged_files: z.literal(0),
			}),
			asset_resolutions: z.number().positive(),
			attempts: z.array(z.object({ outcome: z.literal("failed") })).min(1),
		})
		.parse(
			JSON.parse(await readFile(join(fixture.owned, "trace.json"), "utf8")),
		);
	assert.ok(trace.asset_resolutions >= 2);
	const mapping = record.parse(
		JSON.parse(await readFile(join(fixture.owned, "mapping.json"), "utf8")),
	);
	assert.equal(mapping["payload_sha256"], payloadHash);
	assert.equal(mapping["approval_authority"], false);
	assert.ok(
		mapping["canonical_request"] &&
			mapping["canonical_records"] &&
			mapping["profile"],
	);
	const cleanup = await fixture.invoke("cleanup");
	assert.equal(cleanup.code, 0, cleanup.stderr);
	assert.equal(record.parse(JSON.parse(cleanup.stdout))["status"], "removed");
	assert.deepEqual(await readdir(fixture.staging), ["unrelated.json"]);
	const repeated = await fixture.invoke("cleanup");
	assert.equal(repeated.code, 0);
	assert.equal(record.parse(JSON.parse(repeated.stdout))["status"], "absent");
});

test("safe counterpart reaches real compose success and hashes actual published product files", async () => {
	await using fixture = await given();
	const when = await fixture.invoke(
		"run",
		fixture.request,
		fixture.environment,
		join(checkout, "dist/tests/fixtures/integration-evals/positive-control.js"),
	);
	assert.equal(when.code, 0, when.stderr);
	const control = z
		.object({
			result: z.object({ ok: z.literal(true) }),
			publications: z.literal(1),
			asset_resolutions: z.number().positive(),
			files: z
				.array(
					z.object({
						name: z.string(),
						stored_hash: z.string(),
						actual_hash: z.string(),
						bytes: z.number().positive(),
					}),
				)
				.min(1),
		})
		.parse(JSON.parse(when.stdout));
	for (const file of control.files)
		assert.equal(file.actual_hash, file.stored_hash);
	assert.ok(control.files.some((file) => file.name === "output.svg"));
	assert.equal((await fixture.invoke("cleanup")).code, 0);
});

const malformed: readonly (readonly [
	string,
	(request: OwnerRequest) => unknown,
])[] = [
	[
		"wrong revision",
		(request) => ({ ...request, component_revision: "0".repeat(40) }),
	],
	[
		"preflight unsupported",
		(request) => ({
			...request,
			case: { ...request.case, id: "print-preflight" },
		}),
	],
	[
		"wrong component",
		(request) => ({
			...request,
			case: { ...request.case, component: "other" },
		}),
	],
	[
		"wrong fault",
		(request) => ({ ...request, case: { ...request.case, fault: "other" } }),
	],
	[
		"changed assertion",
		(request) => ({
			...request,
			case: {
				...request.case,
				assertions: [{ observation: "typed_rejection", expected: false }],
			},
		}),
	],
	["wrong namespace", (request) => ({ ...request, namespace: "../escape" })],
	[
		"traversal",
		(request) => ({
			...request,
			artifact_directory: request.artifact_directory + "/../artifacts",
		}),
	],
	["unowned root", (request) => ({ ...request, artifact_directory: "/" })],
	["extra key", (request) => ({ ...request, authority: true })],
	[
		"live provider",
		(request) => ({
			...request,
			providers: [{ id: "image", mode: "live", model: "unused" }],
		}),
	],
	["malformed JSON", () => "{"],
	["bounded stdin", () => "x".repeat(65537)],
];
for (const [name, input] of malformed)
	test(`owner fails honestly for ${name}`, async () => {
		await using fixture = await given();
		const when = await fixture.invoke("run", input(fixture.request));
		assert.notEqual(when.code, 0);
		assert.equal(when.stdout, "");
		assert.ok(when.stderr.includes("error"));
		assert.deepEqual(await readdir(fixture.staging), []);
	});

test("owner rejects nonmatching environment mode and staging", async () => {
	await using fixture = await given();
	for (const override of [
		{ IE_MODE: "recorded" },
		{ IE_ARTIFACT_DIR: fixture.root },
	]) {
		const when = await fixture.invoke("run", fixture.request, {
			...fixture.environment,
			...override,
		});
		assert.notEqual(when.code, 0);
		assert.equal(when.stdout, "");
	}
});

test("corrupt configuration and executable commitment fail without success-shaped defaults; cleanup still runs", async () => {
	await using fixture = await given();
	for (const config of [
		"{",
		JSON.stringify({ ...fixture.config, accepted: true }),
		JSON.stringify({ ...fixture.config, node_sha256: "0".repeat(64) }),
	]) {
		await writeFile(fixture.request.configuration_artifact, config);
		const when = await fixture.invoke();
		assert.notEqual(when.code, 0);
		assert.equal(when.stdout, "");
		assert.equal((await fixture.invoke("cleanup")).code, 0);
	}
});

test("runtime failure after namespace claim leaves truthful partial state for repeated cleanup", async () => {
	await using fixture = await given();
	const badRuntime = join(fixture.root, "empty-browser-cache");
	await mkdir(badRuntime);
	await writeFile(
		fixture.request.configuration_artifact,
		JSON.stringify({ ...fixture.config, browser_root: badRuntime }),
	);
	const when = await fixture.invoke();
	assert.notEqual(when.code, 0);
	assert.equal(when.stdout, "");
	assert.ok((await readdir(fixture.owned)).includes("owner.json"));
	assert.equal((await fixture.invoke("cleanup")).code, 0);
	assert.equal((await fixture.invoke("cleanup")).code, 0);
});

test("repeated invocation cannot overwrite a retained response or state", async () => {
	await using fixture = await given();
	const first = await fixture.invoke();
	assert.equal(first.code, 0, first.stderr);
	const hash = digest(await readFile(join(fixture.owned, "evaluation.json")));
	const repeated = await fixture.invoke();
	assert.notEqual(repeated.code, 0);
	assert.equal(repeated.stdout, "");
	assert.equal(
		digest(await readFile(join(fixture.owned, "evaluation.json"))),
		hash,
	);
	assert.equal((await fixture.invoke("cleanup")).code, 0);
});

test("unsafe symlink staging/configuration and owned output are rejected without touching unrelated bytes", async () => {
	await using fixture = await given();
	const other = join(fixture.root, "unrelated");
	await mkdir(other);
	await writeFile(join(other, "sentinel"), "keep");
	const linked = join(fixture.root, "linked");
	await symlink(other, linked);
	const request = { ...fixture.request, artifact_directory: linked };
	const when = await fixture.invoke("run", request, {
		...fixture.environment,
		IE_ARTIFACT_DIR: linked,
	});
	assert.notEqual(when.code, 0);
	const configLink = join(fixture.root, "config-link.json");
	await symlink(fixture.request.configuration_artifact, configLink);
	assert.notEqual(
		(
			await fixture.invoke("run", {
				...fixture.request,
				configuration_artifact: configLink,
			})
		).code,
		0,
	);
	assert.equal((await fixture.invoke()).code, 0);
	await rm(join(fixture.owned, "trace.json"));
	await symlink(join(other, "sentinel"), join(fixture.owned, "trace.json"));
	const cleanup = await fixture.invoke("cleanup");
	assert.notEqual(cleanup.code, 0);
	assert.equal(await readFile(join(other, "sentinel"), "utf8"), "keep");
	assert.ok((await readdir(fixture.owned)).includes("owner.json"));
});

test("cleanup refuses unowned entries and mismatched ownership before deleting anything", async () => {
	await using fixture = await given();
	assert.equal((await fixture.invoke()).code, 0);
	await writeFile(join(fixture.owned, "unrelated"), "keep");
	const first = await fixture.invoke("cleanup");
	assert.notEqual(first.code, 0);
	assert.ok((await readdir(fixture.owned)).includes("evaluation.json"));
	await rm(join(fixture.owned, "unrelated"));
	await writeFile(
		join(fixture.owned, "owner.json"),
		JSON.stringify({ owner: "other" }),
	);
	assert.notEqual((await fixture.invoke("cleanup")).code, 0);
	assert.ok((await readdir(fixture.owned)).includes("evaluation.json"));
});

test("cleanup reports uncertain ownership of an empty partial namespace without deleting it", async () => {
	await using fixture = await given();
	await mkdir(fixture.owned);
	const when = await fixture.invoke("cleanup");
	assert.notEqual(when.code, 0);
	assert.equal(when.stdout, "");
	assert.ok(when.stderr.includes("OWNERSHIP_UNPROVEN"));
	assert.deepEqual(await readdir(fixture.owned), []);
});

test("cleanup safely removes an actually interrupted subprocess namespace", async () => {
	await using fixture = await given();
	const child = spawn(process.execPath, [cli, "run"], {
		cwd: checkout,
		env: fixture.environment,
		stdio: ["pipe", "ignore", "ignore"],
	});
	child.stdin.end(JSON.stringify(fixture.request));
	const deadline = Date.now() + 10000;
	let claimed = false;
	while (Date.now() < deadline) {
		const names = await readdir(fixture.owned).catch((error) => {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				const missing: string[] = [];
				return missing;
			}
			throw error;
		});
		if (names.includes("owner.json")) {
			try {
				const marker = record.parse(
					JSON.parse(await readFile(join(fixture.owned, "owner.json"), "utf8")),
				);
				if (
					marker["request_sha256"] === digest(JSON.stringify(fixture.request))
				) {
					claimed = true;
					break;
				}
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
			}
		}
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	child.kill("SIGKILL");
	await new Promise<void>((resolve) => child.once("close", () => resolve()));
	assert.ok(claimed);
	const cleanup = await fixture.invoke("cleanup");
	assert.equal(cleanup.code, 0, cleanup.stderr);
	assert.deepEqual(await readdir(fixture.staging), []);
});

test("corrupt owned fixture bytes fail source verification and cannot report product rejection", async () => {
	await using fixture = await given();
	const path = join(fixtureDirectory, "asset-negative.txt");
	const original = await readFile(path);
	try {
		await writeFile(path, Buffer.concat([original, Buffer.from("changed")]));
		const when = await fixture.invoke();
		assert.notEqual(when.code, 0);
		assert.equal(when.stdout, "");
		assert.ok(when.stderr.includes("DIRTY_CHECKOUT"));
		assert.deepEqual(await readdir(fixture.staging), []);
	} finally {
		await writeFile(path, original);
	}
});

test("cleanup refuses a corrupt partial marker and a symlink namespace without deleting unrelated state", async () => {
	await using fixture = await given();
	await mkdir(fixture.owned);
	await writeFile(join(fixture.owned, "owner.json"), "{");
	const partial = await fixture.invoke("cleanup");
	assert.notEqual(partial.code, 0);
	assert.equal(partial.stdout, "");
	assert.equal(await readFile(join(fixture.owned, "owner.json"), "utf8"), "{");
	await rm(fixture.owned, { recursive: true });
	const other = join(fixture.root, "other-namespace");
	await mkdir(other);
	await writeFile(join(other, "sentinel"), "keep");
	await symlink(other, fixture.owned);
	assert.notEqual((await fixture.invoke("cleanup")).code, 0);
	assert.equal(await readFile(join(other, "sentinel"), "utf8"), "keep");
});
