import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";
import {
	parseAsset,
	resolveAsset,
	checkPermission,
	assetLimits,
	assetBindingSchema,
} from "../../src/assets/private-assets.js";
import {
	CompositionError,
	digest,
	parse,
} from "../../src/composition/primitives.js";
import { inspectArtifact } from "../../src/preflight/private-inspection.js";
import { recheckPermissions } from "../../src/composition/private-model.js";
import { composeArtifact } from "../../src/composition/private-model.js";
import {
	binding,
	safeLogo,
	artworkPng,
	fixtureArtifact,
	syntheticPorts,
	scope,
} from "../fixtures/composition/corpus.js";

const blocked = (error: unknown) => error instanceof CompositionError;
const svg = (body: string) =>
	Buffer.from(
		`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`,
	);
test("parses approved logo geometry and retains original content with derivative provenance", () => {
	const original = binding("synthetic-logo", safeLogo, "overlay");
	const normalized = parseAsset(
		{ ...original, normalization: "safe-container-v1" },
		safeLogo,
	);
	assert.equal(normalized.width, 100);
	assert.equal(normalized.height, 100);
	assert.equal(normalized.binding.digest, digest(safeLogo));
	assert.notEqual(normalized.renderDigest, original.digest);
	assert.ok(normalized.derivative);
	assert.ok(
		Buffer.from(normalized.renderBase64, "base64")
			.toString()
			.includes("Synthetic logo"),
	);
	assert.deepEqual(Buffer.from(normalized.sourceBase64, "base64"), safeLogo);
});
for (const [label, bytes] of [
	["script element", svg("<script>alert(1)</script>")],
	[
		"encoded event handler",
		svg('<rect onload="&#97;lert(1)" width="10" height="10"/>'),
	],
	[
		"foreignObject",
		svg(
			'<foreignObject><html xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>',
		),
	],
	["external image", svg('<image href="https://invalid/private.png"/>')],
	["filesystem URL", svg('<image href="file:///private/secret"/>')],
	["javascript URL", svg('<a href="javascript:alert(1)"/>')],
	[
		"external font",
		svg("<style>@font-face{src:url(https://invalid/font)}</style>"),
	],
	["unsafe paint URL", svg('<rect fill="url(https://invalid/paint)"/>')],
	["path command", svg('<path d="M0 0 L99 99"/>')],
	["unknown entity", svg("<title>&nbsp;</title>")],
	[
		"external entity",
		Buffer.from(
			'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///private/secret">]>' +
				svg("<title>&x;</title>").toString(),
		),
	],
	[
		"entity expansion",
		Buffer.from(
			'<!DOCTYPE svg [<!ENTITY a "123"><!ENTITY b "&a;&a;">]>' +
				svg("<title>&b;</title>").toString(),
		),
	],
	[
		"XML processing instruction",
		Buffer.concat([
			Buffer.from('<?xml-stylesheet href="https://invalid/x"?>'),
			safeLogo,
		]),
	],
	[
		"malformed XML",
		Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'),
	],
	[
		"HTML polyglot",
		Buffer.concat([
			safeLogo,
			Buffer.from("<html><script>alert(1)</script></html>"),
		]),
	],
	[
		"namespace confusion",
		Buffer.from(
			'<svg xmlns="urn:hostile" width="100" height="100" viewBox="0 0 100 100"/>',
		),
	],
	["recursion limit", svg("<g>".repeat(20) + "</g>".repeat(20))],
	[
		"element limit",
		svg('<rect width="1" height="1"/>'.repeat(assetLimits.elements)),
	],
	[
		"oversized dimensions",
		Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000" viewBox="0 0 5000 5000"/>',
		),
	],
	["negative dimensions", svg('<rect width="-1" height="3"/>')],
	["invalid UTF8", Buffer.from([60, 255, 62])],
] as const)
	test(`rejects ${label} before any rendering or resolution`, () =>
		assert.throws(
			() => parseAsset(binding("hostile-fixture", bytes, "overlay"), bytes),
			blocked,
		));
test("rejects a PNG trailing polyglot even when decoded pixels would be valid", () => {
	const bytes = Buffer.concat([
		artworkPng(),
		Buffer.from("<script>alert(1)</script>"),
	]);
	assert.throws(
		() => parseAsset(binding("polyglot", bytes, "artwork"), bytes),
		(error: unknown) =>
			error instanceof CompositionError && error.code === "ASSET_UNSAFE",
	);
});
test("bounds decoded pixels before decompressing an oversized PNG", () => {
	const bytes = Buffer.from(artworkPng());
	bytes.writeUInt32BE(100000, 16);
	assert.throws(
		() => parseAsset(binding("bomb", bytes, "artwork"), bytes),
		(error: unknown) =>
			error instanceof CompositionError && error.code === "ASSET_LIMIT",
	);
});
test("rejects an actual compressed expansion bomb before the PNG decoder runs", () => {
	const header = artworkPng(1, 1).subarray(0, 33),
		payload = deflateSync(Buffer.alloc(1024 * 1024)),
		chunk = Buffer.alloc(payload.length + 12);
	chunk.writeUInt32BE(payload.length, 0);
	chunk.write("IDAT", 4, "ascii");
	payload.copy(chunk, 8);
	chunk.writeUInt32BE(
		crc32(chunk.subarray(4, chunk.length - 4)),
		chunk.length - 4,
	);
	const original = artworkPng(1, 1),
		bytes = Buffer.concat([
			header,
			chunk,
			original.subarray(original.length - 12),
		]);
	assert.throws(
		() => parseAsset(binding("compressed-bomb", bytes, "artwork"), bytes),
		(error: unknown) =>
			error instanceof CompositionError && error.code === "ASSET_LIMIT",
	);
});
test("rejects interlaced PNG before reaching the decoder's unbounded inflate path", () => {
	const bytes = Buffer.from(artworkPng());
	bytes[28] = 1;
	bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
	assert.throws(
		() => parseAsset(binding("interlaced", bytes, "artwork"), bytes),
		(error: unknown) =>
			error instanceof CompositionError && error.code === "ASSET_UNSUPPORTED",
	);
});
test("rejects CRC damage even when source digest matches damaged bytes", () => {
	const bytes = Buffer.from(artworkPng());
	bytes[bytes.length - 1] = 0;
	assert.throws(
		() => parseAsset(binding("crc", bytes, "artwork"), bytes),
		blocked,
	);
});
test("checks CRC on the sRGB tag even when the decoder treats it as unknown metadata", () => {
	const bytes = Buffer.from(artworkPng());
	bytes[45] = 0;
	assert.throws(
		() => parseAsset(binding("profile-crc", bytes, "artwork"), bytes),
		(error: unknown) =>
			error instanceof CompositionError && error.code === "ASSET_UNSAFE",
	);
});
test("requires explicit crop permission and validates source crop geometry", async () => {
	const f = await fixtureArtifact();
	const nodes = f.artifact.model.input.nodes.map((n) =>
		n.kind === "overlay"
			? { ...n, crop: { x: 25, y: 25, width: 50, height: 50 } }
			: n,
	);
	await assert.rejects(
		composeArtifact(
			{ ...f.artifact.model.input, nodes },
			f.layout,
			f.fonts,
			f.ports,
			1000,
		),
		blocked,
	);
	const layout = {
		...f.layout,
		revision: "synthetic-crop-2",
		slots: f.layout.slots.map((s) =>
			s.kind === "overlay" ? { ...s, allowCrop: true } : s,
		),
	};
	const cropped = await composeArtifact(
		{ ...f.artifact.model.input, nodes },
		layout,
		f.fonts,
		f.ports,
		1000,
	);
	assert.ok(cropped.svg.includes('viewBox="25 25 50 50"'));
	assert.deepEqual(cropped.sourceArtworkHashes, f.artifact.sourceArtworkHashes);
	assert.equal(
		cropped.assets.find((a) => a.binding.purpose === "overlay")?.binding.digest,
		digest(safeLogo),
	);
	const invalid = nodes.map((n) =>
		n.kind === "overlay"
			? { ...n, crop: { x: 90, y: 90, width: 50, height: 50 } }
			: n,
	);
	await assert.rejects(
		composeArtifact(
			{ ...f.artifact.model.input, nodes: invalid },
			layout,
			f.fonts,
			f.ports,
			1000,
		),
		blocked,
	);
});
test("rejects over-budget input without invoking a decoder", () => {
	const bytes = Buffer.alloc(assetLimits.bytes + 1);
	assert.throws(
		() => parseAsset(binding("too-large", bytes, "overlay"), bytes),
		blocked,
	);
});
test("rejects unsupported containers and artwork normalization", () => {
	const jpeg = Buffer.from([255, 216, 255, 217]);
	assert.throws(
		() => parseAsset(binding("jpeg", jpeg, "artwork"), jpeg),
		blocked,
	);
	const bytes = artworkPng();
	assert.throws(
		() =>
			parseAsset(
				{
					...binding("raster", bytes, "artwork"),
					normalization: "safe-container-v1",
				},
				bytes,
			),
		blocked,
	);
});
test("rejects scope mismatch before resolving supplied references", async () => {
	const art = artworkPng(),
		{ ports, state } = syntheticPorts(art),
		source = binding("synthetic-art", art, "artwork");
	await assert.rejects(
		resolveAsset(source, { ...scope, tenant: source.ref }, ports, 1000),
		blocked,
	);
	assert.equal(state.resolveCalls, 0);
});
for (const patch of [
	{ state: "revoked" },
	{ state: "denied" },
	{ state: "unknown" },
	{ validUntil: 1000 },
	{ purpose: "overlay" },
	{ permissionRef: "wrong-permission" },
	{ version: "wrong-version" },
	{ digest: "0".repeat(64) },
	{ scope: { tenant: "wrong-tenant", project: "synthetic-project" } },
	{ appliesTo: "0".repeat(64) },
])
	test(`blocks nonapplicable current permission ${JSON.stringify(patch)}`, async () => {
		const art = artworkPng(),
			source = binding("synthetic-art", art, "artwork"),
			{ ports } = syntheticPorts(art);
		await assert.rejects(
			checkPermission(
				source,
				{
					...ports,
					permission: async (request) => {
						const decision = await ports.permission(request);
						assert.ok(typeof decision === "object" && decision !== null);
						return { ...decision, ...patch };
					},
				},
				"compose",
				1000,
				null,
			),
			blocked,
		);
	});
test("fails closed when a current permission lookup throws", async () => {
	const f = await fixtureArtifact();
	f.state.lookupFails = true;
	const report = await inspectArtifact(
		f.artifact,
		f.constraints,
		f.ports,
		1000,
	);
	assert.equal(report.modelReady, false);
	assert.equal(report.currentPermission, "blocked");
	assert.ok(
		report.findings.some((f) => f.code === "CURRENT_PERMISSION_BLOCKED"),
	);
});
test("revocation between composition and export or handoff blocks immutable output", async () => {
	const f = await fixtureArtifact(),
		hash = f.artifact.compositionHash;
	f.state.revoked = true;
	await assert.rejects(
		recheckPermissions(f.artifact, f.ports, "export", 1000),
		blocked,
	);
	await assert.rejects(
		recheckPermissions(f.artifact, f.ports, "handoff", 1000),
		blocked,
	);
	assert.equal(f.artifact.compositionHash, hash);
	assert.equal(f.state.generationCalls, 0);
});
test("rejects untrusted paths and URLs at asset binding parsing", () => {
	for (const ref of [
		"../logo",
		"/tmp/logo",
		"https://invalid/logo",
		"file:///logo",
		"x%2f..%2flogo",
	])
		assert.throws(
			() =>
				parse(assetBindingSchema, {
					...binding("safe", safeLogo, "overlay"),
					ref,
				}),
			blocked,
		);
});
test("reports missing scoped bytes without fetching an alternate URL", async () => {
	const art = artworkPng(),
		source = binding("synthetic-art", art, "artwork"),
		{ ports } = syntheticPorts(art);
	await assert.rejects(
		resolveAsset(
			source,
			{ ...scope },
			{ ...ports, resolve: async () => null },
			1000,
		),
		blocked,
	);
});
