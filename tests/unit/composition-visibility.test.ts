import { test } from "node:test";
import assert from "node:assert/strict";
import { composeArtifact } from "../../src/composition/private-model.js";
import { inspectModel } from "../../src/preflight/private-inspection.js";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";

test("blocks required text and logo when opaque artwork paints above them", async () => {
	// Given the approved background with only its paint order changed.
	const f = await fixtureArtifact();
	const artifact = await composeArtifact(
		{
			...f.input,
			nodes: f.input.nodes.map((n) =>
				n.id === "art" ? { ...n, order: 6 } : n,
			),
		},
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	// When inspecting the actual display order.
	const report = inspectModel(artifact, f.constraints);
	// Then each required semantic layer is blocked, even though all nodes exist.
	for (const id of ["name", "detail", "logo"])
		assert.ok(
			report.findings.some(
				(f) =>
					f.code === "CONTENT_OCCLUSION" && f.path === `nodes.${id}.visibility`,
			),
		);
	assert.equal(report.modelReady, false);
	assert.equal(report.handoffEligible, false);
});

for (const kind of ["shape", "overlay"] as const)
	for (const target of ["name", "logo"])
		for (const partial of [false, true])
			test(`blocks ${partial ? "partial" : "full"} ${kind} paint above required ${target}`, async () => {
				// Given a later cover assigned a declared slot, inside the safe page.
				const f = await fixtureArtifact();
				const node = f.artifact.model.input.nodes.find((n) => n.id === target);
				const source = f.artifact.model.input.nodes.find(
					(n) => n.kind === kind,
				);
				assert.ok(
					node &&
						source &&
						(source.kind === "shape" || source.kind === "overlay"),
				);
				const box =
					target === "name"
						? { x: 7, y: 7, width: partial ? 10 : 74, height: 16 }
						: { x: 85, y: 7, width: partial ? 4 : 8, height: 8 };
				const cover = {
					...source,
					id: "cover",
					slot: "cover-slot",
					order: 6,
					box,
					...(source.kind === "overlay" ? { fit: "cover" as const } : {}),
				};
				const slot = f.layout.slots.find((s) => s.id === source.slot);
				assert.ok(slot);
				const artifact = await composeArtifact(
					{ ...f.input, nodes: [...f.input.nodes, cover] },
					{
						...f.layout,
						slots: [
							...f.layout.slots,
							{
								...slot,
								id: "cover-slot",
								required: false,
								bounds: f.layout.safe,
								allowCrop: true,
								fits: ["contain", "exact", "cover"],
							},
						],
					},
					f.fonts,
					f.ports,
					1000,
				);
				// When a transparent SVG or vector cover may intersect semantic content.
				const report = inspectModel(artifact, f.constraints);
				// Then unresolved visibility is a hard failure, never an allowed warning.
				assert.ok(
					report.findings.some(
						(f) =>
							f.code === "CONTENT_OCCLUSION" &&
							f.path === `nodes.${target}.visibility` &&
							f.severity === "hard_failure",
					),
				);
				assert.equal(report.modelReady, false);
			});

test("allows backgrounds below content and disjoint later paint", async () => {
	// Given the normal background, disjoint separator and excluded proof guide.
	const f = await fixtureArtifact();
	// When inspecting its ordered paint.
	const report = inspectModel(f.artifact, f.constraints);
	// Then semantic visibility remains valid.
	assert.equal(report.modelReady, true);
	assert.ok(!report.findings.some((f) => f.code === "CONTENT_OCCLUSION"));
});
