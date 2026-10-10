import { test } from "node:test";
import assert from "node:assert/strict";
import { composeArtifact } from "../../src/composition/private-model.js";
import type {
	LayoutNode,
	PrivateArtifact,
} from "../../src/composition/private-model.js";
import { digest } from "../../src/composition/primitives.js";
import {
	inspectModel,
	finalFileEvidence,
} from "../../src/preflight/private-inspection.js";
import {
	fixtureArtifact,
	fixtureInput,
	artworkPng,
	safeLogo,
} from "../fixtures/composition/corpus.js";

const files = (artifact: PrivateArtifact) =>
	["svg", "png", "pdf"].map((format) =>
		finalFileEvidence({
			format,
			compositionHash: artifact.compositionHash,
			renderHash: artifact.renderHash,
			fileDigest: digest(`synthetic-hook-${format}`),
			parserRevision: "synthetic-hook-not-exporter",
			checks: ["dimensions", "content", "fonts", "container", "profile"].map(
				(name) => ({
					name,
					state: "passed",
					evidenceDigest: digest(`synthetic-check-${name}`),
				}),
			),
		}),
	);
test("passes local checks only for complete synthetic final hooks and never enables handoff", async () => {
	const f = await fixtureArtifact();
	const report = inspectModel(f.artifact, f.constraints, files(f.artifact));
	assert.equal(report.modelReady, true);
	assert.equal(report.draftReady, true);
	assert.equal(report.handoffEligible, false);
	assert.equal(report.productionEligibility, "unknown");
});
test("keeps missing final files blocked after a passing model inspection", async () => {
	const f = await fixtureArtifact();
	const report = inspectModel(f.artifact, f.constraints);
	assert.equal(report.modelReady, true);
	assert.equal(report.filesReady, false);
	assert.deepEqual(
		report.findings.map((f) => [f.code, f.path, f.state]),
		[
			["EXPORT_MISSING", "files.pdf", "unknown"],
			["EXPORT_MISSING", "files.png", "unknown"],
			["EXPORT_MISSING", "files.svg", "unknown"],
		],
	);
});
for (const patch of [
	{ width: 100 },
	{ height: 50 },
	{ minDpi: 1200 },
	{ profiles: [] },
	{ exports: [] },
	{ safe: { x: 9, y: 9, width: 80, height: 30 } },
	{ bleed: { x: 1, y: 1, width: 100, height: 49 } },
])
	test(`blocks incompatible constraints ${JSON.stringify(patch)}`, async () => {
		const f = await fixtureArtifact();
		const report = inspectModel(
			f.artifact,
			{ ...f.constraints, ...patch },
			files(f.artifact),
		);
		assert.equal(report.modelReady, false);
		assert.equal(report.handoffEligible, false);
		assert.ok(report.findings.some((f) => f.state === "unsupported"));
	});
for (const name of ["icc", "cmyk", "pdf-x"] as const)
	test(`blocks mandatory ${name} without claiming print-profile certification`, async () => {
		const f = await fixtureArtifact();
		const artifact = await composeArtifact(
			f.input,
			{ ...f.layout, profile: name },
			f.fonts,
			f.ports,
			1000,
		);
		const report = inspectModel(artifact, {
			...f.constraints,
			profiles: [name],
		});
		assert.ok(
			report.findings.some(
				(f) => f.code === "PROFILE_UNSUPPORTED" && f.state === "unsupported",
			),
		);
		assert.equal(report.modelReady, false);
	});
const mutations: readonly {
	readonly label: string;
	readonly code: string;
	readonly change: (node: LayoutNode) => LayoutNode;
}[] = [
	{
		label: "effective DPI after scale",
		code: "DPI_LOW",
		change: (n) =>
			n.kind === "artwork"
				? { ...n, transform: { ...n.transform, scaleX: 2 } }
				: n,
	},
	{
		label: "uncovered bleed",
		code: "BLEED_COVERAGE",
		change: (n) =>
			n.kind === "artwork"
				? { ...n, box: { ...n.box, x: 2, y: 2, width: 97.6, height: 48.8 } }
				: n,
	},
	{
		label: "rotated bleed corners",
		code: "BLEED_COVERAGE",
		change: (n) =>
			n.kind === "artwork"
				? { ...n, transform: { ...n.transform, rotation: 10 } }
				: n,
	},
	{
		label: "clipped required text",
		code: "CONTENT_CLIPPED",
		change: (n) =>
			n.kind === "text"
				? { ...n, clip: { x: 0, y: 0, width: 1, height: 1 } }
				: n,
	},
	{
		label: "unsafe transformed name",
		code: "SAFE_BOUNDS",
		change: (n) =>
			n.id === "name" ? { ...n, transform: { ...n.transform, x: -4 } } : n,
	},
	{
		label: "missing visible required layer",
		code: "REQUIRED_SLOT",
		change: (n) => (n.kind === "overlay" ? { ...n, visible: false } : n),
	},
	{
		label: "invisible exact fact",
		code: "EXACT_TEXT_VISIBILITY",
		change: (n) => (n.kind === "text" ? { ...n, opacity: 0 } : n),
	},
];
for (const row of mutations)
	test(`classifies ${row.label} deterministically`, async () => {
		const f = await fixtureArtifact();
		const artifact = await composeArtifact(
			{
				...f.artifact.model.input,
				nodes: f.artifact.model.input.nodes.map(row.change),
			},
			f.layout,
			f.fonts,
			f.ports,
			1000,
		);
		const report = inspectModel(artifact, f.constraints);
		assert.ok(report.findings.some((f) => f.code === row.code));
		assert.equal(report.modelReady, false);
		assert.equal(report.handoffEligible, false);
		assert.deepEqual(
			inspectModel(artifact, f.constraints).findings,
			report.findings,
		);
	});
test("classifies overflow as repairable and blocks it until resolved", async () => {
	const f = await fixtureArtifact("W".repeat(120));
	const report = inspectModel(f.artifact, f.constraints);
	assert.ok(
		report.findings.some(
			(f) =>
				f.code === "TEXT_OVERFLOW" &&
				f.severity === "repairable" &&
				f.repairEligible,
		),
	);
	assert.equal(report.modelReady, false);
});
test("rejects displayed text and source asset evidence tampering", async () => {
	const f = await fixtureArtifact();
	const first = f.artifact.texts[0];
	assert.ok(first?.state === "measured");
	for (const artifact of [
		{
			...f.artifact,
			texts: [
				{ ...first, formattedValue: "Changed Fact" },
				...f.artifact.texts.slice(1),
			],
		},
		{ ...f.artifact, svg: f.artifact.svg.replace("000123", "999999") },
		{
			...f.artifact,
			assets: f.artifact.assets.map((a) => ({
				...a,
				sourceBase64: Buffer.from("tampered").toString("base64"),
			})),
		},
	]) {
		const report = inspectModel(artifact, f.constraints);
		assert.equal(report.modelReady, false);
		assert.equal(report.handoffEligible, false);
	}
});
test("allows warnings only under an explicit versioned policy", async () => {
	const f = await fixtureArtifact();
	const nodes = f.artifact.model.input.nodes.map((n) =>
		n.kind === "overlay" ? { ...n, opacity: 0.9 } : n,
	);
	const blocked = await composeArtifact(
		{ ...f.artifact.model.input, nodes },
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	assert.equal(inspectModel(blocked, f.constraints).modelReady, false);
	const allowed = await composeArtifact(
		{ ...f.artifact.model.input, nodes },
		{
			...f.layout,
			policyRevision: "synthetic-warning-2",
			allowedWarnings: ["LAYER_OPACITY"],
		},
		f.fonts,
		f.ports,
		1000,
	);
	assert.equal(inspectModel(allowed, f.constraints).modelReady, true);
});
test("blocks transparency when the explicitly injected policy forbids it", async () => {
	const f = await fixtureArtifact();
	const artifact = await composeArtifact(
		f.input,
		{ ...f.layout, transparency: "forbid" },
		f.fonts,
		f.ports,
		1000,
	);
	assert.ok(
		inspectModel(artifact, {
			...f.constraints,
			transparency: "forbid",
		}).findings.some((f) => f.code === "TRANSPARENCY_FORBIDDEN"),
	);
});
test("checks actual low-resolution source bytes instead of claimed DPI metadata", async () => {
	const f = await fixtureArtifact(),
		art = artworkPng(100, 50);
	const artifact = await composeArtifact(
		fixtureInput(art),
		f.layout,
		f.fonts,
		{
			...f.ports,
			resolve: async (_scope, ref) =>
				ref === "synthetic-art" ? art : safeLogo,
		},
		1000,
	);
	const report = inspectModel(artifact, f.constraints);
	assert.ok(
		report.findings.some(
			(f) =>
				f.code === "DPI_LOW" &&
				typeof f.observed === "number" &&
				f.observed < 30,
		),
	);
});
test("rejects stale or incomplete final-file hook results", async () => {
	const f = await fixtureArtifact(),
		complete = files(f.artifact);
	for (const changed of [
		complete.slice(1),
		complete.map((file) => ({ ...file, compositionHash: digest("stale") })),
		complete.map((file) => ({ ...file, checks: file.checks.slice(1) })),
		complete.map((file) => ({
			...file,
			checks: file.checks.map((check) => ({
				...check,
				state: "unknown" as const,
			})),
		})),
		[...complete, complete[0]].filter((file) => file !== undefined),
	]) {
		const report = inspectModel(f.artifact, f.constraints, changed);
		assert.equal(report.filesReady, false);
		assert.equal(report.handoffEligible, false);
	}
});
test("unknown mandatory supplier checks never become ready", async () => {
	const f = await fixtureArtifact();
	const report = inspectModel(f.artifact, null, files(f.artifact));
	assert.equal(report.modelReady, false);
	assert.ok(
		report.findings.some(
			(f) => f.code === "SPEC_UNKNOWN" && f.state === "unknown",
		),
	);
});
