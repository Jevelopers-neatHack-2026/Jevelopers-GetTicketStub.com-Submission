/**
 * Deterministic CSV encoding for financial consumer files (CI-08X.3).
 *
 * Output is RFC 4180: comma separators, CRLF after every record, UTF-8 without a byte-order mark.
 * Callers pass typed cells so that money keeps its exact decimal form and free text can never be
 * interpreted as a spreadsheet formula. This module does not choose fields; the export allowlist
 * stays with the export boundary.
 */

export type CsvCell =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'money'; readonly amount: string; readonly scale: number }
  | { readonly kind: 'currency'; readonly code: string }
  | { readonly kind: 'integer'; readonly value: number }
  /** Unknown or absent values. Encoded as an empty cell, never as zero. */
  | { readonly kind: 'empty' };

export type CsvEncodingErrorCode = 'INVALID_TEXT' | 'INVALID_MONEY' | 'INVALID_CURRENCY' | 'INVALID_INTEGER' | 'ROW_WIDTH_MISMATCH' | 'EMPTY_HEADER';

export class CsvEncodingError extends Error {
  readonly code: CsvEncodingErrorCode;
  /** Zero-based record index (0 is the header) and column index of the rejected cell, when known. */
  readonly record: number | null;
  readonly column: number | null;
  constructor(code: CsvEncodingErrorCode, message: string, record: number | null = null, column: number | null = null) {
    super(message);
    this.name = 'CsvEncodingError';
    this.code = code;
    this.record = record;
    this.column = column;
  }
}

export const CSV_RECORD_SEPARATOR = '\r\n';
export const CSV_MAX_SCALE = 18;

// Characters that make spreadsheet applications evaluate a cell, including the full-width forms some
// applications normalize. Checked after leading whitespace, which some applications skip.
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']);
const LEADING_WHITESPACE = /^[ \t\r\n 　]*/;
const NEEDS_QUOTING = /[",\r\n]/;
// C0 controls other than tab, CR and LF have no place in a consumer file.
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const CURRENCY = /^[A-Z]{3}$/;

function quote(value: string): string {
  return NEEDS_QUOTING.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Encode free text. Text that a spreadsheet would evaluate gets a leading apostrophe so it stays data. */
export function encodeTextCell(value: string): string {
  if (typeof value !== 'string' || LONE_SURROGATE.test(value) || DISALLOWED_CONTROL.test(value)) {
    throw new CsvEncodingError('INVALID_TEXT', 'Text cells must be well-formed strings without control characters.');
  }
  const first = value.charAt(0);
  const firstVisible = value.replace(LEADING_WHITESPACE, '').charAt(0);
  const guarded = FORMULA_TRIGGERS.has(first) || FORMULA_TRIGGERS.has(firstVisible) ? `'${value}` : value;
  return quote(guarded);
}

/**
 * Encode an exact decimal at a fixed scale. The fraction is padded to `scale` digits; extra non-zero
 * digits are rejected rather than rounded, and negative zero is written as zero.
 */
export function encodeMoneyCell(amount: string, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > CSV_MAX_SCALE) {
    throw new CsvEncodingError('INVALID_MONEY', `Money scale must be an integer from 0 to ${CSV_MAX_SCALE}.`);
  }
  const match = typeof amount === 'string' ? DECIMAL.exec(amount) : null;
  if (!match) throw new CsvEncodingError('INVALID_MONEY', 'Money amounts must be canonical decimal strings.');
  const [, sign = '', whole = '0', rawFraction = ''] = match;
  const excess = rawFraction.slice(scale);
  if (/[1-9]/.test(excess)) throw new CsvEncodingError('INVALID_MONEY', 'Money amount has more precision than its scale; it will not be rounded.');
  const fraction = rawFraction.slice(0, scale).padEnd(scale, '0');
  const isZero = whole === '0' && !/[1-9]/.test(fraction);
  const digits = scale === 0 ? whole : `${whole}.${fraction}`;
  return isZero ? digits : `${sign}${digits}`;
}

export function encodeCurrencyCell(code: string): string {
  if (typeof code !== 'string' || !CURRENCY.test(code)) {
    throw new CsvEncodingError('INVALID_CURRENCY', 'Currency cells must be three-letter upper-case codes.');
  }
  return code;
}

export function encodeIntegerCell(value: number): string {
  if (!Number.isSafeInteger(value)) throw new CsvEncodingError('INVALID_INTEGER', 'Integer cells must be safe integers.');
  return Object.is(value, -0) ? '0' : String(value);
}

export function encodeCell(cell: CsvCell): string {
  switch (cell.kind) {
    case 'text': return encodeTextCell(cell.value);
    case 'money': return encodeMoneyCell(cell.amount, cell.scale);
    case 'currency': return encodeCurrencyCell(cell.code);
    case 'integer': return encodeIntegerCell(cell.value);
    case 'empty': return '';
    default: throw new CsvEncodingError('INVALID_TEXT', 'Unknown cell kind.');
  }
}

/** Encode a header and typed rows as one CSV document. Every record, including the last, ends in CRLF. */
export function encodeCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  if (header.length === 0) throw new CsvEncodingError('EMPTY_HEADER', 'A CSV table needs at least one column.');
  const records: string[] = [];
  const encodeRecord = (cells: readonly string[]) => cells.join(',') + CSV_RECORD_SEPARATOR;
  records.push(encodeRecord(header.map((name, column) => withPosition(() => encodeTextCell(name), 0, column))));
  rows.forEach((row, index) => {
    const record = index + 1;
    if (row.length !== header.length) {
      throw new CsvEncodingError('ROW_WIDTH_MISMATCH', `Row has ${row.length} cells; the header has ${header.length}.`, record, null);
    }
    records.push(encodeRecord(row.map((cell, column) => withPosition(() => encodeCell(cell), record, column))));
  });
  return records.join('');
}

function withPosition(encode: () => string, record: number, column: number): string {
  try {
    return encode();
  } catch (error) {
    if (error instanceof CsvEncodingError && error.record === null) throw new CsvEncodingError(error.code, error.message, record, column);
    throw error;
  }
}
