import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { composeArtifact } from "../../src/composition/private-model.js";
import { inspectModel } from "../../src/preflight/private-inspection.js";
import {
	applyRepair,
	planRepair,
	resolveRepairPolicy,
} from "../../src/repair/private-repair.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { renderDraft } from "../fixtures/composition/render-draft.js";

let root: string,
	keep = false;
before(async () => {
	const requested = process.env["PP_COMPOSITION_EVIDENCE_DIR"];
	root = requested ?? (await mkdtemp(join(tmpdir(), "pp-composition-render-")));
	keep = requested !== undefined;
	await mkdir(root, { recursive: true });
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});
const variants = [
	{
		id: "attendee-001",
		name: "Zoë O’Connor",
		detail: "Row 0002 • Seat 0007 • Serial 000123",
		rtl: false,
	},
	{
		id: "attendee-002",
		name: "D'Arcy 0009",
		detail: "Venue: Synthetic Hall • 10/09/2026",
		rtl: false,
	},
	{
		id: "combining",
		name: "Café Ångström",
		detail: "Row 0010 • Seat 0001 • Serial 000024",
		rtl: false,
	},
	{
		id: "multiline",
		name: "Anne\nMarie",
		detail: "Seat 0003 • Serial 000025",
		rtl: false,
	},
	{
		id: "long-name",
		name: "A long exact attendee name wrapping across multiple measured lines",
		detail: "Seat 0004 • Serial 000026",
		rtl: false,
	},
	{
		id: "inert-markup",
		name: "<b>Alice</b> & 0007",
		detail: "Seat 0005 • Serial 000027",
		rtl: false,
	},
	{
		id: "rtl-arabic",
		name: "مرحبا بالعالم",
		detail: "Seat 0006 • Serial 000028",
		rtl: true,
	},
] as const;
for (const variant of variants)
	test(`renders exact SVG text, measured glyphs and actual custom fonts for ${variant.id}`, {
		timeout: 30000,
	}, async () => {
		const f = await fixtureArtifact(variant.name, variant.detail, variant.rtl);
		const rendered = await renderDraft(
			f.artifact,
			f.ports,
			join(root, variant.id),
		);
		assert.equal(f.state.generationCalls, 0);
		assert.equal(rendered.networkRequests, 0);
		assert.ok(rendered.ink.every((n) => n > 10));
		assert.equal(
			rendered.metrics.map((m) => m.value).join(""),
			(variant.name + variant.detail).replaceAll("\n", ""),
		);
		const report = inspectModel(
			f.artifact,
			f.constraints,
			rendered.fileEvidence,
		);
		assert.equal(report.modelReady, true);
		assert.equal(report.handoffEligible, false);
		assert.equal(report.filesReady, false);
		if (variant.rtl || variant.id === "long-name") {
			assert.equal(rendered.pdfContentExact, false);
			assert.ok(
				report.findings.some(
					(f) => f.path === "files.pdf.content" && f.state === "failed",
				),
			);
			if (variant.rtl)
				assert.ok(rendered.embeddedFonts.includes("NotoSansArabic-Regular"));
			else assert.ok(rendered.metrics.some((m) => m.value.endsWith(" ")));
		} else assert.equal(rendered.pdfContentExact, true);
		await writeFile(
			join(root, variant.id, "content-integrity.json"),
			JSON.stringify(
				{
					fixtureId: variant.id,
					scope: "synthetic-only",
					inputDigest: fingerprint(f.input),
					texts: f.artifact.texts,
					sourceArtworkHashes: f.artifact.sourceArtworkHashes,
					compositionHash: f.artifact.compositionHash,
					renderHash: f.artifact.renderHash,
					generationCalls: f.state.generationCalls,
					report,
				},
				null,
				2,
			),
		);
	});
test("replays physical SVG, PNG pixels and normalized PDF bytes in independent sandboxed browsers", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact();
	const first = await renderDraft(f.artifact, f.ports, join(root, "repeat-1")),
		second = await renderDraft(f.artifact, f.ports, join(root, "repeat-2"));
	assert.equal(first.pixelHash, second.pixelHash);
	assert.equal(first.normalizedPdfHash, second.normalizedPdfHash);
	assert.equal(first.renderHash, second.renderHash);
	assert.deepEqual(first.metrics, second.metrics);
	assert.equal(f.state.generationCalls, 0);
});
test("keeps rendered pixels identical during approved SVG container normalization", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		policy = resolveRepairPolicy({
			revision: "synthetic-normalize-1",
			permissionRef: "synthetic-normalize-permission",
			permission: "mechanical",
			maxTotalAttempts: 1,
			fields: [
				{
					node: "logo",
					minSize: 2,
					maxSize: 7,
					step: 0.25,
					maxAttempts: 1,
					maxMoveMm: 0,
					fallbackOrder: [],
					allowNormalize: true,
				},
			],
		});
	const plan = planRepair(f.artifact, policy, {
		kind: "normalize",
		node: "logo",
	});
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		f.artifact,
		plan,
		policy,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	const before = await renderDraft(
			f.artifact,
			f.ports,
			join(root, "normalization-before"),
		),
		after = await renderDraft(
			result.artifact,
			f.ports,
			join(root, "normalization-after"),
		);
	assert.equal(before.pixelHash, after.pixelHash);
	assert.notEqual(before.compositionHash, after.compositionHash);
	assert.notEqual(before.renderHash, after.renderHash);
	assert.deepEqual(
		result.artifact.sourceArtworkHashes,
		f.artifact.sourceArtworkHashes,
	);
	await writeFile(
		join(root, "normalization-after", "repair-receipt.json"),
		JSON.stringify(
			{ plan, receipt: result.receipt, report: result.report },
			null,
			2,
		),
	);
});
test("renders a repaired exact name after bounded shrinking with visible glyph evidence", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact("W".repeat(26));
	const original = await composeArtifact(
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
		),
		policy = resolveRepairPolicy({
			revision: "synthetic-shrink-1",
			permissionRef: "synthetic-shrink-permission",
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
	const plan = planRepair(original, policy, { kind: "shrink", node: "name" });
	assert.ok(plan.state === "PLANNED");
	const result = await applyRepair(
		original,
		plan,
		policy,
		f.constraints,
		f.ports,
		1000,
	);
	assert.ok(result.state === "APPLIED_DRAFT");
	const rendered = await renderDraft(
		result.artifact,
		f.ports,
		join(root, "shrink-after"),
	);
	assert.equal(rendered.metrics[0]?.value, "W".repeat(26));
	assert.equal(rendered.pdfContentExact, true);
	await writeFile(
		join(root, "shrink-after", "repair-receipt.json"),
		JSON.stringify(
			{ plan, receipt: result.receipt, report: result.report },
			null,
			2,
		),
	);
});
test("independent parsers detect wrongly sized drafts rather than trusting claimed physical dimensions", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		rendered = await renderDraft(
			f.artifact,
			f.ports,
			join(root, "negative-files"),
		);
	const png = PNG.sync.read(rendered.png);
	assert.equal(png.width, 384);
	const modified = PNG.sync.write(new PNG({ width: 383, height: 192 }));
	assert.notEqual(
		PNG.sync.read(modified).width,
		Math.round((f.layout.width * 96) / 25.4),
	);
	const pdf = await PDFDocument.load(rendered.pdf);
	pdf.getPage(0).setSize(289, 144);
	const changed = await pdf.save();
	assert.notEqual((await PDFDocument.load(changed)).getPage(0).getWidth(), 288);
	assert.notEqual(digest(changed), digest(rendered.pdf));
});
test("written evidence is fresh content bound to source art, render and actual platform fonts", async () => {
	const f = await fixtureArtifact("Zoë O’Connor");
	await renderDraft(f.artifact, f.ports, join(root, "written-evidence"));
	const raw: unknown = JSON.parse(
		await readFile(join(root, "written-evidence", "evidence.json"), "utf8"),
	);
	const evidence = z
		.object({
			mode: z.string(),
			environment: z.object({ profile: z.string() }),
			networkRequests: z.number(),
			metrics: z.array(z.object({ value: z.string() })),
			platformFonts: z.array(z.array(z.object({ isCustomFont: z.boolean() }))),
		})
		.parse(raw);
	assert.equal(evidence.mode, "synthetic-draft-only");
	assert.equal(
		evidence.environment.profile,
		process.platform === "darwin" ? "local-macos" : "pinned-linux-ci",
	);
	assert.equal(evidence.networkRequests, 0);
	assert.equal(evidence.metrics[0]?.value, "Zoë O’Connor");
	assert.ok(
		evidence.platformFonts
			.flat()
			.every((font: { isCustomFont: boolean }) => font.isCustomFont),
	);
});
