import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildCorpus,
	buildVariants,
	inventoryOf,
	referenceCheck,
	type CorpusFile,
} from "../../scripts/diagnostics/pp16-bundle-handoff.js";

// Non-rendered stand-in bytes: these tests cover inventory/variant semantics
// only. Real renderer bytes exist solely in Linux CI output.
const text = (value: unknown) =>
	new TextEncoder().encode(
		typeof value === "string" ? value : JSON.stringify(value),
	);
const manifest = {
	tenant_id: "t",
	project_id: "p",
	usage_refs: [],
	schema_version: "2.0.0",
	bundle_id: "b",
	bundle_hash: "sha256:0",
};
const lineage = {
	accepted: false,
	live_integration: false,
	canonical_usage_intake: "unavailable",
	finance_receipt: null,
};
const baseline = (overrides: Record<string, unknown> = {}): CorpusFile[] => [
	{ name: "output.png", bytes: Uint8Array.from([1, 2, 3, 4]) },
	{ name: "output.svg", bytes: text("<svg/>") },
	{ name: "lineage.json", bytes: text({ ...lineage, ...overrides }) },
	{ name: "manifest.json", bytes: text(manifest) },
	{ name: "detached.json", bytes: text("{}") },
	{ name: "archive.zip", bytes: Uint8Array.from([9, 9, 9]) },
	{
		name: "trusted-commitment.json",
		bytes: text({ eligibility: { handoff_eligible: false } }),
	},
];
const withoutCommitment = (files: CorpusFile[]) =>
	files.filter((f) => f.name !== "trusted-commitment.json");

test("every variant yields exactly its expected problems and the baseline is untouched", () => {
	const base = withoutCommitment(baseline());
	const snapshot = base.map((f) => Buffer.from(f.bytes).toString("hex"));
	const pinned = inventoryOf(base);
	const variants = buildVariants(base);
	assert.deepEqual(
		variants.map((v) => v.id),
		[
			"valid",
			"tampered-payload",
			"tampered-manifest",
			"tampered-detached",
			"missing-payload",
			"missing-manifest",
			"extra-file",
		],
	);
	for (const v of variants) {
		assert.deepEqual(referenceCheck(v.files, pinned), v.expectedProblems, v.id);
		assert.equal(v.expected === "accepted", v.expectedProblems.length === 0);
	}
	assert.deepEqual(
		base.map((f) => Buffer.from(f.bytes).toString("hex")),
		snapshot,
	);
});

test("a single flipped byte and a length-preserving swap are both detected", () => {
	const pinned = inventoryOf(withoutCommitment(baseline()));
	const swapped = withoutCommitment(baseline()).map((f) =>
		f.name === "output.svg" ? { name: f.name, bytes: text("<svg />") } : f,
	);
	assert.deepEqual(referenceCheck(swapped, pinned), [
		"hash-mismatch:output.svg",
	]);
	const dup = [
		...withoutCommitment(baseline()),
		...withoutCommitment(baseline()),
	];
	assert.ok(referenceCheck(dup, pinned).includes("duplicate-name"));
});

const runtime = { node: "v24.21.0", platform: "linux" };
const accept = () => ({ ok: true, detail: "stub" });

test("corpus keeps synthetic/unapproved/ineligible status and blocks stale-spec", () => {
	// A stub owner that accepts everything must be flagged as non-conforming.
	const corpus = buildCorpus(
		{ bundle: baseline(), revision: "r" },
		{ accepted: false },
		accept,
		runtime,
	);
	assert.equal(corpus.conforms, false);
	assert.equal(corpus.synthetic, true);
	assert.equal(corpus.accepted, false);
	assert.equal(corpus.handoffEligible, false);
	assert.equal(corpus.canonical_usage_intake, "unavailable");
	assert.equal(corpus.finance_receipt, null);
	assert.deepEqual(corpus.usage_refs, []);
	assert.ok(corpus.blocked_variants.some((b) => b.id === "stale-spec"));
	assert.ok(!corpus.variants.some((v) => v.id === "stale-spec"));
	const valid = corpus.variants.find((v) => v.id === "valid");
	assert.equal(valid?.conforms, true);
	assert.equal(
		corpus.variants.find((v) => v.id === "extra-file")?.conforms,
		false,
	);
});

test("refuses lineage that claims acceptance, usage intake or finance receipts", () => {
	for (const bad of [
		{ accepted: true },
		{ canonical_usage_intake: "available" },
		{ finance_receipt: "r1" },
	])
		assert.throws(() =>
			buildCorpus(
				{ bundle: baseline(bad), revision: "r" },
				null,
				accept,
				runtime,
			),
		);
});
