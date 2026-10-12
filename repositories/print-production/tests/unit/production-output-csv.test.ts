import { test } from "node:test";
import assert from "node:assert/strict";
import { digest } from "../../src/composition/primitives.js";
import {
	csvErrorReport,
	parseCsv,
	resolveCsvPolicy,
	requireCsvCapability,
	csvBaselineCapability,
} from "../../src/personalization/private-csv.js";
import type {
	CsvRow,
	CsvPolicy,
} from "../../src/personalization/private-csv.js";
import { OutputError } from "../../src/exporters/private-policy.js";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { rowPolicy } from "../fixtures/production-output/fixture.js";

async function policy() {
	const f = await fixtureArtifact();
	return resolveCsvPolicy(
		{
			revision: "private-csv-1_csv-parse-6.1.0",
			delimiter: ",",
			newline: "\r\n",
			maxBytes: 100000,
			maxRows: 100,
			maxColumns: 3,
			maxCellBytes: 1000,
			rowIdHeader: "id",
			mapping: [
				{ header: "attendee", field: "name" },
				{ header: "seat", field: "detail" },
			],
		},
		rowPolicy(f.artifact.model.input),
	);
}
async function* chunks(bytes: Uint8Array, size = 7) {
	for (let i = 0; i < bytes.length; i += size)
		yield bytes.subarray(i, i + size);
}
async function collect(
	bytes: Uint8Array,
	p: CsvPolicy,
	checkpoint?: CsvRow["checkpoint"],
) {
	const result: CsvRow[] = [];
	for await (const row of parseCsv({
		source: chunks(bytes),
		fileDigest: digest(bytes),
		policy: p,
		...(checkpoint ? { checkpoint } : {}),
	}))
		result.push(row);
	return result;
}
const valid = Buffer.from(
	'\uFEFFid,attendee,seat\r\na,"Zoë, O’Connor",0007\r\nb,"Anne\r\nMarie",""\r\nc,"=2+2 <b>\"\"Alice\"\"</b>",0009\r\n',
);
test("parses BOM and quoted UTF-8 cells across byte chunks without coercion", async () => {
	const rows = await collect(valid, await policy());
	assert.deepEqual(
		rows.map((r) => r.row.fields),
		[
			{ name: "Zoë, O’Connor", detail: "0007" },
			{ name: "Anne\r\nMarie", detail: "" },
			{ name: '=2+2 <b>"Alice"</b>', detail: "0009" },
		],
	);
	assert.deepEqual(
		rows.map((r) => r.logicalRecord),
		[1, 2, 3],
	);
	assert.ok((rows[1]?.physicalLine ?? 0) > 3);
	assert.equal(rows[2]?.checkpoint.offset, valid.length);
	assert.equal(rows[0]?.sourcePaths["name"], "headers.attendee");
});
test("resumes only after a matching complete-record checkpoint", async () => {
	const p = await policy(),
		first = await collect(valid, p),
		checkpoint = first[0]?.checkpoint;
	assert.ok(checkpoint);
	const resumed = await collect(valid, p, checkpoint);
	assert.deepEqual(
		resumed.map((r) => r.row),
		first.slice(1).map((r) => r.row),
	);
	await assert.rejects(
		collect(valid, p, { ...checkpoint, offset: checkpoint.offset - 1 }),
		OutputError,
	);
	await assert.rejects(
		collect(
			Buffer.concat([valid, Buffer.from("d,Alice,0001\r\n")]),
			p,
			checkpoint,
		),
		OutputError,
	);
	await assert.rejects(
		collect(valid, { ...p, delimiter: ";" }, checkpoint),
		OutputError,
	);
});
for (const [id, text] of [
	["duplicate", "id,attendee,attendee\r\na,Alice,0007\r\n"],
	["missing", "id,attendee\r\na,Alice\r\n"],
	["extra", "id,attendee,seat,unused\r\na,Alice,7,x\r\n"],
	["short", "id,attendee,seat\r\na,Alice\r\n"],
	["long", "id,attendee,seat\r\na,Alice,7,x\r\n"],
	["quote", 'id,attendee,seat\r\na,"Alice,7\r\n'],
	["afterQuote", 'id,attendee,seat\r\na,"Alice"x,7\r\n'],
] as const)
	test(`rejects ${id} CSV records without shifting or omission`, async () => {
		await assert.rejects(collect(Buffer.from(text), await policy()));
	});
test("rejects invalid UTF-8 and actual file digest mismatch", async () => {
	const p = await policy();
	await assert.rejects(
		collect(Buffer.from([0xff, 0xfe]), p),
		(error) => error instanceof OutputError && error.code === "CSV_ENCODING",
	);
	await assert.rejects(async () => {
		for await (const row of parseCsv({
			source: chunks(valid),
			fileDigest: digest("wrong"),
			policy: p,
		}))
			void row;
	}, OutputError);
});
test("enforces actual streaming row, byte and cell bounds", async () => {
	const p = await policy();
	await assert.rejects(collect(valid, { ...p, maxRows: 1 }), OutputError);
	await assert.rejects(collect(valid, { ...p, maxBytes: 10 }), OutputError);
	await assert.rejects(collect(valid, { ...p, maxCellBytes: 3 }), OutputError);
});
test("applies backpressure and cancellation to a large conditional import", async () => {
	const p = await policy(),
		bytes = Buffer.from(
			"id,attendee,seat\r\n" +
				Array.from({ length: 99 }, (_, i) => `r-${i},Alice,0007\r\n`).join(""),
		),
		abort = new AbortController();
	let pulled = 0;
	const source = (async function* () {
		for (let i = 0; i < bytes.length; i += 8) {
			pulled++;
			yield bytes.subarray(i, i + 8);
		}
	})();
	const stream = parseCsv({
		source,
		fileDigest: digest(bytes),
		policy: p,
		signal: abort.signal,
	});
	assert.equal((await stream.next()).done, false);
	assert.ok(pulled < bytes.length / 8);
	abort.abort();
	await assert.rejects(stream.next());
});
test("keeps cells inert while escaping diagnostic CSV injection", () => {
	assert.equal(
		csvErrorReport([["=2+2", "\t@bad", 'a"b', "0007"]]),
		'"\'=2+2","\'\t@bad","a""b","0007"\r\n',
	);
	assert.equal(csvBaselineCapability.enabled, false);
	assert.throws(
		() => requireCsvCapability(false),
		(error) =>
			error instanceof OutputError && error.code === "CAPABILITY_DISABLED",
	);
	requireCsvCapability(true);
});
