import { test } from "node:test";
import assert from "node:assert/strict";
import {
	fixtureArtifact,
	fixtureLayout,
	fixtureConstraints,
} from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import {
	defaultOutputPolicy,
	OutputError,
} from "../../src/exporters/private-policy.js";
import { composeArtifact } from "../../src/composition/private-model.js";
const localContext = (f: Awaited<ReturnType<typeof fixtureArtifact>>) => ({
	artifact: f.artifact,
	constraints: f.constraints,
	ports: f.ports,
	now: 1000,
	policy: defaultOutputPolicy,
});
test("replays normalized file bytes and semantic descriptors in independent browsers", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		a = await exportPrivateFiles(localContext(f)),
		b = await exportPrivateFiles(localContext(f));
	assert.deepEqual(
		a.files.map((f) => f.digest),
		b.files.map((f) => f.digest),
	);
	assert.deepEqual(a.descriptors, b.descriptors);
	assert.equal(a.pixelDigest, b.pixelDigest);
});
for (const [id, name, rtl] of [
	["arabic", "مرحبا بالعالم", true],
	[
		"wrap-spaces",
		"A long exact attendee name wrapping across multiple measured lines",
		false,
	],
] as const)
	test(`blocks requested PDF honestly for unsupported exact ${id}`, {
		timeout: 30000,
	}, async () => {
		const f = await fixtureArtifact(name, "Seat 0007", rtl);
		await assert.rejects(
			exportPrivateFiles(localContext(f)),
			(error) =>
				error instanceof OutputError &&
				error.code === "OUTPUT_CONTENT" &&
				error.path === "pdf.exactUnicodeOrWrapSpaces",
		);
	});
test("renders Arabic and wrap spaces exactly when the explicit template requests supported SVG and PNG", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact("مرحبا بالعالم", "Seat 0007", true),
		layout = fixtureLayout(),
		limited = { ...layout, exports: ["svg", "png"] as const };
	const artifact = await composeArtifact(
			f.input,
			limited,
			f.fonts,
			f.ports,
			1000,
		),
		exported = await exportPrivateFiles({
			...localContext(f),
			artifact,
			constraints: fixtureConstraints(limited),
		});
	assert.equal(exported.files.length, 2);
	assert.equal(exported.report.draftReady, true);
	assert.ok(artifact.svg.includes("مرحبا بالعالم"));
});
