import { test } from "node:test";
import assert from "node:assert/strict";
import { packZip, inspectZip } from "../../src/exporters/private-zip.js";
import {
	outputFile,
	OutputError,
	defaultOutputPolicy,
} from "../../src/exporters/private-policy.js";
import { normalizePng, inspectPng } from "../../src/exporters/private-png.js";
import { PNG } from "pngjs";
import { digest } from "../../src/composition/primitives.js";
import { zipSync } from "fflate";

const payload = outputFile(
		"output.svg",
		Buffer.from("synthetic supplied payload"),
	),
	manifest = outputFile(
		"private-inventory.json",
		Buffer.from("synthetic supplied opaque manifest bytes"),
	);
test("packages exact supplied bytes deterministically and independently verifies the archive", async () => {
	const a = packZip([payload], manifest),
		b = packZip([payload], manifest);
	assert.deepEqual(a.bytes, b.bytes);
	assert.equal((await inspectZip(a.bytes, [payload, manifest])).length, 2);
});
for (const name of ["../x", "/x", "a/../x", "a//b", "a\\b", "C:/x", "a/./x"])
	test(`rejects unsafe ZIP path ${name}`, () => {
		assert.throws(
			() => packZip([outputFile(name, Buffer.from("x"))], manifest),
			OutputError,
		);
	});
test("rejects duplicate or tampered ZIP inventory and exact size/count overflow", async () => {
	assert.throws(() => packZip([manifest], manifest), OutputError);
	assert.throws(
		() =>
			packZip([payload], manifest, {
				maxFiles: 1,
				maxBytes: 1000,
				maxEntryBytes: 1000,
			}),
		OutputError,
	);
	const zip = packZip([payload], manifest);
	await assert.rejects(inspectZip(zip.bytes, [manifest]), OutputError);
	await assert.rejects(
		inspectZip(zip.bytes, [
			outputFile(payload.name, Buffer.from("changed")),
			manifest,
		]),
	);
	await assert.rejects(
		inspectZip(zip.bytes, [payload, manifest], {
			maxFiles: 2,
			maxBytes: zip.length,
			maxEntryBytes: 1,
		}),
	);
});
test("rejects symlink and compressed noncanonical containers before extraction", async () => {
	const link = zipSync(
		{
			"output.svg": [payload.bytes, { os: 3, attrs: 0o120777 << 16 }],
			"private-inventory.json": manifest.bytes,
		},
		{ level: 0 },
	);
	await assert.rejects(inspectZip(link, [payload, manifest]), OutputError);
	const compressed = zipSync(
		{ "output.svg": payload.bytes, "private-inventory.json": manifest.bytes },
		{ level: 9 },
	);
	await assert.rejects(
		inspectZip(compressed, [payload, manifest]),
		OutputError,
	);
});
test("rejects hidden leading/trailing ZIP bytes and changed payload bytes", async () => {
	const zip = packZip([payload], manifest);
	await assert.rejects(
		inspectZip(Buffer.concat([Buffer.from("hidden"), zip.bytes]), [
			payload,
			manifest,
		]),
	);
	await assert.rejects(
		inspectZip(Buffer.concat([zip.bytes, Buffer.from("hidden")]), [
			payload,
			manifest,
		]),
	);
	const corrupted = Uint8Array.from(zip.bytes);
	corrupted[50] = (corrupted[50] ?? 0) ^ 1;
	await assert.rejects(inspectZip(corrupted, [payload, manifest]));
});
test("writes and parses explicit PNG DPI/profile with opaque exact pixels", () => {
	const png = new PNG({ width: 12, height: 6 });
	png.data.fill(255);
	const policy = { ...defaultOutputPolicy, dpi: 300 };
	const bytes = normalizePng(PNG.sync.write(png), 300);
	const parsed = inspectPng(bytes, {
		widthMm: 1.016,
		heightMm: 0.508,
		policy,
		pixelDigest: digest(png.data),
	});
	assert.equal(parsed.width, 12);
	assert.equal(parsed.height, 6);
});
test("rejects PNG dimension, DPI, profile, pixel or CRC substitutions", () => {
	const png = new PNG({ width: 12, height: 6 });
	png.data.fill(255);
	const bytes = normalizePng(PNG.sync.write(png), 300),
		expected = {
			widthMm: 1.016,
			heightMm: 0.508,
			policy: defaultOutputPolicy,
			pixelDigest: digest(png.data),
		};
	assert.throws(
		() => inspectPng(bytes, { ...expected, widthMm: 2 }),
		OutputError,
	);
	assert.throws(
		() =>
			inspectPng(bytes, {
				...expected,
				policy: { ...defaultOutputPolicy, dpi: 600 },
			}),
		OutputError,
	);
	assert.throws(
		() => inspectPng(bytes, { ...expected, pixelDigest: digest("different") }),
		OutputError,
	);
	assert.throws(() => inspectPng(PNG.sync.write(png), expected), OutputError);
	const bad = Uint8Array.from(bytes);
	bad[45] = (bad[45] ?? 0) ^ 1;
	assert.throws(() => inspectPng(bad, expected), OutputError);
});
