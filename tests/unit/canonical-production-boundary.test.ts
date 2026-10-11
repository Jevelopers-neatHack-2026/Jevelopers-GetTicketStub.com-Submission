import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { batchRequest } from "../fixtures/canonical-production/requests.js";
import { contract, checked } from "../../src/api/canonical-values.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	validateProductionResult,
	checkProductionValueIntegrity,
} from "@jevelopers/shared-contracts/production-operations";

for (const trustedField of ["authority", "scope", "runtime"] as const)
	test(`rejects replaced host ${trustedField} before resolver access`, async () => {
		await using given = await fixtureHost();
		const ctx = {
			...given.candidate.context,
			[trustedField]: { ...given.candidate.context[trustedField] },
		};
		const when = await given.candidate.operations.composeArtifact(
			ctx,
			given.records.request,
		);
		assert.ok(!when.ok);
		assert.equal(when.error.code, "FORBIDDEN");
		assert.equal(given.state.resolverCalls + given.state.assetCalls, 0);
		assert.equal(when.error.side_effects, "none");
		assert.ok(
			validateProductionResult("composeArtifact", when, given.records.scope).ok,
		);
	});
for (const field of ["content_hash", "id", "revision"] as const)
	test(`rejects wrong canonical ${field} before resolver access`, async () => {
		await using given = await fixtureHost();
		const template = given.records.request.binding.template_ref;
		const request = contract("ComposeArtifactRequest", {
			...given.records.request,
			binding: {
				...given.records.request.binding,
				template_ref: {
					...template,
					[field]:
						field === "revision"
							? 2
							: field === "id"
								? "123e4567-e89b-42d3-a456-000000000999"
								: `sha256:${"f".repeat(64)}`,
				},
			},
		});
		const when = await given.candidate.operations.composeArtifact(
			given.candidate.context,
			request,
		);
		assert.ok(!when.ok);
		assert.equal(when.error.code, "NOT_FOUND");
		assert.equal(given.state.resolverCalls + given.state.assetCalls, 0);
	});
test("rejects request authority overrides before resolver access", async () => {
	await using given = await fixtureHost();
	const when = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		{
			...given.records.request,
			...{ authority: { actor_id: "forged", audience: "print-production" } },
		},
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "INVALID_INPUT");
	assert.equal(given.state.resolverCalls, 0);
});
test("rejects unsupported schema version before resolver access", async () => {
	await using given = await fixtureHost();
	const request = structuredClone(given.records.request);
	Object.assign(request, { schema_version: "9.0.0" });
	const when = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "UNSUPPORTED_VERSION");
	assert.equal(given.state.resolverCalls, 0);
});
test("handles invalid host clocks without the upstream invalid-clock TypeError or resolver calls", async () => {
	await using given = await fixtureHost();
	given.state.now = "invalid-clock";
	const when = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "INVALID_INPUT");
	assert.equal(given.state.resolverCalls, 0);
});
for (const state of ["revoked", "stale", "missing", "tampered"] as const)
	test(`rejects ${state} canonical inputs without publishing output`, async () => {
		await using given = await fixtureHost();
		given.state[state] = true;
		const when = await given.candidate.operations.composeArtifact(
			given.candidate.context,
			given.records.request,
		);
		assert.ok(!when.ok);
		assert.equal(
			when.error.code,
			state === "revoked"
				? "APPROVAL_REVOKED"
				: state === "stale"
					? "APPROVAL_INVALID"
					: state === "missing"
						? "NOT_FOUND"
						: "HASH_MISMATCH",
		);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
				"n"
			],
			0,
		);
		assert.equal(when.error.diagnostic_ref.state, "persisted");
		if (when.error.diagnostic_ref.state === "persisted") {
			const raw = given.db.sql
				.prepare("SELECT bytes FROM canonical_records WHERE key=?")
				.get(`diagnostic:${when.error.diagnostic_ref.reference.id}`)?.["bytes"];
			assert.equal(typeof raw, "string");
			if (typeof raw === "string")
				checked(
					checkProductionValueIntegrity(
						"ProductionDiagnostic",
						JSON.parse(raw),
						given.records.scope,
					),
				);
		}
	});
test("blocks configured production mode before resolver or supplier access", async () => {
	await using given = await fixtureHost();
	const candidate = createCandidateProductionOperations({
		...given.host(),
		context: { ...given.host().context, environment: "production" },
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "INCOMPATIBLE_TEMPLATE");
	assert.equal(given.state.resolverCalls + given.state.supplierCalls, 0);
});
test("rejects duplicate structured row IDs before scheduling any execution", async () => {
	await using given = await fixtureHost();
	const request = batchRequest(given.records);
	assert.ok(request.input.kind === "structured");
	const first = request.input.rows[0];
	assert.ok(first);
	const when = await given.candidate.operations.personalizeArtifactBatch(
		given.candidate.context,
		{ ...request, input: { ...request.input, rows: [first, first] } },
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "ROW_DUPLICATE");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		0,
	);
});
test("rejects CSV capability without an enabling host policy", async () => {
	await using given = await fixtureHost();
	const original = batchRequest(given.records);
	const csv = contract("PersonalizeBatchRequest", {
		...original,
		input: {
			kind: "csv",
			file_ref: given.records.request.binding.asset_refs[0]?.asset_ref,
			dialect_ref: {
				contract: "CsvDialect",
				schema_version: "1.0.0",
				id: "123e4567-e89b-42d3-a456-000000000901",
				revision: 1,
				content_hash: `sha256:${"d".repeat(64)}`,
			},
			mapping_ref: {
				contract: "CsvMapping",
				schema_version: "1.0.0",
				id: "123e4567-e89b-42d3-a456-000000000902",
				revision: 1,
				content_hash: `sha256:${"d".repeat(64)}`,
			},
		},
	});
	const candidate = createCandidateProductionOperations({
		...given.host(),
		external_references: [
			...given.records.references,
			...(csv.input.kind === "csv"
				? [csv.input.dialect_ref, csv.input.mapping_ref]
				: []),
		],
	});
	const when = await candidate.operations.personalizeArtifactBatch(
		candidate.context,
		csv,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "CAPABILITY_DISABLED");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.["n"],
		0,
	);
});
