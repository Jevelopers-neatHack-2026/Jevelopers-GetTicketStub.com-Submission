export type ExactRational = { readonly numerator: bigint; readonly denominator: bigint };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

export function rational(numerator: bigint, denominator = 1n): ExactRational {
  if (denominator === 0n) throw new Error('A rational denominator cannot be zero.');
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor * sign, denominator: (denominator < 0n ? -denominator : denominator) / divisor };
}

export function parseNonNegativeDecimal(value: string): ExactRational {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(value);
  if (!match) throw new Error('A decimal failed exact pricing validation.');
  const fraction = match[2] ?? '';
  const whole = BigInt(match[1] ?? '0');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = whole * denominator + BigInt(fraction || '0');
  return rational(numerator, denominator);
}

export function add(left: ExactRational, right: ExactRational): ExactRational {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

export function subtract(left: ExactRational, right: ExactRational): ExactRational {
  return rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

export function multiply(left: ExactRational, right: ExactRational): ExactRational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divide(left: ExactRational, right: ExactRational): ExactRational {
  if (right.numerator === 0n) throw new Error('A pricing divisor cannot be zero.');
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function compare(left: ExactRational, right: ExactRational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function roundedDecimal(value: ExactRational, scale = 18): string {
  if (value.numerator < 0n) throw new Error('Pricing result cannot be negative.');
  const factor = 10n ** BigInt(scale);
  const scaledNumerator = value.numerator * factor;
  let rounded = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;
  const doubled = remainder * 2n;
  if (doubled > value.denominator || (doubled === value.denominator && rounded % 2n !== 0n)) rounded += 1n;
  const whole = rounded / factor;
  const fractional = (rounded % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  return fractional.length > 0 ? whole.toString() + '.' + fractional : whole.toString();
}

export function ratioJson(value: ExactRational): { numerator: string; denominator: string } {
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

export function secondsBetween(startMicros: bigint, endMicros: bigint): number {
  if (endMicros <= startMicros) return 0;
  const seconds = (endMicros - startMicros) / 1_000_000n;
  return Number(seconds);
}

/** Parse a UTC timestamp at PostgreSQL's microsecond precision without Date's millisecond truncation. */
export function utcMicros(value: string): bigint | null {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.([0-9]{1,6}))?Z$/.exec(value);
  if (!match) return null;
  const base = Date.parse(match[1] + 'Z');
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 19) !== match[1]) return null;
  const seconds = BigInt(Math.floor(base / 1000));
  const fraction = BigInt((match[2] ?? '').padEnd(6, '0') || '0');
  return seconds * 1_000_000n + fraction;
}
