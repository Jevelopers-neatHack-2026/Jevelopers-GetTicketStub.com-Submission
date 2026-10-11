import { test } from "node:test";
import assert from "node:assert/strict";
import {
	composeArtifact,
	parseComposition,
} from "../../src/composition/private-model.js";
import { CompositionError } from "../../src/composition/primitives.js";
import { inspectModel } from "../../src/preflight/private-inspection.js";
import {
	planRepair,
	resolveRepairPolicy,
} from "../../src/repair/private-repair.js";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";

for (const [scale, allowed] of [
	[0.01, false],
	[0.499999, false],
	[0.5, true],
	[1.75, true],
	[1.750001, false],
] as const)
	test(`enforces physical 2..7 mm text when uniform scale is ${scale}`, async () => {
		const f = await fixtureArtifact();
		const input = {
			...f.artifact.model.input,
			nodes: f.artifact.model.input.nodes.map((n) =>
				n.kind === "text"
					? {
							...n,
							transform: {
								...n.transform,
								scaleX: scale,
								scaleY: scale,
								x: 7,
								y: 28,
								rotation: 12,
							},
						}
					: n,
			),
		};

		const action = () => parseComposition(input, f.layout);

		if (allowed) assert.doesNotThrow(action);
		else
			assert.throws(
				action,
				(e) =>
					e instanceof CompositionError &&
					e.path.startsWith("nodes.") &&
					e.path.endsWith("physicalTextSize"),
			);
	});

test("rejects nonuniform text scaling even when both physical axes are in bounds", async () => {
	const f = await fixtureArtifact();
	const input = {
		...f.artifact.model.input,
		nodes: f.artifact.model.input.nodes.map((n) =>
			n.kind === "text"
				? { ...n, transform: { ...n.transform, scaleX: 0.75, scaleY: 1 } }
				: n,
		),
	};

	const action = () => parseComposition(input, f.layout);

	assert.throws(
		action,
		(e) => e instanceof CompositionError && e.path.endsWith("textScale"),
	);
});

test("preflight and repair planning fail closed on a copied model with transform size bypass", async () => {
	const f = await fixtureArtifact();
	const artifact = {
		...f.artifact,
		model: {
			...f.artifact.model,
			input: {
				...f.artifact.model.input,
				nodes: f.artifact.model.input.nodes.map((n) =>
					n.kind === "text"
						? {
								...n,
								transform: {
									...n.transform,
									scaleX: 0.01,
									scaleY: 0.01,
									x: 7,
									y: 7,
								},
							}
						: n,
				),
			},
		},
	};
	const policy = resolveRepairPolicy({
		revision: "synthetic-scale-repair-1",
		permissionRef: "synthetic-scale-permission",
		permission: "mechanical",
		maxTotalAttempts: 16,
		fields: [
			{
				node: "name",
				minSize: 2,
				maxSize: 7,
				step: 0.25,
				maxAttempts: 16,
				maxMoveMm: 30,
				fallbackOrder: [],
				allowNormalize: false,
			},
		],
	});

	const report = inspectModel(artifact, f.constraints);
	const plan = planRepair(artifact, policy, { kind: "shrink", node: "name" });

	assert.ok(
		report.findings.some(
			(f) =>
				f.code === "TEXT_SIZE_POLICY" &&
				f.path === "nodes.name.physicalTextSize",
		),
	);
	assert.equal(plan.state, "NEEDS_EXTERNAL_REVIEW");
});

test("repair shrinking never drops below the physical minimum through uniform scale", async () => {
	const f = await fixtureArtifact();
	const artifact = await composeArtifact(
		{
			...f.artifact.model.input,
			nodes: f.artifact.model.input.nodes.map((n) =>
				n.id === "name" && n.kind === "text"
					? {
							...n,
							transform: {
								...n.transform,
								scaleX: 0.5,
								scaleY: 0.5,
								x: 3.5,
								y: 3.5,
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
	const policy = resolveRepairPolicy({
		revision: "synthetic-physical-repair-1",
		permissionRef: "synthetic-scale-permission",
		permission: "mechanical",
		maxTotalAttempts: 16,
		fields: [
			{
				node: "name",
				minSize: 2,
				maxSize: 7,
				step: 0.25,
				maxAttempts: 16,
				maxMoveMm: 0,
				fallbackOrder: [],
				allowNormalize: false,
			},
		],
	});

	const plan = planRepair(artifact, policy, { kind: "shrink", node: "name" });

	assert.equal(inspectModel(artifact, f.constraints).modelReady, true);
	assert.equal(plan.state, "NEEDS_EXTERNAL_REVIEW");
});
