import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import {
	rowPolicy,
	sampleRows,
} from "../fixtures/production-output/fixture.js";
import {
	planRows,
	personalizeInput,
	resolveRowPolicy,
} from "../../src/personalization/private-rows.js";
import { fingerprint } from "../../src/composition/primitives.js";
import { OutputError } from "../../src/exporters/private-policy.js";

test("preserves exact strings and immutable facts when approved personal fields are bound", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input),
		rows = planRows(sampleRows, policy);
	const first = rows[0];
	assert.ok(first);
	const result = personalizeInput(f.artifact.model.input, first, policy);
	assert.equal(result.factsDigest, f.artifact.model.input.factsDigest);
	assert.equal(result.approvalDigest, f.artifact.model.input.approvalDigest);
	const text = result.nodes.find((n) => n.id === "detail");
	assert.ok(text?.kind === "text");
	assert.equal(text.field.source.value, "Seat 0007");
	assert.equal(first.inputDigest, fingerprint(sampleRows[0]));
	assert.equal(first.ordinal, 0);
});
test("keeps equal content distinct when row IDs differ", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input);
	const rows = planRows(
		[
			{ rowId: "a", fields: { name: "Alice", detail: "0007" } },
			{ rowId: "b", fields: { name: "Alice", detail: "0007" } },
		],
		policy,
	);
	assert.equal(rows.length, 2);
	assert.notEqual(rows[0]?.inputDigest, rows[1]?.inputDigest);
});
test("rejects duplicate identity when content differs", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input);
	assert.throws(
		() =>
			planRows(
				[
					{ rowId: "a", fields: { name: "Alice" } },
					{ rowId: "a", fields: { name: "Bob" } },
				],
				policy,
			),
		(error) => error instanceof OutputError && error.code === "ROW_DUPLICATE",
	);
});
test("records missing and undeclared fields before composition", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input);
	const rows = planRows(
			[{ rowId: "a", fields: { detail: "0007", event: "different fact" } }],
			policy,
		),
		first = rows[0];
	assert.ok(first);
	assert.deepEqual(
		first.errors.map((e) => e.path),
		["fields.event", "fields.name"],
	);
	assert.throws(
		() => personalizeInput(f.artifact.model.input, first, policy),
		OutputError,
	);
});
test("bounds structured bytes and rows when input exceeds policy", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input);
	assert.throws(() => planRows(sampleRows, { ...policy, maxRows: 1 }));
	assert.throws(
		() => planRows(sampleRows, { ...policy, maxBytes: 10 }),
		OutputError,
	);
});
test("rejects ambiguous or non-text template mappings", async () => {
	const f = await fixtureArtifact(),
		policy = rowPolicy(f.artifact.model.input);
	assert.throws(() =>
		resolveRowPolicy(
			{ ...policy, fields: [...policy.fields, policy.fields[0]] },
			f.artifact.model.input,
		),
	);
	assert.throws(
		() =>
			resolveRowPolicy(
				{
					...policy,
					fields: [
						{ field: "name", node: "art", required: true, maxLength: 100 },
					],
				},
				f.artifact.model.input,
			),
		OutputError,
	);
});
