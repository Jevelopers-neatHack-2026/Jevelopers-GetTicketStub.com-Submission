import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	productionContentHash,
	productionReferences,
} from "@jevelopers/shared-contracts/production-operations";
import { contract, sha } from "../../src/api/canonical-values.js";
import { DurabilityDatabase } from "../../src/internal/durability.js";
import { exportRequest } from "../fixtures/canonical-production/requests.js";
import { readBundle } from "../../src/api/canonical-exports.js";
import { CandidateRuntime } from "../../src/api/canonical-runtime.js";
import {
	mkdtemp,
	cp,
	symlink,
	writeFile,
	appendFile,
	rm,
	readdir,
	mkdir,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resource } from "../../src/runtime/resources.js";
import { z } from "zod";

for (const field of [
	"source_revision",
	"renderer_commitment",
	"parser_commitment",
	"content_hash",
] as const)
	test(`rejects wrong ${field} in a canonical runtime record before execution`, async () => {
		await using given = await fixtureHost();
		using db = new DurabilityDatabase(
			`${given.root}/runtime.sqlite`,
			undefined,
			() => Date.parse(given.state.now),
		);
		const draft = contract("ProductionRuntime", {
			...given.records.runtimeRecord,
			[field]:
				field === "source_revision"
					? "f".repeat(40)
					: sha(`sha256:${"0".repeat(64)}`),
		});
		const record =
			field === "content_hash"
				? draft
				: { ...draft, content_hash: productionContentHash(draft) };
		const runtimeRef = {
			...given.records.composition.runtime_ref,
			content_hash: record.content_hash,
		};
		const compositionDraft = {
			...given.records.composition,
			runtime_ref: runtimeRef,
		};
		const composition = {
			...compositionDraft,
			content_hash: productionContentHash(compositionDraft),
		};
		const request = {
			...given.records.request,
			binding: {
				...given.records.request.binding,
				composition_ref: {
					...given.records.request.binding.composition_ref,
					content_hash: composition.content_hash,
				},
			},
		};
		const pins = { ...given.records.runtime, runtime_ref: runtimeRef };
		given.records.records.set(record.id, record);
		given.records.records.set(composition.composition_id, composition);
		const host = given.host();
		const candidate = createCandidateProductionOperations({
			...host,
			db,
			context: { ...host.context, runtime: pins },
			external_references: [
				...productionReferences(request),
				...productionReferences(composition),
				...productionReferences(given.records.template),
				...productionReferences(pins),
			].map(([, ref]) => ref),
		});
		const when = await candidate.operations.composeArtifact(
			candidate.context,
			request,
		);
		assert.ok(!when.ok, JSON.stringify(when));
		assert.equal(when.error.code, "HASH_MISMATCH");
		assert.equal(
			db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
			0,
		);
		assert.equal(
			db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
			0,
		);
	});

test("rejects changed actual output configuration under a retained runtime pin", async () => {
	await using given = await fixtureHost();
	using db = new DurabilityDatabase(
		`${given.root}/changed-config.sqlite`,
		undefined,
		() => Date.parse(given.state.now),
	);
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		db,
		profiles: [
			{
				...given.records.profile,
				output_policy: {
					...given.records.profile.output_policy,
					maxBytes: 4000000,
				},
			},
		],
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "HASH_MISMATCH");
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});

for (const target of ["product parser", "installed parser dependency"] as const)
	test(`rejects changed actual ${target} under a retained canonical runtime pin in another process`, {
		timeout: 60000,
	}, async (t) => {
		await using given = await fixtureHost();
		const root = await mkdtemp(join(tmpdir(), "pp-canonical-source-change-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		await cp(resource("dist"), join(root, "dist"), { recursive: true });
		for (const path of [
			"scripts",
			"docs",
			"src",
			"vendor",
			"package-lock.json",
		])
			await symlink(resource(path), join(root, path));
		await mkdir(join(root, "node_modules"));
		for (const entry of await readdir(resource("node_modules"))) {
			if (entry === "sax")
				await cp(resource("node_modules/sax"), join(root, "node_modules/sax"), {
					recursive: true,
				});
			else
				await symlink(
					resource(`node_modules/${entry}`),
					join(root, "node_modules", entry),
				);
		}
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ type: "module" }),
		);
		if (target === "product parser")
			await appendFile(
				join(root, "dist/src/exporters/private-inspect.js"),
				'\nexport const sourceChangeProbe = "changed parser implementation";\n',
			);
		else
			await appendFile(
				join(root, "node_modules/sax/lib/sax.js"),
				'\nexports.sourceChangeProbe = "changed parser dependency";\n',
			);
		const snapshot = join(root, "retained.json");
		await writeFile(
			snapshot,
			JSON.stringify({
				record: given.records.runtimeRecord,
				composition: given.records.composition,
				request: given.records.request,
				pins: given.records.runtime,
			}),
		);
		const when = await promisify(execFile)(
			process.execPath,
			[
				join(
					root,
					"dist/tests/fixtures/canonical-production/runtime-record-probe.js",
				),
				snapshot,
			],
			{ timeout: 50000 },
		);
		const parsed = z
			.object({ result: z.unknown(), publications: z.number() })
			.parse(JSON.parse(when.stdout));
		const failure = z
			.object({
				ok: z.literal(false),
				error: z.object({ code: z.literal("HASH_MISMATCH") }),
			})
			.parse(parsed.result);
		assert.equal(failure.error.code, "HASH_MISMATCH");
		assert.equal(parsed.publications, 0);
	});

test("attributes actual files to the resolved matching runtime and current consumer pin", async () => {
	await using given = await fixtureHost();
	const { operations, context } = given.candidate;
	const artifact = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(artifact.ok);
	const when = await operations.exportArtifactBundle(
		context,
		exportRequest(given.records, artifact.value),
	);
	assert.ok(when.ok);
	const bundle = readBundle(new CandidateRuntime(given.host()), artifact.value);
	assert.ok(bundle);
	const lineage = bundle.files.find((file) => file.name === "lineage.json");
	assert.ok(lineage);
	const record: unknown = JSON.parse(Buffer.from(lineage.bytes).toString());
	const parsed = contract(
		"ProductionRuntime",
		given.records.records.get(given.records.runtime.runtime_ref.id),
	);
	assert.equal(
		bundle.verification.bundle.renderer_ref.content_hash,
		parsed.content_hash,
	);
	assert.ok(
		bundle.report.body.checked_files.every(
			(file) => file.parser_ref.content_hash === parsed.content_hash,
		),
	);
	assert.notEqual(parsed.content_hash, parsed.renderer_commitment);
	assert.notEqual(parsed.content_hash, parsed.parser_commitment);
	assert.ok(typeof record === "object" && record !== null);
	assert.ok(
		"contract_candidate" in record && record.contract_candidate === "0.9.4",
	);
	assert.ok("accepted" in record && record.accepted === false);
	assert.ok("consumer_pin" in record);
	assert.ok("runtime_record" in record);
	assert.deepEqual(record.runtime_record, parsed);
});
