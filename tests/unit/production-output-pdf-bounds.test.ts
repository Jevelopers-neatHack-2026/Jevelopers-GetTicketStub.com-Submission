import { test } from "node:test";
import assert from "node:assert/strict";
import {
	pdfTokens,
	pdfOperations,
	utf16Hex,
} from "../../src/exporters/private-pdf-tokens.js";
import { readCmap } from "../../src/exporters/private-pdf-cmap.js";
import { inspectPdfSemantics } from "../../src/exporters/private-pdf-semantic.js";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
test("parses literal/hex Unicode and finite CMap ranges without guessing or normalization", () => {
	assert.equal(utf16Hex("00650301"), "é");
	assert.equal(utf16Hex("D83DDE00"), "😀");
	assert.deepEqual(pdfTokens(Buffer.from("(a\\(b\\)\\040c)")), [
		{ hex: Buffer.from("a(b) c").toString("hex") },
	]);
	const map = readCmap(
		Buffer.from(
			"1 beginbfchar <0003> <0020> endbfchar 1 beginbfrange <0004> <0005> <0041> endbfrange",
		),
	);
	assert.equal(map.get(3), " ");
	assert.equal(map.get(4), "A");
	assert.equal(map.get(5), "B");
});
for (const input of [
	"[ [ [ [ [ [ [ [ [ [ 0 ] ] ] ] ] ] ] ] ] ]",
	"<xyz>",
	"(unterminated",
	"<< /A 1 /A 2 >>",
	"1e99 cm",
	"1 2 3",
])
	test(`rejects malformed/bounded PDF token input ${input.slice(0, 20)}`, () => {
		assert.throws(() => pdfOperations(Buffer.from(input)));
	});
test("rejects oversized bytes before PDF document or font parsing", async () => {
	const f = await fixtureArtifact();
	await assert.rejects(
		inspectPdfSemantics(new Uint8Array(16000001), f.artifact),
	);
	assert.throws(() => pdfTokens(new Uint8Array(2000001)));
	assert.throws(() => utf16Hex("D800"));
});
