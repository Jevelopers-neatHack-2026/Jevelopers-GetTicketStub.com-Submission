import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { encodeCsv, encodeTextCell, encodeMoneyCell, encodeCurrencyCell, encodeIntegerCell, CsvEncodingError } = await import(pathToFileURL(join(root, 'dist/integrations/csv.js')).href);

const rejects = (fn, code) => assert.throws(fn, error => error instanceof CsvEncodingError && error.code === code);

test('text that a spreadsheet would evaluate is prefixed with an apostrophe (CI-08X.3)', () => {
  for (const payload of ['=HYPERLINK("http://x","y")', '+1', '-1+1', '@SUM(A1)', '\t=1', '\r=1', '\n=1', ' =1', ' =1', '＝1', '＋1', '－1', '＠1']) {
    const encoded = encodeTextCell(payload);
    const unquoted = encoded.startsWith('"') ? encoded.slice(1, -1).replaceAll('""', '"') : encoded;
    assert.equal(unquoted, `'${payload}`, JSON.stringify(payload));
  }
  assert.equal(encodeTextCell('Open-Meteo API Standard - committed'), 'Open-Meteo API Standard - committed');
  assert.equal(encodeTextCell(''), '');
});

test('text quoting follows RFC 4180', () => {
  assert.equal(encodeTextCell('a,b'), '"a,b"');
  assert.equal(encodeTextCell('say "hi"'), '"say ""hi"""');
  assert.equal(encodeTextCell('line\r\nbreak'), '"line\r\nbreak"');
  assert.equal(encodeTextCell('café ✓'), 'café ✓');
});

test('malformed text is rejected rather than silently altered', () => {
  rejects(() => encodeTextCell('a\u0000b'), 'INVALID_TEXT');
  rejects(() => encodeTextCell('\u001B[31m'), 'INVALID_TEXT');
  rejects(() => encodeTextCell('\uD800'), 'INVALID_TEXT');
  rejects(() => encodeTextCell(42), 'INVALID_TEXT');
});

test('money keeps exact sub-cent precision at a fixed scale and never rounds', () => {
  assert.equal(encodeMoneyCell('0.000003', 6), '0.000003');
  assert.equal(encodeMoneyCell('29', 2), '29.00');
  assert.equal(encodeMoneyCell('1.5', 6), '1.500000');
  assert.equal(encodeMoneyCell('12.3400', 2), '12.34');
  assert.equal(encodeMoneyCell('-0.25', 2), '-0.25');
  assert.equal(encodeMoneyCell('-0.000', 2), '0.00');
  assert.equal(encodeMoneyCell('7', 0), '7');
  assert.equal(encodeMoneyCell('123456789012345678901234567890.123456789012345678', 18), '123456789012345678901234567890.123456789012345678');
  rejects(() => encodeMoneyCell('0.005', 2), 'INVALID_MONEY');
  for (const bad of ['1e3', '01.0', '.5', '1.', '+1', ' 1', '1,000', 'NaN', '', 1.5]) rejects(() => encodeMoneyCell(bad, 2), 'INVALID_MONEY');
  for (const scale of [-1, 19, 1.5, Number.NaN]) rejects(() => encodeMoneyCell('1', scale), 'INVALID_MONEY');
});

test('currency and integer cells are strictly typed', () => {
  assert.equal(encodeCurrencyCell('USD'), 'USD');
  for (const bad of ['usd', 'US', 'EURO', '=EU']) rejects(() => encodeCurrencyCell(bad), 'INVALID_CURRENCY');
  assert.equal(encodeIntegerCell(3), '3');
  assert.equal(encodeIntegerCell(-0), '0');
  for (const bad of [1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '3']) rejects(() => encodeIntegerCell(bad), 'INVALID_INTEGER');
});

test('documents use CRLF records, no BOM, empty cells for unknown values, and are byte-identical across runs', () => {
  const header = ['metric', 'currency', 'amount', 'observed', 'note'];
  const rows = [
    [{ kind: 'text', value: 'ai_provider_cost_actual' }, { kind: 'currency', code: 'USD' }, { kind: 'money', amount: '0.018785', scale: 6 }, { kind: 'integer', value: 1 }, { kind: 'text', value: '=cmd|/c calc' }],
    [{ kind: 'text', value: 'revenue_actual' }, { kind: 'currency', code: 'USD' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'text', value: 'unknown, not zero' }],
  ];
  const first = encodeCsv(header, rows);
  assert.equal(first, [
    'metric,currency,amount,observed,note',
    "ai_provider_cost_actual,USD,0.018785,1,'=cmd|/c calc",
    'revenue_actual,USD,,,"unknown, not zero"',
    '',
  ].join('\r\n'));
  assert.notEqual(first.charCodeAt(0), 0xFEFF);
  const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
  assert.equal(hash(encodeCsv(header, rows)), hash(first));
});

test('table errors report the record and column', () => {
  rejects(() => encodeCsv([], []), 'EMPTY_HEADER');
  assert.throws(() => encodeCsv(['a', 'b'], [[{ kind: 'empty' }]]), error => error.code === 'ROW_WIDTH_MISMATCH' && error.record === 1);
  assert.throws(() => encodeCsv(['a', 'b'], [[{ kind: 'empty' }, { kind: 'money', amount: '1.234', scale: 2 }]]), error => error.code === 'INVALID_MONEY' && error.record === 1 && error.column === 1);
  assert.throws(() => encodeCsv(['ok', '\u0000'], []), error => error.code === 'INVALID_TEXT' && error.record === 0 && error.column === 1);
  assert.equal(encodeCsv(['=total'], []), "'=total\r\n");
});

test('review hardening: Unicode whitespace, BOM, C1/bidi controls, separator directives and malformed cells', () => {
  for (const payload of [' =1', ' +1', ' -1', ' @1', ' =1', '​=1']) {
    const encoded = encodeTextCell(payload);
    const unquoted = encoded.startsWith('"') ? encoded.slice(1, -1).replaceAll('""', '"') : encoded;
    assert.equal(unquoted, `'${payload}`, JSON.stringify(payload));
  }
  assert.equal(encodeTextCell(' hello'), ' hello');
  for (const bad of ['﻿=1+1', 'a﻿b', '\u0085=1', '\u009B', '‮=1', '⁦x', '‏1']) rejects(() => encodeTextCell(bad), 'INVALID_TEXT');
  assert.throws(() => encodeCsv(['﻿=total'], []), error => error instanceof CsvEncodingError && error.code === 'INVALID_TEXT' && error.record === 0 && error.column === 0);
  for (const directive of ['sep=;', 'SEP=,', ' sep=\t']) rejects(() => encodeCsv([directive], [[{ kind: 'text', value: 'safe;=1+1' }]]), 'INVALID_HEADER');
  assert.equal(encodeCsv(['metric', 'sep=;'], []), 'metric,sep=;\r\n');
  rejects(() => encodeCsv(['a'], [[null]]), 'INVALID_CELL');
  rejects(() => encodeCsv(['a'], [[{ kind: 'formula', value: '=1' }]]), 'INVALID_CELL');
  rejects(() => encodeMoneyCell('-0.5', 0), 'INVALID_MONEY');
  rejects(() => encodeTextCell('\u061C=1+1'), 'INVALID_TEXT');
  rejects(() => encodeCsv(['a', 'b'], [[{ kind: 'text', value: 'x' }, ,]]), 'INVALID_CELL');
  rejects(() => encodeCsv(['a', ,], []), 'INVALID_TEXT');
  rejects(() => encodeCsv(['a'], [null]), 'INVALID_CELL');
});
