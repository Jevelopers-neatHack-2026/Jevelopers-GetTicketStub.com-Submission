import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { PrivateArtifact } from "../../src/composition/private-model.js";
import { CompositionError, digest } from "../../src/composition/primitives.js";
import { inspectModel } from "../../src/preflight/private-inspection.js";
import { fixtureArtifact, safeLogo } from "../fixtures/composition/corpus.js";
import { renderDraft } from "../fixtures/composition/render-draft.js";

let root: string,
	keep = false;
before(async () => {
	const requested = process.env["PP_COMPOSITION_EVIDENCE_DIR"];
	root = requested
		? join(requested, "integrity")
		: await mkdtemp(join(tmpdir(), "pp-composition-integrity-"));
	keep = requested !== undefined;
	await mkdir(root, { recursive: true });
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});

const white = new PNG({ width: 1200, height: 600 });
white.data.fill(255);
const whiteBase64 = PNG.sync.write(white).toString("base64");
const mutations: readonly {
	readonly id: string;
	readonly change: (a: PrivateArtifact) => PrivateArtifact;
}[] = [
	{
		id: "embedded-raster",
		change: (a) => ({
			...a,
			svg: a.svg.replace(
				a.assets.find((a) => a.binding.purpose === "artwork")?.renderBase64 ??
					"missing",
				whiteBase64,
			),
		}),
	},
	{
		id: "embedded-svg",
		change: (a) => ({
			...a,
			svg: a.svg.replace(
				safeLogo.toString("base64"),
				Buffer.from(safeLogo.toString().replace("#134c67", "#ffffff")).toString(
					"base64",
				),
			),
		}),
	},
	{
		id: "svg-and-updated-hash",
		change: (a) => {
			const svg = a.svg.replace("000123", "999999");
			return { ...a, svg, renderHash: digest(svg) };
		},
	},
	{
		id: "composition-hash",
		change: (a) => ({ ...a, compositionHash: digest("forged-composition") }),
	},
	{
		id: "render-hash",
		change: (a) => ({ ...a, renderHash: digest("forged-render") }),
	},
	{
		id: "source-hashes",
		change: (a) => ({ ...a, sourceArtworkHashes: [digest("forged-source")] }),
	},
	{
		id: "revision",
		change: (a) => ({ ...a, revision: digest("forged-revision") }),
	},
	{
		id: "source-raster",
		change: (a) => ({
			...a,
			assets: a.assets.map((s) =>
				s.binding.purpose === "artwork"
					? { ...s, sourceBase64: whiteBase64 }
					: s,
			),
		}),
	},
	{
		id: "render-raster",
		change: (a) => ({
			...a,
			assets: a.assets.map((s) =>
				s.binding.purpose === "artwork"
					? {
							...s,
							renderBase64: whiteBase64,
							renderDigest: digest(Buffer.from(whiteBase64, "base64")),
						}
					: s,
			),
		}),
	},
	{
		id: "text-proof",
		change: (a) => ({
			...a,
			texts: a.texts.map((t) =>
				t.state === "measured" ? { ...t, formattedValue: "forged-fact" } : t,
			),
		}),
	},
	{
		id: "font-bytes",
		change: (a) => ({
			...a,
			fontBytes: a.fontBytes.map((f) => ({
				...f,
				base64: Buffer.from("forged-font").toString("base64"),
			})),
		}),
	},
];
for (const mutation of mutations)
	test(`real draft adapter rejects ${mutation.id} before issuing evidence`, async () => {
		const f = await fixtureArtifact();
		const altered = mutation.change(f.artifact);

		await assert.rejects(
			renderDraft(altered, f.ports, join(root, mutation.id)),
			(e) => e instanceof CompositionError,
		);

		assert.equal(f.state.generationCalls, 0);
	});

test("binds actual SVG and output bytes and rejects copied evidence field mutations", async () => {
	const f = await fixtureArtifact();
	const rendered = await renderDraft(
		f.artifact,
		f.ports,
		join(root, "control"),
	);

	for (const file of rendered.fileEvidence) {
		assert.ok(
			"svgDigest" in file &&
				"artifactIdentityHash" in file &&
				"bindingHash" in file,
		);
		assert.equal(file.svgDigest, digest(f.artifact.svg));
		assert.equal(
			file.fileDigest,
			digest(await readFile(join(root, "control", `draft.${file.format}`))),
		);
	}
	for (const patch of [
		{ svgDigest: digest("another-svg") },
		{ artifactIdentityHash: digest("another-artifact") },
		{ fileDigest: digest("another-file") },
		{ renderHash: digest("another-render") },
		{ compositionHash: digest("another-model") },
	]) {
		const report = inspectModel(
			f.artifact,
			f.constraints,
			rendered.fileEvidence.map((f) => ({ ...f, ...patch })),
		);
		assert.ok(report.findings.some((f) => f.code === "EXPORT_BINDING"));
		assert.equal(report.filesReady, false);
	}
	assert.equal(
		inspectModel(f.artifact, f.constraints, rendered.fileEvidence)
			.handoffEligible,
		false,
	);
});
