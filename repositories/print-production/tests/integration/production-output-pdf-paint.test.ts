import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import {
	fixtureArtifact,
	safeLogo,
	syntheticPorts,
	binding,
} from "../fixtures/composition/corpus.js";
import { composeArtifact } from "../../src/composition/private-model.js";
import {
	paintAttacks,
	mutatePaint,
} from "../fixtures/production-output/pdf-paint.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import { inspectPdf } from "../../src/exporters/private-pdf.js";
import { inspectOutputFiles } from "../../src/exporters/private-inspect.js";
import {
	defaultOutputPolicy,
	outputFile,
	OutputError,
} from "../../src/exporters/private-policy.js";
import { digest } from "../../src/composition/primitives.js";

async function prepareSource() {
	const f = await fixtureArtifact("Alice", "Seat 0007");
	const result = await exportPrivateFiles({
		artifact: f.artifact,
		constraints: f.constraints,
		ports: f.ports,
		now: 1000,
		policy: defaultOutputPolicy,
	});
	const file = result.files.find((f) => f.name === "output.pdf");
	assert.ok(file);
	const parent = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	const root = parent ? join(parent, "pdf-paint") : null;
	if (root) {
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "baseline.pdf"), file.bytes);
	}
	return Object.freeze({ f, result, file, root });
}

let source: Awaited<ReturnType<typeof prepareSource>>;
const cases: {
	readonly id: string;
	readonly digest: string;
	readonly inspectorAccepted: false;
	readonly finalFileEvidenceIssued: false;
}[] = [];

before(
	async () => {
		source = await prepareSource();
	},
	{ timeout: 30000 },
);

after(
	async () => {
		const { f, file, root } = source;
		if (!root) return;
		const inspected = await inspectPdf(file.bytes, f.artifact);
		await writeFile(
			join(root, "attacks.json"),
			JSON.stringify(
				{
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
					baselineDigest: digest(file.bytes),
					sourcePaint: inspected.semantics.sourcePaint,
					cases,
				},
				null,
				2,
			),
		);
	},
	{ timeout: 30000 },
);

test("binds complete source paint to the exact source graph", {
	timeout: 30000,
}, async () => {
	const { f, result, file } = source;
	const inspected = await inspectPdf(file.bytes, f.artifact);
	assert.deepEqual(inspected.semantics.lines, ["Alice", "Seat 0007"]);
	assert.equal(
		inspected.semantics.sourcePaint.actualGraphDigest,
		inspected.semantics.sourcePaint.reference.graphDigest,
	);
	assert.equal(result.report.draftReady, true);
});

for (const attack of paintAttacks) {
	test(`rejects paint mutation: ${attack.id}`, { timeout: 30000 }, async () => {
		const { f, result, file, root } = source;
		const bytes = await mutatePaint(file.bytes, attack);
		const rejects = (e: unknown) =>
			e instanceof OutputError &&
			["OUTPUT_CONTENT", "OUTPUT_UNSUPPORTED", "OUTPUT_LIMIT"].includes(e.code);
		await assert.rejects(inspectPdf(bytes, f.artifact), rejects, attack.id);
		await assert.rejects(
			inspectOutputFiles({
				files: result.files.map((v) =>
					v.name === file.name ? outputFile(v.name, bytes) : v,
				),
				artifact: f.artifact,
				policy: defaultOutputPolicy,
				pixelDigest: result.pixelDigest,
			}),
			rejects,
			attack.id,
		);
		cases.push({
			id: attack.id,
			digest: digest(bytes),
			inspectorAccepted: false,
			finalFileEvidenceIssued: false,
		});
		if (root) await writeFile(join(root, `${attack.id}.pdf`), bytes);
	});
}

test("accepts metadata changes with unchanged paint", {
	timeout: 30000,
}, async () => {
	const { f, file } = source;
	const doc = await PDFDocument.load(file.bytes, { updateMetadata: false });
	doc.setTitle("Correct metadata never replaces paint evidence");
	await inspectPdf(await doc.save({ useObjectStreams: false }), f.artifact);
});

for (const id of ["shifted", "added", "changed"] as const) {
	test(`rejects original paint and accepts the ${id} source logo`, {
		timeout: 30000,
	}, async () => {
		const { f, file } = source;
		const logo = Buffer.from(
			safeLogo
				.toString()
				.replace(
					id === "shifted" ? 'x="5"' : id === "added" ? "</svg>" : 'r="25"',
					id === "shifted"
						? 'x="6"'
						: id === "added"
							? '<rect x="20" y="20" width="3" height="3" fill="#134c67"/></svg>'
							: 'r="24"',
				),
		);
		const { ports } = syntheticPorts(f.art, logo);
		const input = {
			...f.input,
			nodes: f.input.nodes.map((node) =>
				node.id === "logo"
					? { ...node, asset: binding("synthetic-logo", logo, "overlay") }
					: node,
			),
		};
		const artifact = await composeArtifact(
			input,
			f.layout,
			f.fonts,
			ports,
			1000,
		);
		await assert.rejects(
			inspectPdf(file.bytes, artifact),
			(e) => e instanceof OutputError && e.path === "pdf.sourcePaintIdentity",
			id,
		);
		const changed = await exportPrivateFiles({
			artifact,
			constraints: f.constraints,
			ports,
			now: 1000,
			policy: defaultOutputPolicy,
		});
		assert.equal(changed.report.draftReady, true);
	});
}

for (const envelope of [
	{
		id: "extra EOF marker",
		mutate: (bytes: Uint8Array) =>
			Buffer.concat([bytes, Buffer.from("\n%%EOF")]),
	},
	{
		id: "duplicate Tabs entry",
		mutate: (bytes: Uint8Array) =>
			Buffer.from(
				Buffer.from(bytes)
					.toString("latin1")
					.replace("/Tabs /S", "/Tabs /S /Tabs /S"),
				"latin1",
			),
	},
] as const) {
	test(`rejects malformed envelope: ${envelope.id}`, {
		timeout: 30000,
	}, async () => {
		const { f, file } = source;
		await assert.rejects(
			inspectPdf(envelope.mutate(file.bytes), f.artifact),
			(e) => e instanceof OutputError,
		);
	});
}

test("accepts inherited page resources with unchanged paint", {
	timeout: 30000,
}, async () => {
	const { f, file } = source;
	const doc = await PDFDocument.load(file.bytes, { updateMetadata: false });
	doc.setTitle("Correct metadata never replaces paint evidence");
	const parentNode = doc.getPage(0).node.Parent();
	assert.ok(parentNode);
	const resources = doc.getPage(0).node.get(PDFName.of("Resources"));
	assert.ok(resources);
	parentNode.set(PDFName.of("Resources"), resources);
	doc.getPage(0).node.delete(PDFName.of("Resources"));
	await inspectPdf(await doc.save({ useObjectStreams: false }), f.artifact);
});
