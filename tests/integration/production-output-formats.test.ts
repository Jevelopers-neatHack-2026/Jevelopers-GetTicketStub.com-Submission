import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	fixtureArtifact,
	fixtureLayout,
	fixtureConstraints,
} from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import { defaultOutputPolicy } from "../../src/exporters/private-policy.js";
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
	const directory = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	if (directory)
		await writeFile(
			join(directory, "exporter-reproducibility.json"),
			JSON.stringify(
				{
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"],
					mode: "independent-browser-normalized-byte-comparison",
					byteEquality: true,
					semanticEquality: true,
					pixelEquality: true,
					files: a.files.map((file, index) => ({
						name: file.name,
						firstDigest: file.digest,
						secondDigest: b.files[index]?.digest,
						length: file.length,
					})),
					descriptors: a.descriptors,
					environment: a.environment,
					browser: a.browser,
					pixelDigest: a.pixelDigest,
					handoffEligible: false,
				},
				null,
				2,
			),
		);
});
for (const [id, name, rtl] of [
	["arabic", "مرحبا بالعالم", true],
	[
		"wrap-spaces",
		"A long exact attendee name wrapping across multiple measured lines",
		false,
	],
] as const)
	test(`proves exact ${id} PDF from parsed glyph clusters despite lossy reader corroboration`, {
		timeout: 30000,
	}, async () => {
		const f = await fixtureArtifact(name, "Seat 0007", rtl);
		const exported = await exportPrivateFiles(localContext(f));
		const pdf = exported.files.find((file) => file.name === "output.pdf");
		assert.ok(pdf);
		const inspected = await (
			await import("../../src/exporters/private-pdf.js")
		).inspectPdf(pdf.bytes, f.artifact);
		assert.deepEqual(
			inspected.semantics.lines,
			f.artifact.texts.flatMap((t) =>
				t.state === "measured"
					? t.lines.filter((l) => l.value.length > 0).map((l) => l.value)
					: [],
			),
		);
		assert.equal(inspected.readerCorroboration.exactLinesMatch, false);
		assert.equal(exported.report.draftReady, true);
		assert.equal(exported.handoffEligible, false);
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
