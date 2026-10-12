import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	batchRequest,
	statusRequest,
} from "../fixtures/canonical-production/requests.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import { contract } from "../../src/api/canonical-values.js";
import type { PermissionStage } from "../../src/assets/private-assets.js";

for (const authority of ["asset", "composition"] as const)
	test(`refreshes ${authority} authority for compose/export/batch replay and artifact/job observation`, {
		timeout: 60000,
	}, async () => {
		await using given = await fixtureHost();
		let denied = false;
		const calls: {
			readonly stage: PermissionStage;
			readonly now: number;
			readonly values: readonly string[];
		}[] = [];
		const backend = given.records.profile.private_permissions;
		const host = given.host();
		const candidate = createCandidateProductionOperations({
			...host,
			profiles: [
				{
					...given.records.profile,
					private_permissions: {
						...backend,
						async permission(request) {
							const decision = await backend.permission(request);
							assert.ok(typeof decision === "object" && decision !== null);
							if (authority === "asset")
								calls.push({
									stage: request.stage,
									now: request.now,
									values: [],
								});
							return {
								...decision,
								...(authority === "asset" && denied
									? { state: "revoked" }
									: {}),
							};
						},
						async compositionPermission(request) {
							const decision = await backend.compositionPermission(request);
							assert.ok(typeof decision === "object" && decision !== null);
							const values = request.model.input.nodes.flatMap((node) =>
								node.kind === "text" && node.field.source.kind === "display"
									? [node.field.source.value]
									: [],
							);
							if (authority === "composition")
								calls.push({ stage: request.stage, now: request.now, values });
							return {
								...decision,
								...(authority === "composition" && denied
									? { state: "revoked" }
									: {}),
							};
						},
					},
				},
			],
		});
		const { operations, context } = candidate;
		const composed = await operations.composeArtifact(
			context,
			given.records.request,
		);
		assert.ok(composed.ok);
		const exporting = exportRequest(given.records, composed.value);
		const exported = await operations.exportArtifactBundle(context, exporting);
		assert.ok(exported.ok);
		const batch = batchRequest(given.records);
		const job = await operations.personalizeArtifactBatch(context, batch);
		assert.ok(job.ok && job.value.contract === "JobRef");
		const artifactStatus = statusRequest(given.records.request, {
			kind: "artifact",
			artifact_ref: composed.value,
		});
		const jobStatus = statusRequest(given.records.request, {
			kind: "job",
			job_ref: job.value,
		});
		const before = given.db.sql
			.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
			.all();
		const observations = given.db.sql
			.prepare("SELECT id FROM observations ORDER BY sequence")
			.all();
		given.state.now = "2026-10-10T12:05:01.000Z";
		denied = true;
		for (const [invoke, stage] of [
			[
				() => operations.composeArtifact(context, given.records.request),
				"compose",
			],
			[() => operations.exportArtifactBundle(context, exporting), "export"],
			[
				() => operations.getArtifactManifestStatus(context, artifactStatus),
				"inspect",
			],
			[() => operations.personalizeArtifactBatch(context, batch), "export"],
			[
				() => operations.getArtifactManifestStatus(context, jobStatus),
				"export",
			],
		] as const) {
			calls.length = 0;
			const when = await invoke();
			assert.ok(!when.ok, JSON.stringify(when));
			assert.equal(when.error.code, "APPROVAL_INVALID");
			assert.ok(calls.length > 0);
			assert.ok(
				calls.every(
					(call) =>
						call.stage === stage && call.now === Date.parse(given.state.now),
				),
			);
		}
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
				.all(),
			before,
		);
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id FROM observations ORDER BY sequence")
				.all(),
			observations,
		);
		denied = false;
		assert.deepEqual(
			await operations.exportArtifactBundle(context, exporting),
			exported,
		);
		calls.length = 0;
		assert.deepEqual(
			await operations.personalizeArtifactBatch(context, batch),
			job,
		);
		if (authority === "composition") {
			assert.ok(calls.some((call) => call.values.includes("Café Áda")));
			assert.ok(calls.some((call) => call.values.includes("Zoë O’Connor")));
		}
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
				.all(),
			before,
		);
	});

for (const authority of ["canonical", "access"] as const)
	test(`denies replay when only ${authority} authority changes`, async () => {
		await using given = await fixtureHost();
		let denied = false;
		const host = given.host();
		const candidate = createCandidateProductionOperations({
			...host,
			access: async () => (authority === "access" ? !denied : true),
			context: {
				...host.context,
				authorization: {
					async verify(ref, scope) {
						const result = await host.context.authorization.verify(ref, scope);
						assert.ok(result.ok);
						return {
							ok: true,
							value: contract("ApprovalVerificationOutcome", {
								...result.value,
								status:
									authority === "canonical" && denied ? "revoked" : "valid",
							}),
						};
					},
				},
			},
		});
		const { operations, context } = candidate;
		const artifact = await operations.composeArtifact(
			context,
			given.records.request,
		);
		assert.ok(artifact.ok);
		denied = true;
		const when = await operations.composeArtifact(
			context,
			given.records.request,
		);
		assert.ok(!when.ok);
		assert.equal(
			when.error.code,
			authority === "access" ? "FORBIDDEN" : "APPROVAL_REVOKED",
		);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
			1,
		);
	});

test("refreshes the planned model for cancelled job observation without inventing an artifact", async () => {
	await using given = await fixtureHost();
	let denied = false;
	const backend = given.records.profile.private_permissions;
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		profiles: [
			{
				...given.records.profile,
				private_permissions: {
					...backend,
					async compositionPermission(request) {
						const decision = await backend.compositionPermission(request);
						assert.ok(typeof decision === "object" && decision !== null);
						return { ...decision, state: denied ? "revoked" : "allowed" };
					},
				},
			},
		],
	});
	given.controller.abort();
	const request = batchRequest(given.records);
	const job = await candidate.operations.personalizeArtifactBatch(
		candidate.context,
		request,
	);
	assert.ok(job.ok && job.value.contract === "JobRef");
	denied = true;
	const when = await candidate.operations.getArtifactManifestStatus(
		candidate.context,
		statusRequest(given.records.request, { kind: "job", job_ref: job.value }),
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "APPROVAL_INVALID");
	const replay = await candidate.operations.personalizeArtifactBatch(
		candidate.context,
		request,
	);
	assert.ok(!replay.ok);
	assert.equal(replay.error.code, "APPROVAL_INVALID");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		0,
	);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});
