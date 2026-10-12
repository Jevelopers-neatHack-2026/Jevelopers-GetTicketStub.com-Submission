import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	batchRequest,
	statusRequest,
	inspectRequest,
} from "../fixtures/canonical-production/requests.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	DurabilityDatabase,
	defaultLimits,
	hash,
} from "../../src/internal/durability.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { observe } from "../../src/telemetry/observations.js";
import {
	validateProductionResult,
	productionContentHash,
} from "@jevelopers/shared-contracts/production-operations";
import { contract, contentHash } from "../../src/api/canonical-values.js";
import {
	adaptLayout,
	adaptInput,
	layoutCommitment,
} from "../../src/api/canonical-layout.js";

test("preserves independent export histories when different keys target one artifact", async () => {
	await using given = await fixtureHost();
	const { operations, context } = given.candidate;
	const composed = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(composed.ok);
	const request = exportRequest(given.records, composed.value);
	const first = await operations.exportArtifactBundle(context, request);
	assert.ok(first.ok);
	const secondRequest = { ...request, idempotency_key: "second-export" };
	const when = await operations.exportArtifactBundle(context, secondRequest);
	assert.ok(when.ok, JSON.stringify(when));
	assert.notEqual(when.value.bundle_ref.id, first.value.bundle_ref.id);
	assert.deepEqual(
		await operations.exportArtifactBundle(context, request),
		first,
	);
	assert.deepEqual(
		await operations.exportArtifactBundle(context, secondRequest),
		when,
	);
	const status = await operations.getArtifactManifestStatus(
		context,
		statusRequest(given.records.request, {
			kind: "artifact",
			artifact_ref: composed.value,
		}),
	);
	assert.ok(status.ok);
	assert.deepEqual(status.value.bundle_ref, when.value);
});

test("reuses original batch plan when transport IDs and explicit default policy change", async () => {
	await using given = await fixtureHost();
	const original = batchRequest(given.records, "atomic");
	assert.equal(original.input.kind, "structured");
	const { acceptance_policy: _default, ...withoutDefault } = original;
	const { operations, context } = given.candidate;
	const first = await operations.personalizeArtifactBatch(
		context,
		withoutDefault,
	);
	assert.ok(first.ok);
	const before = given.db.sql.prepare("SELECT id,outcome FROM attempts").all();
	const when = await operations.personalizeArtifactBatch(
		context,
		contract("PersonalizeBatchRequest", {
			...original,
			request_id: "123e4567-e89b-42d3-a456-000000000881",
			correlation_id: "123e4567-e89b-42d3-a456-000000000882",
		}),
	);
	assert.deepEqual(when, first);
	assert.deepEqual(
		given.db.sql.prepare("SELECT id,outcome FROM attempts").all(),
		before,
	);
});

const crossRealmRejection: unknown = runInNewContext(
	'new Error("PRIVATE_EXCEPTION_SENTINEL")',
);
for (const [name, rejection] of [
	["string", "PRIVATE_EXCEPTION_SENTINEL"],
	["object", { secret: "PRIVATE_EXCEPTION_SENTINEL" }],
	["null", null],
	["undefined", undefined],
	["cross-realm Error", crossRealmRejection],
] as const) {
	for (const duringAttempt of [false, true])
		test(`contains ${name} callback rejection when ${duringAttempt ? "executing" : "resolving"}`, async () => {
			await using given = await fixtureHost();
			const host = given.host();
			const candidate = createCandidateProductionOperations(
				duringAttempt
					? {
							...host,
							profiles: [
								{
									...given.records.profile,
									private_permissions: {
										...given.records.profile.private_permissions,
										permission: async () => Promise.reject(rejection),
									},
								},
							],
						}
					: {
							...host,
							context: {
								...host.context,
								references: { resolve: async () => Promise.reject(rejection) },
							},
						},
			);
			const when = await candidate.operations.composeArtifact(
				candidate.context,
				given.records.request,
			);
			assert.ok(!when.ok);
			assert.equal(when.error.code, "INTEGRITY_FAILURE");
			assert.ok(
				validateProductionResult("composeArtifact", when, given.records.scope)
					.ok,
			);
			assert.equal(
				JSON.stringify(when).includes("PRIVATE_EXCEPTION_SENTINEL"),
				false,
			);
			assert.equal(
				JSON.stringify(
					given.db.sql.prepare("SELECT * FROM observations").all(),
				).includes("PRIVATE_EXCEPTION_SENTINEL"),
				false,
			);
			assert.deepEqual(
				given.db.sql
					.prepare("SELECT outcome FROM attempts")
					.all()
					.map((row) => row["outcome"]),
				duringAttempt ? ["failed"] : [],
			);
		});
}

test("denies cached compose and artifact observation when only private authority is revoked", async () => {
	await using given = await fixtureHost();
	let denied = false;
	const backend = given.records.profile.private_permissions;
	const candidate = createCandidateProductionOperations({
		...given.host(),
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
	const { operations, context } = candidate;
	const composed = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(composed.ok);
	denied = true;
	const when = await Promise.all([
		operations.composeArtifact(context, given.records.request),
		operations.getArtifactManifestStatus(
			context,
			statusRequest(given.records.request, {
				kind: "artifact",
				artifact_ref: composed.value,
			}),
		),
	]);
	for (const result of when) {
		assert.ok(!result.ok);
		assert.equal(result.error.code, "APPROVAL_INVALID");
	}
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		1,
	);
});

test("retains succeeded publication outcome when only two outbox slots remain", async () => {
	await using given = await fixtureHost();
	using db = new DurabilityDatabase(
		`${given.root}/capacity.sqlite`,
		{ ...defaultLimits, maxPendingEvents: 10 },
		() => Date.parse(given.state.now),
	);
	const host = { ...given.host(), db };
	const candidate = createCandidateProductionOperations(host);
	const bytes = Buffer.from("seed");
	const seed = new LocalArtifactStore(db).bind(
		host.private_scope,
		"seed",
		"seed",
		bytes,
		hash(bytes),
	);
	db.transaction(() => {
		for (let i = 0; i < 8; i++) observe(db, seed.id, "planned");
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(when.ok, JSON.stringify(when));
	assert.equal(
		db.sql.prepare("SELECT outcome FROM attempts").get()?.["outcome"],
		"succeeded",
	);
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		1,
	);
});

test("composes unchanged content when a registered repair pin is present", async () => {
	await using given = await fixtureHost();
	using db = new DurabilityDatabase(
		`${given.root}/repair.sqlite`,
		undefined,
		() => Date.parse(given.state.now),
	);
	const ref = {
		...given.records.composition.policy_refs.layout,
		id: "123e4567-e89b-42d3-a456-000000000883",
	};
	const draft = {
		...given.records.composition,
		policy_refs: { ...given.records.composition.policy_refs, repair: ref },
	};
	const composition = { ...draft, content_hash: productionContentHash(draft) };
	const compositionRef = {
		...given.records.request.binding.composition_ref,
		content_hash: composition.content_hash,
	};
	const request = {
		...given.records.request,
		binding: {
			...given.records.request.binding,
			composition_ref: compositionRef,
			repair_policy_ref: ref,
		},
	};
	given.records.records.set(composition.composition_id, composition);
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		db,
		external_references: [
			...host.external_references.filter((r) => r.id !== compositionRef.id),
			compositionRef,
			ref,
		],
		profiles: [
			{ ...given.records.profile, policy_refs: composition.policy_refs },
		],
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		request,
	);
	assert.ok(when.ok, JSON.stringify(when));
	assert.deepEqual(
		await candidate.operations.composeArtifact(candidate.context, request),
		when,
	);
	const exported = await candidate.operations.exportArtifactBundle(
		candidate.context,
		exportRequest({ ...given.records, composition }, when.value),
	);
	assert.ok(exported.ok, JSON.stringify(exported));
	assert.deepEqual(
		await candidate.operations.exportArtifactBundle(
			candidate.context,
			exportRequest({ ...given.records, composition }, when.value),
		),
		exported,
	);
	assert.deepEqual(
		when.value.source_artwork_hashes,
		composition.asset_uses
			.filter((use) => use.purpose === "artwork")
			.map((use) => use.asset_ref.content_hash),
	);
	const wrong = { ...ref, id: "123e4567-e89b-42d3-a456-000000000884" };
	const delivery = createCandidateProductionOperations({
		...host,
		db,
		external_references: [
			...host.external_references.filter((r) => r.id !== compositionRef.id),
			compositionRef,
			ref,
			wrong,
		],
		profiles: [
			{ ...given.records.profile, policy_refs: composition.policy_refs },
		],
	});
	const mismatch = await delivery.operations.composeArtifact(delivery.context, {
		...request,
		binding: { ...request.binding, repair_policy_ref: wrong },
	});
	assert.ok(!mismatch.ok);
	assert.equal(mismatch.error.code, "HASH_MISMATCH");
});

test("keeps a pinned composition requiring text repair blocked at export without altering content", async () => {
	await using given = await fixtureHost();
	using db = new DurabilityDatabase(
		`${given.root}/required-repair.sqlite`,
		undefined,
		() => Date.parse(given.state.now),
	);
	const ref = {
		...given.records.composition.policy_refs.layout,
		id: "123e4567-e89b-42d3-a456-000000000885",
	};
	const profile = {
		...given.records.profile,
		policy_refs: { ...given.records.profile.policy_refs, repair: ref },
		input: {
			...given.records.profile.input,
			nodes: given.records.profile.input.nodes.map((node) =>
				node.kind === "text" && node.id === "name"
					? { ...node, field: { ...node.field, wrap: "none" as const } }
					: node,
			),
		},
	};
	const values = {
		...given.records.composition.values,
		name: { kind: "display" as const, value: "W".repeat(26) },
	};
	const draft = {
		...given.records.composition,
		values,
		policy_refs: profile.policy_refs,
		input_binding_hash: contentHash({
			values,
			fact_bindings: given.records.composition.fact_bindings,
			facts_ref: given.records.composition.facts_ref,
			formatting: given.records.composition.policy_refs.formatting,
		}),
	};
	const layout = adaptLayout(
		given.records.template,
		profile,
		given.records.scope,
	);
	const bound = {
		...draft,
		resolved_layout_commitment: layoutCommitment(
			adaptInput(draft, profile, { layout, factValues: {} }),
			profile,
			layout,
		),
	};
	const composition = { ...bound, content_hash: productionContentHash(bound) };
	const compositionRef = {
		...given.records.request.binding.composition_ref,
		content_hash: composition.content_hash,
	};
	const request = {
		...given.records.request,
		binding: {
			...given.records.request.binding,
			values,
			composition_ref: compositionRef,
			repair_policy_ref: ref,
		},
	};
	given.records.records.set(composition.composition_id, composition);
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		db,
		external_references: [
			...host.external_references.filter((r) => r.id !== compositionRef.id),
			compositionRef,
			ref,
		],
		profiles: [profile],
	});
	const artifact = await candidate.operations.composeArtifact(
		candidate.context,
		request,
	);
	assert.ok(artifact.ok, JSON.stringify(artifact));
	const records = { ...given.records, composition };
	const report = await candidate.operations.inspectArtifact(
		candidate.context,
		inspectRequest(records, artifact.value),
	);
	assert.ok(report.ok);
	assert.equal(report.value.body.model_ready, false);
	assert.ok(
		report.value.body.findings.some(
			(finding) =>
				finding.severity === "repairable" &&
				finding.state === "failed" &&
				finding.unit === "nm" &&
				typeof finding.observed === "number" &&
				typeof finding.expected === "number" &&
				finding.observed > finding.expected,
		),
	);
	const when = await candidate.operations.exportArtifactBundle(
		candidate.context,
		exportRequest(records, artifact.value),
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "PREFLIGHT_FAILED");
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		1,
	);
});

test("contains unknown rejection when diagnostic persistence also fails", async () => {
	await using given = await fixtureHost();
	given.db.sql.exec(
		"CREATE TRIGGER reject_diagnostic BEFORE INSERT ON canonical_records WHEN NEW.key LIKE 'diagnostic:%' BEGIN SELECT RAISE(ABORT,'synthetic diagnostic outage'); END;",
	);
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		context: {
			...host.context,
			references: {
				resolve: async () =>
					Promise.reject({ secret: "PRIVATE_EXCEPTION_SENTINEL" }),
			},
		},
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "INTEGRITY_FAILURE");
	assert.equal(when.error.diagnostic_ref.state, "unavailable");
	assert.equal(
		JSON.stringify(when).includes("PRIVATE_EXCEPTION_SENTINEL"),
		false,
	);
});

test("blocks publication when canonical runtime record cannot be resolved", async () => {
	await using given = await fixtureHost();
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		context: {
			...host.context,
			references: {
				async resolve(ref, scope) {
					if (ref.contract === "ProductionRuntime")
						return Promise.reject(new Error("runtime record unavailable"));
					return host.context.references.resolve(ref, scope);
				},
			},
		},
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});
