import { test } from "node:test";
import assert from "node:assert/strict";
import {
	composeArtifact,
	imagePlacement,
	parseComposition,
} from "../../src/composition/private-model.js";
import { parseAsset } from "../../src/assets/private-assets.js";
import { inspectModel } from "../../src/preflight/private-inspection.js";
import { CompositionError, digest } from "../../src/composition/primitives.js";
import {
	fixtureArtifact,
	fixtureInput,
	artworkPng,
	syntheticPorts,
} from "../fixtures/composition/corpus.js";

for (const kind of ["artwork", "overlay"] as const)
	for (const scale of [0.5, 1.000001])
		test(`rejects ${kind} aspect distortion after contain fit with scaleX=${scale}`, async () => {
			const f = await fixtureArtifact();
			const input = {
				...f.artifact.model.input,
				nodes: f.artifact.model.input.nodes.map((n) =>
					n.kind === kind
						? {
								...n,
								fit: "contain" as const,
								transform: { ...n.transform, scaleX: scale, x: 42.5 },
							}
						: n,
				),
			};

			const action = () => parseComposition(input, f.layout);

			assert.throws(
				action,
				(e) => e instanceof CompositionError && e.path.endsWith("imageScale"),
			);
		});

test("rejects nonuniform PNG overlay transforms and direct placement bypass", async () => {
	const f = await fixtureArtifact(),
		logo = artworkPng(100, 100);
	const { ports } = syntheticPorts(f.art, logo);
	const input = fixtureInput(f.art, logo);
	const nodes = input.nodes.map((n) =>
		n.kind === "overlay"
			? { ...n, transform: { ...n.transform, scaleX: 0.5, x: 42.5 } }
			: n,
	);
	const overlay = f.artifact.model.input.nodes.find(
		(n) => n.kind === "overlay",
	);
	assert.ok(overlay?.kind === "overlay");

	await assert.rejects(
		composeArtifact({ ...input, nodes }, f.layout, f.fonts, ports, 1000),
		(e) => e instanceof CompositionError && e.path.endsWith("imageScale"),
	);
	assert.throws(
		() =>
			imagePlacement(
				{ ...overlay, transform: { ...overlay.transform, scaleX: 0.5 } },
				parseAsset(
					overlay.asset,
					Buffer.from(f.artifact.assets[1]?.sourceBase64 ?? "", "base64"),
				),
			),
		(e) => e instanceof CompositionError && e.path.endsWith("imageScale"),
	);
});

test("preserves source bytes through allowed uniform rotation and explicitly permitted crop", async () => {
	const f = await fixtureArtifact();
	const input = {
		...f.artifact.model.input,
		nodes: f.artifact.model.input.nodes.map((n) =>
			n.kind === "overlay"
				? {
						...n,
						crop: { x: 10, y: 10, width: 80, height: 80 },
						transform: {
							...n.transform,
							scaleX: 0.75,
							scaleY: 0.75,
							rotation: 90,
							x: 96.25,
							y: -56.75,
						},
					}
				: n,
		),
	};
	const layout = {
		...f.layout,
		slots: f.layout.slots.map((s) =>
			s.kind === "overlay" ? { ...s, allowCrop: true } : s,
		),
	};

	const artifact = await composeArtifact(input, layout, f.fonts, f.ports, 1000);

	assert.deepEqual(
		artifact.sourceArtworkHashes,
		f.artifact.sourceArtworkHashes,
	);
	assert.equal(inspectModel(artifact, f.constraints).modelReady, true);
	for (const asset of artifact.assets) {
		assert.equal(
			digest(Buffer.from(asset.sourceBase64, "base64")),
			asset.binding.digest,
		);
		assert.equal(asset.renderDigest, asset.binding.digest);
	}
});
