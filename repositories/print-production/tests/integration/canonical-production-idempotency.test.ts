import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	productionContentHash,
	productionReferences,
} from "@jevelopers/shared-contracts/production-operations";
import {
	adaptInput,
	adaptLayout,
	layoutCommitment,
} from "../../src/api/canonical-layout.js";
import { contentHash } from "../../src/api/canonical-values.js";

test("serializes concurrent duplicate composition behind one durable execution", async () => {
	await using given = await fixtureHost();
	const when = await Promise.all([
		given.candidate.operations.composeArtifact(
			given.candidate.context,
			given.records.request,
		),
		given.candidate.operations.composeArtifact(
			given.candidate.context,
			given.records.request,
		),
	]);
	assert.equal(when.filter((result) => result.ok).length, 1);
	assert.ok(
		when.some(
			(result) => !result.ok && result.error.code === "IDEMPOTENCY_CONFLICT",
		),
	);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		1,
	);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		1,
	);
});
test("rejects changed authenticated composition input under a published idempotency key", async () => {
	await using given = await fixtureHost();
	const composed = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		given.records.request,
	);
	assert.ok(composed.ok);
	const values = {
		...given.records.composition.values,
		name: { kind: "display" as const, value: "Changed exact input" },
	};
	const draft = {
		...given.records.composition,
		revision: 2,
		values,
		input_binding_hash: contentHash({
			values,
			fact_bindings: given.records.composition.fact_bindings,
			facts_ref: given.records.composition.facts_ref,
			formatting: given.records.composition.policy_refs.formatting,
		}),
	};
	const layout = adaptLayout(
		given.records.template,
		given.records.profile,
		given.records.scope,
	);
	const bound = {
		...draft,
		resolved_layout_commitment: layoutCommitment(
			adaptInput(draft, given.records.profile, { layout, factValues: {} }),
			given.records.profile,
			layout,
		),
	};
	const composition = { ...bound, content_hash: productionContentHash(bound) };
	const ref = {
		...given.records.request.binding.composition_ref,
		revision: 2,
		content_hash: composition.content_hash,
	};
	const request = {
		...given.records.request,
		binding: { ...given.records.request.binding, composition_ref: ref, values },
	};
	given.records.records.set(composition.composition_id, composition);
	const candidate = createCandidateProductionOperations({
		...given.host(),
		external_references: [
			...given.records.references,
			ref,
			...productionReferences(composition).map(([, value]) => value),
		],
	});
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "IDEMPOTENCY_CONFLICT");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		1,
	);
});
