import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { validateContract, hashBytes } from "@jevelopers/shared-contracts";
import {
	validateProductionResult,
	checkProductionPreflight,
	checkProductionValueIntegrity,
} from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { inspectRequest } from "../fixtures/canonical-production/requests.js";
import { CandidateRuntime } from "../../src/api/canonical-runtime.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import { scopeKey } from "../../src/internal/durability.js";
import { scopeSchema } from "../../src/internal/durability.js";
import { CanonicalState } from "../../src/storage/canonical-state.js";
import { jsonBytes } from "../../src/api/canonical-values.js";

test("retains missing final formats with durable safe evidence when a real composed draft is inspected", async () => {
	// Given
	await using given = await fixtureHost();
	const { operations, context } = given.candidate;
	const composed = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(composed.ok);
	const before = given.db.sql
		.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
		.all();
	const observations = given.db.sql
		.prepare("SELECT id FROM observations ORDER BY sequence")
		.all();
	// When
	const inspected = await operations.inspectArtifact(
		context,
		inspectRequest(given.records, composed.value),
	);
	// Then
	assert.ok(inspected.ok, JSON.stringify(inspected));
	const report = inspected.value;
	assert.equal(report.body.status, "unknown");
	assert.equal(report.body.model_ready, true);
	assert.equal(report.body.files_ready, false);
	assert.equal(report.eligibility.handoff_eligible, false);
	assert.equal(report.eligibility.state, "blocked");
	assert.ok(validateContract("PreflightReport", report).ok);
	assert.ok(
		validateProductionResult("inspectArtifact", inspected, context.scope).ok,
	);
	assert.equal(
		checkProductionPreflight(report, {
			artifact_ref: composed.value,
			spec_ref: report.body.spec_ref,
			rule_ref: report.body.rule_ref,
			parser_ref: given.records.composition.runtime_ref,
			files: [],
		}).ok,
		false,
	);
	assert.equal(report.body.findings.length, 3);
	const runtime = new CandidateRuntime(given.host());
	const details = report.body.findings.map((finding) => {
		assert.equal(finding.code, "PREFLIGHT_FAILED");
		assert.equal(finding.field_path, "/files");
		assert.equal(finding.state, "unknown");
		assert.equal(finding.severity, "hard_failure");
		assert.equal(finding.observed, null);
		assert.equal(finding.expected, "independently inspected file");
		const stored = z
			.object({ record: z.unknown(), value: z.unknown() })
			.parse(runtime.state.get(`evidence:${finding.evidence_ref.id}`));
		assert.ok(validateContract("ProductionResource", stored.record).ok);
		assert.ok(
			checkProductionValueIntegrity(
				"ProductionResource",
				stored.record,
				context.scope,
			).ok,
		);
		const record = z
			.object({
				byte_hash: z.string(),
				tenant_id: z.string(),
				project_id: z.string(),
			})
			.parse(stored.record);
		assert.equal(record.byte_hash, hashBytes(jsonBytes(stored.value)));
		assert.equal(record.tenant_id, context.scope.tenant_id);
		assert.equal(record.project_id, context.scope.project_id);
		return z
			.object({
				finding: z.object({
					code: z.string(),
					path: z.string(),
					ruleVersion: z.string(),
				}),
			})
			.parse(stored.value).finding;
	});
	assert.deepEqual(
		details.map((f) => [f.code, f.path, f.ruleVersion]),
		[
			["EXPORT_MISSING", "files.pdf", "private-preflight-2"],
			["EXPORT_MISSING", "files.png", "private-preflight-2"],
			["EXPORT_MISSING", "files.svg", "private-preflight-2"],
		],
	);
	const evidenceRows = given.db.sql
		.prepare(
			"SELECT bytes FROM canonical_records WHERE scope=? AND key LIKE 'evidence:%'",
		)
		.all(scopeKey(given.host().private_scope));
	for (const row of evidenceRows) {
		const bytes = z.object({ bytes: z.string() }).parse(row).bytes;
		assert.ok(!bytes.includes("Zoë O’Connor") && !bytes.includes("Seat 0007"));
		assert.ok(!bytes.includes(given.root));
	}
	assert.deepEqual(
		given.db.sql
			.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
			.all(),
		before,
	);
	assert.deepEqual(
		given.db.sql.prepare("SELECT id FROM observations ORDER BY sequence").all(),
		observations,
	);
	const restarted = given.restart();
	const first = report.body.findings[0];
	assert.ok(first);
	const retained = new CandidateRuntime(given.host()).state.get(
		`evidence:${first.evidence_ref.id}`,
	);
	assert.ok(retained);
	assert.equal(
		new CanonicalState(
			given.db,
			scopeSchema.parse({ tenant: "other-tenant", project: "other-project" }),
		).get(`evidence:${first.evidence_ref.id}`),
		null,
	);
	const replay = await restarted.operations.inspectArtifact(
		restarted.context,
		inspectRequest(given.records, composed.value),
	);
	assert.ok(replay.ok);
	assert.deepEqual(
		replay.value.body.findings.map((f) => [f.code, f.state, f.field_path]),
		report.body.findings.map((f) => [f.code, f.state, f.field_path]),
	);
	assert.equal(given.state.generationCalls + given.state.supplierCalls, 0);
});

for (const authority of [
	"asset",
	"composition",
	"access",
	"canonical",
] as const)
	test(`refreshes scoped ${authority} permission when an unexported draft is inspected`, async () => {
		// Given
		await using given = await fixtureHost();
		const host = given.host(),
			backend = given.records.profile.private_permissions;
		let denied = false;
		const calls: { readonly stage: string; readonly now: number }[] = [];
		const candidate = createCandidateProductionOperations({
			...host,
			access: async () => authority !== "access" || !denied,
			profiles: [
				{
					...given.records.profile,
					private_permissions: {
						...backend,
						async permission(request) {
							const result = await backend.permission(request);
							assert.ok(typeof result === "object" && result !== null);
							assert.deepEqual(request.binding.scope, host.private_scope);
							calls.push({ stage: request.stage, now: request.now });
							return {
								...result,
								...(authority === "asset" && denied
									? { state: "revoked" }
									: {}),
							};
						},
						async compositionPermission(request) {
							const result = await backend.compositionPermission(request);
							assert.ok(typeof result === "object" && result !== null);
							assert.deepEqual(request.model.input.scope, host.private_scope);
							calls.push({ stage: request.stage, now: request.now });
							return {
								...result,
								...(authority === "composition" && denied
									? { state: "revoked" }
									: {}),
							};
						},
					},
				},
			],
		});
		const composed = await candidate.operations.composeArtifact(
			candidate.context,
			given.records.request,
		);
		assert.ok(composed.ok);
		const before = given.db.sql
			.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
			.all();
		calls.length = 0;
		given.state.now = "2026-10-10T12:05:01.000Z";
		denied = true;
		if (authority === "canonical") given.state.revoked = true;
		// When
		const inspected = await candidate.operations.inspectArtifact(
			candidate.context,
			inspectRequest(given.records, composed.value),
		);
		// Then
		assert.ok(!inspected.ok);
		assert.equal(
			inspected.error.code,
			authority === "access"
				? "FORBIDDEN"
				: authority === "canonical"
					? "APPROVAL_REVOKED"
					: "APPROVAL_INVALID",
		);
		assert.ok(
			validateProductionResult(
				"inspectArtifact",
				inspected,
				candidate.context.scope,
			).ok,
		);
		assert.ok(!JSON.stringify(inspected).includes(given.root));
		if (authority === "asset" || authority === "composition") {
			assert.ok(calls.length > 0);
			assert.ok(
				calls.every(
					(call) =>
						call.stage === "inspect" &&
						call.now === Date.parse(given.state.now),
				),
			);
		}
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
				.all(),
			before,
		);
	});
