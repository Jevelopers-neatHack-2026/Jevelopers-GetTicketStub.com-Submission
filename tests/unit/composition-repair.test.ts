import { test } from "node:test";
import assert from "node:assert/strict";
import {
	composeArtifact,
	artifactIdentityHash,
} from "../../src/composition/private-model.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import {
	inspectModel,
	finalFileEvidence,
} from "../../src/preflight/private-inspection.js";
import {
	applyRepair,
	planRepair,
	resolveRepairPolicy,
} from "../../src/repair/private-repair.js";
import { fixtureArtifact, privateRef } from "../fixtures/composition/corpus.js";

function policy() {
	return resolveRepairPolicy({
		revision: "synthetic-repair-1",
		permissionRef: "synthetic-mechanical-permission",
		permission: "mechanical",
		maxTotalAttempts: 16,
		fields: [
			{
				node: "name",
				minSize: 2,
				maxSize: 7,
				step: 0.25,
				maxAttempts: 16,
				maxMoveMm: 8,
				fallbackOrder: ["synthetic-latin-subset"],
				allowNormalize: false,
			},
			{
				node: "logo",
				minSize: 2,
				maxSize: 7,
				step: 0.25,
				maxAttempts: 16,
				maxMoveMm: 0,
				fallbackOrder: [],
				allowNormalize: true,
			},
		],
	});
}
async function overflowFixture() {
	const f = await fixtureArtifact("W".repeat(26));
	const artifact = await composeArtifact(
		{
			...f.artifact.model.input,
			nodes: f.artifact.model.input.nodes.map((n) =>
				n.id === "name" && n.kind === "text"
					? { ...n, field: { ...n.field, wrap: "none" } }
					: n,
			),
		},
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	return { ...f, artifact };
}
test("plans and applies a bounded exact-name shrink to a new immutable revision", async () => {
	const f = await overflowFixture(),
		original = f.artifact.revision,
		p = policy();
	const plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	assert.ok(plan.findingCodes.includes("TEXT_OVERFLOW"));
	assert.ok(plan.after.kind === "text" && plan.before.kind === "text");
	assert.ok(plan.after.field.sizeMm >= 2);
	assert.equal(
		(plan.before.field.sizeMm - plan.after.field.sizeMm) / plan.bounds.step,
		plan.attempts,
	);
	const result = await applyRepair(
		f.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	assert.equal(result.artifact.parent, original);
	assert.equal(f.artifact.revision, original);
	assert.deepEqual(
		result.artifact.sourceArtworkHashes,
		f.artifact.sourceArtworkHashes,
	);
	assert.deepEqual(
		result.artifact.texts.map((t) => t.field.source),
		f.artifact.texts.map((t) => t.field.source),
	);
	assert.equal(result.report.modelReady, true);
	assert.equal(result.report.handoffEligible, false);
	assert.equal(result.receipt.finalFiles, "unknown");
});
test("reapplication is a no-op with fresh permission observation", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	const first = await applyRepair(
		f.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(first.state === "APPLIED_DRAFT");
	const before = f.state.permissionCalls;
	const second = await applyRepair(
		first.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1001,
	);
	assert.ok(second.state === "NO_OP");
	assert.equal(second.artifact, first.artifact);
	assert.ok(f.state.permissionCalls > before);
});
test("escalates material fact, logo or artwork changes", async () => {
	const f = await fixtureArtifact();
	for (const node of ["name", "logo", "art"]) {
		const result = planRepair(f.artifact, policy(), { kind: "material", node });
		assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	}
	assert.equal(f.state.generationCalls, 0);
});
test("does not run repairs without explicit input permission", async () => {
	const f = await overflowFixture();
	const result = planRepair(
		f.artifact,
		{ ...policy(), permission: "none" },
		{ kind: "shrink", node: "name" },
	);
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
});
test("escalates an exact name that cannot fit within minimum size and attempt limits", async () => {
	const f = await fixtureArtifact("W".repeat(600));
	const result = planRepair(f.artifact, policy(), {
		kind: "shrink",
		node: "name",
	});
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
});
test("rejects a stale immutable compare-and-swap precondition", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		{ ...f.artifact, revision: digest("other-current-revision") },
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	assert.ok(
		"reasons" in result && result.reasons.includes("STALE_PRECONDITION"),
	);
});
test("rejects plan tampering rather than applying unauthorized before/after values", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED" && plan.after.kind === "text");
	const forged = {
		...plan,
		after: {
			...plan.after,
			field: {
				...plan.after.field,
				source: { kind: "display" as const, value: "Changed Name" },
			},
		},
	};
	const result = await applyRepair(
		f.artifact,
		forged,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
});
test("keeps the original unchanged when current external applicability rejects a derivative", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	f.state.denyDerived = true;
	const original = fingerprint(f.artifact);
	const result = await applyRepair(
		f.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	assert.equal(fingerprint(f.artifact), original);
});
test("detects oscillation and bounded total attempts", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	for (const history of [
		{ attempts: 16, seen: [] },
		{ attempts: 0, seen: [f.artifact.compositionHash] },
	]) {
		const result = await applyRepair(
			f.artifact,
			plan,
			p,
			f.constraints,
			f.ports,
			1000,
			history,
		);
		assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	}
});
test("repositions exact text only within its safe slot and numeric movement policy", async () => {
	const f = await fixtureArtifact(),
		artifact = await composeArtifact(
			{
				...f.artifact.model.input,
				nodes: f.artifact.model.input.nodes.map((n) =>
					n.id === "name" ? { ...n, transform: { ...n.transform, x: -4 } } : n,
				),
			},
			f.layout,
			f.fonts,
			f.ports,
			1000,
		);
	assert.equal(inspectModel(artifact, f.constraints).modelReady, false);
	const p = policy(),
		plan = planRepair(artifact, p, {
			kind: "reposition",
			node: "name",
			x: 0,
			y: 0,
		});
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	assert.equal(result.report.modelReady, true);
	assert.equal(
		planRepair(artifact, p, { kind: "reposition", node: "name", x: 20, y: 0 })
			.state,
		"NEEDS_EXTERNAL_REVIEW",
	);
	assert.equal(
		planRepair(artifact, p, { kind: "reposition", node: "name", x: -3, y: -5 })
			.state,
		"NEEDS_EXTERNAL_REVIEW",
	);
});
test("rejects repositioning into another semantic layer even inside an allowed safe slot", async () => {
	const f = await fixtureArtifact();
	const layout = {
		...f.layout,
		revision: "synthetic-overlap-2",
		slots: f.layout.slots.map((s) =>
			s.id === "name-slot" ? { ...s, bounds: f.layout.safe } : s,
		),
	};
	const artifact = await composeArtifact(
		f.artifact.model.input,
		layout,
		f.fonts,
		f.ports,
		1000,
	);
	const p = resolveRepairPolicy({
		...policy(),
		fields: policy().fields.map((field) =>
			field.node === "name" ? { ...field, maxMoveMm: 30 } : field,
		),
	});
	const result = planRepair(artifact, p, {
		kind: "reposition",
		node: "name",
		x: 0,
		y: 21,
	});
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	assert.ok("reasons" in result && result.reasons.includes("MOVE_OVERLAP"));
});
test("changes fonts only to a pinned approved policy order with complete glyph coverage", async () => {
	const f = await fixtureArtifact("Alice"),
		p = policy();
	const artifact = await composeArtifact(
		{
			...f.artifact.model.input,
			nodes: f.artifact.model.input.nodes.map((n) =>
				n.id === "name" && n.kind === "text"
					? {
							...n,
							field: {
								...n.field,
								fontOrder: [
									privateRef("synthetic-latin"),
									privateRef("synthetic-latin-subset"),
								],
							},
						}
					: n,
			),
		},
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	const plan = planRepair(artifact, p, { kind: "fallback", node: "name" });
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	const text = result.artifact.texts[0];
	assert.ok(text?.state === "measured");
	assert.equal(text.font.ref, "synthetic-latin-subset");
	assert.equal(text.formattedValue, "Alice");
});
test("normalizes only declared harmless SVG container metadata and retains source provenance", async () => {
	const f = await fixtureArtifact(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "normalize", node: "logo" });
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		f.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	const asset = result.artifact.assets.find(
		(a) => a.binding.purpose === "overlay",
	);
	assert.ok(asset?.derivative);
	assert.equal(
		asset.binding.digest,
		f.artifact.assets.find((a) => a.binding.purpose === "overlay")?.binding
			.digest,
	);
	assert.notEqual(asset.renderDigest, asset.binding.digest);
	assert.deepEqual(
		result.artifact.sourceArtworkHashes,
		f.artifact.sourceArtworkHashes,
	);
});
test("rejects missing fallback approval, no-progress moves and invalid numeric policies", async () => {
	const f = await fixtureArtifact();
	assert.equal(
		planRepair(f.artifact, policy(), { kind: "fallback", node: "name" }).state,
		"NEEDS_EXTERNAL_REVIEW",
	);
	assert.equal(
		planRepair(f.artifact, policy(), {
			kind: "reposition",
			node: "name",
			x: 0,
			y: 0,
		}).state,
		"NEEDS_EXTERNAL_REVIEW",
	);
	assert.throws(() =>
		resolveRepairPolicy({ ...policy(), maxTotalAttempts: 1000 }),
	);
	assert.throws(() =>
		resolveRepairPolicy({
			...policy(),
			fields: policy().fields.map((f) => ({ ...f, step: 0 })),
		}),
	);
});
test("failed final-file checks preserve the original repair input", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		f.artifact,
		plan,
		p,
		f.constraints,
		f.ports,
		1000,
		{ attempts: 0, seen: [] },
		async (artifact) => [
			finalFileEvidence({
				format: "pdf",
				compositionHash: artifact.compositionHash,
				renderHash: artifact.renderHash,
				artifactIdentityHash: artifactIdentityHash(artifact),
				svgDigest: digest(artifact.svg),
				fileDigest: digest("synthetic-bad-pdf"),
				parserRevision: "synthetic-negative-file-hook",
				checks: [
					{
						name: "content",
						state: "failed",
						evidenceDigest: digest("missing exact text"),
					},
				],
			}),
		],
	);
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	assert.ok("original" in result && result.original === f.artifact);
});
test("requires a current mechanical permission bound to the precise plan and resulting revision", async () => {
	const f = await overflowFixture(),
		p = policy(),
		plan = planRepair(f.artifact, p, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	for (const patch of [
		{ state: "unknown" },
		{ state: "revoked" },
		{ planHash: digest("another-plan") },
		{ policyHash: digest("another-policy") },
		{ precondition: digest("stale") },
		{ result: digest("another-result") },
		{ permissionRef: "wrong-ref" },
		{ validUntil: 1000 },
	]) {
		const result = await applyRepair(
			f.artifact,
			plan,
			p,
			f.constraints,
			{
				...f.ports,
				repairPermission: async (request) => {
					const decision = await f.ports.repairPermission(request);
					assert.ok(typeof decision === "object" && decision !== null);
					return { ...decision, ...patch };
				},
			},
			1000,
		);
		assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
		assert.ok(
			"reasons" in result &&
				result.reasons.includes("REPAIR_PERMISSION_BLOCKED"),
		);
	}
});
test("rejects a safe-zone move that intersects a semantic vector separator", async () => {
	const f = await fixtureArtifact(),
		layout = {
			...f.layout,
			revision: "synthetic-shape-overlap-2",
			slots: f.layout.slots.map((s) =>
				s.id === "name-slot" ? { ...s, bounds: f.layout.safe } : s,
			),
		},
		artifact = await composeArtifact(
			f.artifact.model.input,
			layout,
			f.fonts,
			f.ports,
			1000,
		);
	const p = resolveRepairPolicy({
		...policy(),
		fields: policy().fields.map((field) =>
			field.node === "name" ? { ...field, maxMoveMm: 30 } : field,
		),
	});
	const result = planRepair(artifact, p, {
		kind: "reposition",
		node: "name",
		x: 0,
		y: 16.5,
	});
	assert.equal(result.state, "NEEDS_EXTERNAL_REVIEW");
	assert.ok("reasons" in result && result.reasons.includes("MOVE_OVERLAP"));
});
