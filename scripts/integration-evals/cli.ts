import { join, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
	OwnerFailure,
	requireOwner,
	readRequest,
	readBounded,
	configurationSchema,
	sourceReceipt,
	claimRoot,
	cleanup,
	safePath,
	digest,
	payloadHash,
	fixtureDirectory,
	writeOwned,
	limitations,
} from "./protocol.js";
import type { OwnerRequest } from "./protocol.js";

async function execute(request: OwnerRequest) {
	const source = await sourceReceipt(request);
	const configBytes = await readBounded(request.configuration_artifact);
	const config = configurationSchema.parse(JSON.parse(configBytes.toString()));
	await safePath(config.browser_root);
	requireOwner(
		config.node_sha256 === digest(await readFile(process.execPath)),
		"NODE_BYTES_MISMATCH",
	);
	const pins = z
		.object({ image: z.object({ reference: z.string() }) })
		.parse(
			JSON.parse(
				(
					await readBounded(
						join(fixtureDirectory, "../../../../docs/runtime/pins.json"),
					)
				).toString(),
			),
		);
	requireOwner(
		config.renderer_image ===
			(process.platform === "linux" ? pins.image.reference : null),
		"IMAGE_PIN_MISMATCH",
	);
	process.env["TZ"] = "UTC";
	process.env["LANG"] = "C.UTF-8";
	process.env["LC_ALL"] = "C.UTF-8";
	process.env["PLAYWRIGHT_BROWSERS_PATH"] = config.browser_root;
	if (config.renderer_image !== null)
		process.env["PP_RENDERER_IMAGE"] = config.renderer_image;
	const payload = await readBounded(
		join(fixtureDirectory, "asset-negative.txt"),
	);
	requireOwner(digest(payload) === payloadHash, "FIXTURE_HASH_MISMATCH");
	const { root } = await claimRoot(request);
	const { integrationHost } = await import(
		"../../tests/fixtures/integration-evals/host.js"
	);
	const { validateProductionResult } = await import(
		"@jevelopers/shared-contracts/production-operations"
	);
	await using host = await integrationHost({
		root,
		preserve: true,
		clock: request.clock,
		logo: payload,
	});
	const canonical = {
		schema_version: "print-invalid-mapping/v1",
		supplement_id: config.supplement_id,
		original_case_id: "print-invalid",
		original_fixture_id: "asset-negative",
		source,
		configuration_sha256: digest(configBytes),
		mode: config.mode,
		origin: config.origin,
		approval_authority: false,
		financial_authority: false,
		original_collected_at: "2026-10-10T00:00:00Z",
		supplement_provenance_ref:
			"tests/fixtures/integration-evals/v1/supplement.json",
		canonical_request: host.records.request,
		canonical_records: Object.fromEntries(host.records.records),
		runtime: host.records.runtime,
		profile: {
			template_ref: host.records.profile.template_ref,
			layout: host.records.profile.layout,
			input: host.records.profile.input,
			asset_refs: host.records.profile.asset_refs,
			slot_ids: host.records.profile.slot_ids,
			field_ids: host.records.profile.field_ids,
			constraints: host.records.profile.constraints,
			fonts: host.records.profile.fonts.map((f) => ({
				reference: f.reference,
				descriptor: f.font.descriptor,
			})),
			policy_refs: host.records.profile.policy_refs,
			output_policy: host.records.profile.output_policy,
			permission_backend:
				"synthetic mock-only fixture; no authentic approval authority",
		},
		payload_sha256: payloadHash,
		limitations,
	};
	const mapping = await writeOwned(root, "mapping.json", canonical);
	const count = (table: "publications" | "files" | "staged_files" | "blobs") =>
		z
			.object({ n: z.number().int().nonnegative() })
			.parse(host.db.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
	const before = {
		publications: count("publications"),
		files: count("files"),
		staged_files: count("staged_files"),
		blobs: count("blobs"),
	};
	const result = await host.candidate.operations.composeArtifact(
		host.candidate.context,
		host.records.request,
	);
	requireOwner(
		validateProductionResult("composeArtifact", result, host.records.scope).ok,
		"INVALID_PRODUCT_RESULT",
	);
	const after = {
		publications: count("publications"),
		files: count("files"),
		staged_files: count("staged_files"),
		blobs: count("blobs"),
	};
	const observations = {
		typed_rejection:
			!result.ok &&
			result.error.code === "PREFLIGHT_FAILED" &&
			result.error.blocking_condition === "preflight" &&
			host.state.assetCalls > 0,
		production_artifacts: after.publications,
	};
	const trace = await writeOwned(root, "trace.json", {
		source,
		run_id: request.run_id,
		case_id: "print-invalid",
		operation: "composeArtifact",
		result,
		before,
		after,
		asset_resolutions: host.state.assetCalls,
		attempts: host.db.sql
			.prepare("SELECT id,operation,outcome FROM attempts")
			.all(),
		observations: host.db.sql
			.prepare(
				"SELECT id,operation,attempt,kind,code,publication,bytes FROM observations",
			)
			.all(),
		payload_sha256: payloadHash,
		mapping_sha256: mapping.sha256,
		original_fixture_collected_at: "2026-10-10T00:00:00Z",
		logical_scenario_clock: request.clock,
		limitations,
	});
	const evaluation = await writeOwned(root, "evaluation.json", {
		source,
		run_id: request.run_id,
		case_id: "print-invalid",
		requirements: ["ART-04", "IE-05D.AC1"],
		observations,
		trace_sha256: trace.sha256,
		mapping_sha256: mapping.sha256,
		production_state: after,
		configuration_sha256: digest(configBytes),
		runtime_receipt: {
			executable: process.execPath,
			version: process.version,
			sha256: config.node_sha256,
			record: host.records.runtimeRecord,
			measured_mapping: host.db.sql
				.prepare(
					"SELECT bytes,digest FROM canonical_records WHERE key LIKE 'runtime-mapping:%'",
				)
				.all()
				.map((raw) => {
					const row = z
						.object({ bytes: z.string(), digest: z.string() })
						.parse(raw);
					requireOwner(
						digest(row.bytes) === row.digest,
						"RUNTIME_MAPPING_HASH_MISMATCH",
					);
					return JSON.parse(row.bytes);
				}),
		},
		accepted: false,
		cost: null,
		cost_status: "unknown",
		limitations,
	});
	const evidence = ["ART-04", "IE-05D.AC1"].flatMap((requirement, index) =>
		(
			[
				[trace, "trace"],
				[evaluation, "evaluation"],
				[mapping, "checkpoint"],
			] as const
		).map(([file, kind], ordinal) => {
			return {
				id: `${request.run_id}-print-invalid-${index}-${ordinal}`,
				requirement,
				case_id: "print-invalid",
				run_id: request.run_id,
				component: "print-production",
				revision: source.revision,
				created_at: request.clock,
				original_cutoff: request.clock,
				mode: "mock-only",
				origin: "synthetic",
				path: relative(request.artifact_directory, file.path),
				sha256: file.sha256,
				kind,
				permission_ref:
					"tests/fixtures/integration-evals/v1/supplement.json#permission",
				redaction_ref:
					"tests/fixtures/integration-evals/v1/supplement.json#redaction",
				reviewer_access_ref: "evaluator-retained-hash-checked-derivatives",
				limitations,
			};
		}),
	);
	return {
		component_revision: source.revision,
		mode: "mock-only",
		origin: "synthetic",
		observations,
		evidence,
		cost: null,
		cost_status: "unknown",
	};
}

async function main() {
	const timeout = setTimeout(() => {
		process.stderr.write('{"error":"OWNER_TIMEOUT"}\n');
		process.exit(1);
	}, 25000);
	try {
		const request = await readRequest();
		const command = process.argv[2];
		requireOwner(
			process.argv.length === 3 && (command === "run" || command === "cleanup"),
			"INVALID_COMMAND",
		);
		const response =
			command === "cleanup" ? await cleanup(request) : await execute(request);
		process.stdout.write(JSON.stringify(response) + "\n");
	} catch (error) {
		const code =
			error instanceof OwnerFailure ? error.code : "OWNER_EXECUTION_FAILURE";
		process.stderr.write(JSON.stringify({ error: code }) + "\n");
		process.exitCode = 1;
	} finally {
		clearTimeout(timeout);
	}
}
await main();
