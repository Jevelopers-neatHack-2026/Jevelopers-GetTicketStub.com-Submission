import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import { inspectPdf } from "../../src/exporters/private-pdf.js";
import { defaultOutputPolicy } from "../../src/exporters/private-policy.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import {
	changeContent,
	changeCmap,
} from "../fixtures/production-output/pdf-semantic.js";

let root: string,
	keep = false;
before(async () => {
	const parent = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	keep = parent !== undefined;
	root = parent
		? join(parent, "pdf-semantic")
		: await mkdtemp(join(tmpdir(), "pp-pdf-semantic-"));
	await mkdir(root, { recursive: true });
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});
const variants = [
	{ id: "arabic", name: "مرحبا بالعالم", rtl: true },
	{
		id: "wrap",
		name: "A long exact attendee name wrapping across multiple measured lines",
		rtl: false,
	},
	{ id: "combining", name: "Café Ångström", rtl: false },
	{ id: "ligatures", name: "office affinity ffi fi fl", rtl: false },
	{ id: "multiline", name: "Anne\nMarie", rtl: false },
	{ id: "literal", name: "<b>Zoë</b> & 0009", rtl: false },
] as const;
for (const v of variants)
	test(`proves literal ${v.id} strings from actual PDF clusters and licensed glyphs`, {
		timeout: 30000,
	}, async () => {
		const f = await fixtureArtifact(v.name, "Seat 0007", v.rtl),
			result = await exportPrivateFiles({
				artifact: f.artifact,
				constraints: f.constraints,
				ports: f.ports,
				now: 1000,
				policy: defaultOutputPolicy,
			}),
			file = result.files.find((f) => f.name === "output.pdf");
		assert.ok(file);
		const inspected = await inspectPdf(file.bytes, f.artifact),
			expected = f.artifact.texts.flatMap((t) =>
				t.state === "measured"
					? t.lines.filter((l) => l.value.length > 0).map((l) => l.value)
					: [],
			);
		assert.deepEqual(inspected.semantics.lines, expected);
		assert.equal(inspected.semantics.fileDigest, String(file.digest));
		assert.ok(inspected.semantics.glyphCount > 0);
		assert.equal(result.report.draftReady, true);
		assert.equal(result.handoffEligible, false);
		assert.equal(result.networkRequests, 0);
		await Promise.all(
			result.files.map((file) =>
				writeFile(
					join(root, `${v.id}.${file.name.split(".").at(-1)}`),
					file.bytes,
				),
			),
		);
		await writeFile(
			join(root, `${v.id}.json`),
			JSON.stringify(
				{
					mode: "verified-private-pdf-semantic-not-approved",
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
					sourceDigest: fingerprint(f.input),
					...inspected,
					fileDigest: digest(file.bytes),
					networkRequests: 0,
					handoffEligible: false,
				},
				null,
				2,
			),
		);
	});
test("rejects independently mutated cluster metadata, glyphs, spaces, order and graphics", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact("مرحبا بالعالم", "Seat 0007", true),
		result = await exportPrivateFiles({
			artifact: f.artifact,
			constraints: f.constraints,
			ports: f.ports,
			now: 1000,
			policy: defaultOutputPolicy,
		}),
		file = result.files.find((f) => f.name === "output.pdf");
	assert.ok(file);
	const mutations: readonly [string, (s: string) => string][] = [
		["actualtext", (s) => s.replace("FEFF0645", "FEFF0646")],
		["wrong-glyph", (s) => s.replace("<004D> Tj", "<0048> Tj")],
		["missing-glyph", (s) => s.replace("<004D> Tj", "")],
		["duplicated-glyph", (s) => s.replace("<004D> Tj", "<004D004D> Tj")],
		["missing-space", (s) => s.replace("<0003> Tj", "")],
		["extra-space", (s) => s.replace("<0003> Tj", "<00030003> Tj")],
		["hidden", (s) => s.replace("BT\n", "BT\n3 Tr\n")],
		["geometry", (s) => s.replace("61.71875", "62.71875")],
		["order", (s) => s.replace("/ReversedChars BMC", "/Span BMC")],
		["nested", (s) => s.replace("BT\n", "BT\nBT\n")],
		["overpaint", (s) => s + "\nq 1 0 0 rg 0 0 1200 600 re f Q\n"],
		["broken-cluster", (s) => s.replace("EMC\n/Span", "/Span")],
	];
	const evidence = [];
	for (const [id, edit] of mutations) {
		const bytes = await changeContent(file.bytes, edit);
		await assert.rejects(inspectPdf(bytes, f.artifact));
		evidence.push({ id, digest: digest(bytes), state: "rejected" });
		await writeFile(join(root, `adversarial-${id}.pdf`), bytes);
	}
	const cmap = await changeCmap(file.bytes, (s) =>
		s.replace("<0003> <0020>", "<0003> <0021>"),
	);
	await assert.rejects(inspectPdf(cmap, f.artifact));
	evidence.push({ id: "cmap", digest: digest(cmap), state: "rejected" });
	await writeFile(join(root, "adversarial-cmap.pdf"), cmap);
	await writeFile(
		join(root, "adversarial.json"),
		JSON.stringify(
			{
				mode: "real-pdf-byte-mutations",
				executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
				sourcePdfDigest: digest(file.bytes),
				cases: evidence,
				handoffEligible: false,
			},
			null,
			2,
		),
	);
});
