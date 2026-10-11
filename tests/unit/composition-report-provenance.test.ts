import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrivateArtifact } from "../../src/composition/private-model.js";
import { composeArtifact } from "../../src/composition/private-model.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import {
	finalFileEvidence,
	inspectArtifact,
	inspectModel,
} from "../../src/preflight/private-inspection.js";
import {
	applyRepair,
	planRepair,
	resolveRepairPolicy,
} from "../../src/repair/private-repair.js";
import { fixtureArtifact, privateRef } from "../fixtures/composition/corpus.js";

function files(
	a: PrivateArtifact,
	patch: Readonly<Record<string, unknown>> = {},
) {
	return ["svg", "png", "pdf"].map((format) =>
		finalFileEvidence({
			format,
			compositionHash: a.compositionHash,
			renderHash: a.renderHash,
			artifactIdentityHash: fingerprint({
				compositionHash: a.compositionHash,
				renderHash: a.renderHash,
				revision: a.revision,
				sourceArtworkHashes: a.sourceArtworkHashes,
			}),
			svgDigest: digest(a.svg),
			parserRevision: "synthetic-provenance-hook-1",
			checks: ["dimensions", "content", "fonts", "container", "profile"].map(
				(name) => ({
					name,
					state: "passed",
					evidenceDigest: digest(`synthetic-${format}-${name}`),
				}),
			),
			...patch,
			fileDigest:
				format === "svg"
					? digest(a.svg)
					: (patch["fileDigest"] ?? digest(`synthetic-hook-${format}`)),
		}),
	);
}

test("full report distinguishes file, parser and check evidence when findings are identical", async () => {
	const f = await fixtureArtifact();
	const baseline = inspectModel(f.artifact, f.constraints, files(f.artifact));

	for (const patch of [
		{ fileDigest: digest("different-final-bytes") },
		{ parserRevision: "synthetic-provenance-hook-2" },
		{
			checks: ["dimensions", "content", "fonts", "container", "profile"].map(
				(name) => ({
					name,
					state: "passed",
					evidenceDigest: digest(`different-proof-${name}`),
				}),
			),
		},
	]) {
		const changed = inspectModel(
			f.artifact,
			f.constraints,
			files(f.artifact, patch),
		);
		assert.deepEqual(changed.findings, baseline.findings);
		assert.notEqual(changed.reportHash, baseline.reportHash);
		assert.ok("findingsHash" in changed && "findingsHash" in baseline);
		assert.equal(changed.findingsHash, baseline.findingsHash);
		assert.ok("checkedFiles" in changed);
	}
});

test("full report binds constraints, policy and composition even without failures", async () => {
	const f = await fixtureArtifact();
	const baseline = inspectModel(f.artifact, f.constraints, files(f.artifact));
	const revised = await composeArtifact(
		{ ...f.artifact.model.input, inputPolicyRevision: "synthetic-input-2" },
		{ ...f.layout, policyRevision: "synthetic-policy-2" },
		f.fonts,
		f.ports,
		1000,
	);

	for (const constraints of [
		{ ...f.constraints, sourceDigest: digest("new-spec-bytes") },
		{ ...f.constraints, specRef: privateRef("synthetic-spec-2") },
	]) {
		const changed = inspectModel(f.artifact, constraints, files(f.artifact));
		assert.notEqual(changed.reportHash, baseline.reportHash);
	}
	const policyChanged = inspectModel(revised, f.constraints, files(revised));

	assert.notEqual(policyChanged.reportHash, baseline.reportHash);
	assert.ok(
		"renderHash" in policyChanged &&
			"policyHash" in policyChanged &&
			"constraintHash" in policyChanged,
	);
});

test("canonical file and check ordering replay the identical full envelope", async () => {
	const f = await fixtureArtifact(),
		evidence = files(f.artifact);
	const baseline = inspectModel(f.artifact, f.constraints, evidence);

	const reordered = inspectModel(
		f.artifact,
		f.constraints,
		[...evidence]
			.reverse()
			.map((f) => ({ ...f, checks: [...f.checks].reverse() })),
	);

	assert.equal(reordered.reportHash, baseline.reportHash);
	assert.ok("envelope" in baseline);
	assert.equal(baseline.reportHash, fingerprint(baseline.envelope));
	assert.deepEqual(reordered, baseline);
	assert.ok(Object.isFrozen(baseline));
});

test("permission readiness changes full report identity and retains file provenance", async () => {
	const f = await fixtureArtifact(),
		evidence = files(f.artifact);
	const allowed = await inspectArtifact(
		f.artifact,
		f.constraints,
		f.ports,
		1000,
		evidence,
	);
	f.state.revoked = true;

	const denied = await inspectArtifact(
		f.artifact,
		f.constraints,
		f.ports,
		1000,
		evidence,
	);

	assert.notEqual(allowed.reportHash, denied.reportHash);
	assert.ok(
		"envelope" in allowed && "envelope" in denied && "checkedFiles" in denied,
	);
	assert.equal(allowed.reportHash, fingerprint(allowed.envelope));
	assert.equal(denied.reportHash, fingerprint(denied.envelope));
});

test("repair receipts reference the exact full checked-file report on idempotent replay", async () => {
	const f = await fixtureArtifact();
	const policy = resolveRepairPolicy({
		revision: "synthetic-provenance-repair-1",
		permissionRef: "synthetic-repair-permission",
		permission: "mechanical",
		maxTotalAttempts: 1,
		fields: [
			{
				node: "name",
				minSize: 2,
				maxSize: 7,
				step: 0.25,
				maxAttempts: 1,
				maxMoveMm: 0,
				fallbackOrder: [],
				allowNormalize: false,
			},
		],
	});
	const plan = planRepair(f.artifact, policy, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");

	const applied = await applyRepair(
		f.artifact,
		plan,
		policy,
		f.constraints,
		f.ports,
		1000,
		{ attempts: 0, seen: [] },
		async (a) => files(a),
	);
	assert.ok(applied.state === "APPLIED_DRAFT");
	const replay = await applyRepair(
		applied.artifact,
		plan,
		policy,
		f.constraints,
		f.ports,
		1000,
		applied.history,
		async (a) => files(a),
	);

	assert.ok(replay.state === "NO_OP");
	assert.equal(applied.receipt.finalFiles, "checked");
	assert.equal(applied.receipt.reportHash, replay.report.reportHash);
	assert.ok(
		"checkedFiles" in applied.report &&
			"envelope" in applied.report &&
			"checkedFiles" in replay.report,
	);
	assert.equal(
		applied.receipt.reportHash,
		fingerprint(applied.report.envelope),
	);
	assert.deepEqual(applied.report.checkedFiles, replay.report.checkedFiles);
	assert.deepEqual(applied.receipt.checkedFiles, applied.report.checkedFiles);
	assert.equal(
		applied.receipt.checkedFilesHash,
		fingerprint(applied.report.checkedFiles),
	);
	assert.equal(applied.receipt.repairPolicyHash, fingerprint(policy));
});
