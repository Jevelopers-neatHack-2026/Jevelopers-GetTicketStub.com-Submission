import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  inspectSafeAssetBytes,
  SAFE_ASSET_LIMITS,
  SAFE_ASSET_POLICY_VERSION,
} from '../../../src/security/assets/inspect.mjs';

const SVG_TYPE = 'image/svg+xml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (contents = '<rect x="4" y="5" width="20" height="10" fill="#0aF"/>') =>
  `<svg xmlns="${SVG_NS}" width="120" height="80" viewBox="0,0,120,80">${contents}</svg>`;
const bytes = (value) => Buffer.from(value, 'utf8');
const inspect = (value, contentType = SVG_TYPE, extra = {}) =>
  inspectSafeAssetBytes(value, { contentType, ...extra });

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('transforms a closed set of static geometric SVG elements deterministically', () => {
  const source = bytes(svg('<g fill="white" opacity=".5"><rect x="4.00" y="5" width="20" height="10" fill="#0aF"/><circle cx="40" cy="20" r="8" stroke="black" stroke-width="2" fill="none"/><polygon points="0,0 4,0 4,4"/></g>'));
  const result = inspect(source);

  assert.equal(result.action, 'transformed');
  assert.equal(result.policyVersion, SAFE_ASSET_POLICY_VERSION);
  assert.equal(result.sourceHash, hash(source));
  assert.equal(result.contentType, SVG_TYPE);
  assert.notEqual(result.transformedHash, result.sourceHash);
  const transformed = result.copyTransformedBytes();
  assert.ok(transformed instanceof Uint8Array);
  assert.equal(Buffer.from(transformed).toString('utf8'),
    `<svg height="80" viewBox="0 0 120 80" width="120" xmlns="${SVG_NS}"><g fill="white" opacity="0.5"><rect fill="#0af" height="10" width="20" x="4" y="5"/><circle cx="40" cy="20" fill="none" r="8" stroke="black" stroke-width="2"/><polygon points="0 0 4 0 4 4"/></g></svg>`);
  assert.equal(result.transformedSize, transformed.length);
  assert.equal(result.transformedHash, hash(transformed));
  assert.equal(result.matchesTransformedBytes(transformed), true);
});

test('rejects active elements, active attributes, namespace tricks, and external references', async (t) => {
  const cases = [
    ['script element', svg('<script>alert(1)</script>'), 'SVG_ACTIVE_CONTENT'],
    ['case-varied event attribute', svg('<rect width="1" height="1" ONLOAD="run()"/>'), 'SVG_ACTIVE_CONTENT'],
    ['foreignObject casing', svg('<FOREIGNOBJECT/>'), 'SVG_ACTIVE_CONTENT'],
    ['CSS url value', svg('<rect width="1" height="1" fill="url(https://example.invalid/a.svg#x)"/>'), 'SVG_ACTIVE_CONTENT'],
    ['remote href', svg('<a href="https://example.invalid/logo.svg"><rect width="1" height="1"/></a>'), 'SVG_ACTIVE_CONTENT'],
    ['namespaced external href', `<svg xmlns="${SVG_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10"><rect xlink:href="https://example.invalid/a" width="1" height="1"/></svg>`, 'UNSUPPORTED_NAMESPACE'],
    ['unsupported namespace', '<x:svg xmlns:x="http://www.w3.org/2000/svg" width="10" height="10"/>', 'UNSUPPORTED_NAMESPACE'],
    ['font element', svg('<font><font-face font-family="Example"/></font>'), 'SVG_ACTIVE_CONTENT'],
    ['font attribute', svg('<rect width="1" height="1" font-family="Example"/>'), 'SVG_ACTIVE_CONTENT'],
    ['image element', svg('<image href="data:image/png;base64,AAAA"/>'), 'SVG_ACTIVE_CONTENT'],
    ['animation element', svg('<animate attributeName="x"/>'), 'SVG_ACTIVE_CONTENT'],
    ['CSS style element', svg('<style>.x { fill: red }</style>'), 'SVG_ACTIVE_CONTENT'],
  ];
  for (const [name, source, code] of cases) {
    await t.test(name, () => {
      const result = inspect(bytes(source));
      assert.equal(result.action, 'reject');
      assert.equal(result.diagnostics[0].code, code);
      assert.equal(result.transformedHash, null);
      assert.equal(result.copyTransformedBytes(), null);
    });
  }
});

test('rejects declarations, entity references, malformed XML, trailing markup, and SVG/HTML polyglots', async (t) => {
  const cases = [
    ['doctype', `<!DOCTYPE svg [<!ENTITY x "bad">]><svg xmlns="${SVG_NS}" width="1" height="1"/>`, 'SVG_UNSUPPORTED_DECLARATION'],
    ['processing instruction', `<?xml-stylesheet href="https://example.invalid/a.css"?><svg xmlns="${SVG_NS}" width="1" height="1"/>`, 'SVG_UNSUPPORTED_DECLARATION'],
    ['XML declaration', `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="${SVG_NS}" width="1" height="1"/>`, 'SVG_UNSUPPORTED_DECLARATION'],
    ['predefined entity', svg('<rect width="1" height="1" aria-label="a&amp;b"/>'), 'SVG_ENTITY_REFERENCE'],
    ['numeric entity', svg('<rect width="1" height="1" fill="&#x72;ed"/>'), 'SVG_ENTITY_REFERENCE'],
    ['duplicate raw attribute names', svg('<rect width="1" width="2" height="1"/>'), 'SVG_MALFORMED'],
    ['duplicate active attributes', svg('<rect width="1" height="1" onload="first()" onload="second()"/>'), 'SVG_ACTIVE_CONTENT'],
    ['duplicate namespace declaration', `<svg xmlns="evil" xmlns="${SVG_NS}" width="1" height="1"/>`, 'SVG_MALFORMED'],
    ['mismatched close', bytes(`<svg xmlns="${SVG_NS}" width="1" height="1"><g></svg>`), 'SVG_MALFORMED'],
    ['trailing root', `${svg()}<html/>`, 'SVG_MALFORMED'],
    ['trailing non-whitespace text', `${svg()}trailing`, 'SVG_MALFORMED'],
    ['comment polyglot', `<!--html--><svg xmlns="${SVG_NS}" width="1" height="1"/>`, 'SVG_UNSUPPORTED_DECLARATION'],
    ['HTML document declared as SVG', '<!doctype html><html><body>hi</body></html>', 'SVG_UNSUPPORTED_DECLARATION'],
  ];
  for (const [name, source, code] of cases) {
    await t.test(name, () => {
      const result = inspect(bytes(source));
      assert.equal(result.action, 'reject');
      assert.equal(result.diagnostics[0].code, code);
    });
  }
});

test('rejects every tested XML 1.0 forbidden character before SVG normalization', () => {
  const cases = [
    ['vertical tab in viewBox separator', svg(`<rect width="1" height="1"/>`).replace('viewBox="0,0,120,80"', 'viewBox="0\u000b0 120 80"'), 'SVG_MALFORMED'],
    ['form feed in viewBox separator', svg(`<rect width="1" height="1"/>`).replace('viewBox="0,0,120,80"', 'viewBox="0\u000c0 120 80"'), 'SVG_MALFORMED'],
    ['vertical tab in polyline points', svg(`<polyline points="0\u000b0 1 1"/>`), 'SVG_MALFORMED'],
    ['form feed in polygon points', svg(`<polygon points="0 0\u000c1 1 2 2"/>`), 'SVG_MALFORMED'],
    ['NUL in a numeric attribute', svg(`<rect width="1\u0000" height="1"/>`), 'SVG_MALFORMED'],
    ['C0 control in text content', svg(`<g>\u001f</g>`), 'SVG_MALFORMED'],
    ['C0 control in unsupported attribute', svg(`<rect width="1" height="1" data-note="a\u000b"/>`), 'SVG_MALFORMED'],
    ['U+FFFE in attribute', svg(`<rect width="1" height="1" data-note="\uFFFE"/>`), 'SVG_MALFORMED'],
    ['U+FFFF in paint attribute', svg(`<rect width="1" height="1" fill="\uFFFF"/>`), 'SVG_MALFORMED'],
    ['U+FFFE in text content', svg(`<g>\uFFFE</g>`), 'SVG_MALFORMED'],
    ['U+FFFE in viewBox', svg(`<rect width="1" height="1"/>`).replace('viewBox="0,0,120,80"', 'viewBox="0\uFFFE0 120 80"'), 'SVG_MALFORMED'],
    ['U+FFFF in points', svg(`<polyline points="0 0 1\uFFFF1"/>`), 'SVG_MALFORMED'],
    ['U+FFFF in unsupported attribute', svg(`<rect width="1" height="1" data-note="\uFFFF"/>`), 'SVG_MALFORMED'],
    ['U+FFFF in text content', svg(`<g>\uFFFF</g>`), 'SVG_MALFORMED'],
  ];
  const forbiddenC0 = Array.from({ length: 0x20 }, (_, codePoint) => codePoint)
    .filter((codePoint) => ![0x09, 0x0a, 0x0d].includes(codePoint));
  for (const codePoint of forbiddenC0) {
    const character = String.fromCodePoint(codePoint);
    const label = `U+${codePoint.toString(16).padStart(4, '0').toUpperCase()}`;
    cases.push([`${label} in viewBox`, `<svg xmlns="${SVG_NS}" width="10" height="10" viewBox="0${character}0 10 10"/>`, 'SVG_MALFORMED']);
    cases.push([`${label} in points`, `<svg xmlns="${SVG_NS}" width="10" height="10"><polyline points="0${character}0 1 1"/></svg>`, 'SVG_MALFORMED']);
  }
  for (const [name, source, code] of cases) {
    const result = inspect(bytes(source));
    assert.equal(result.action, 'reject', name);
    assert.equal(result.diagnostics[0].code, code, name);
    assert.equal(result.transformedHash, null, name);
    assert.equal(result.copyTransformedBytes(), null, name);
  }
  const source = bytes(svg(`<rect width="1" height="1" data-note="\uE000\uFFFD\u{10000}\u{10FFFF}"/>`));
  const result = inspect(source);
  assert.equal(result.action, 'review');
  assert.equal(result.diagnostics[0].code, 'SVG_UNSUPPORTED_FEATURE');
  assert.equal(result.transformedHash, null);
});

test('accepts only XML S separators in number lists and preserves all six geometry shapes', () => {
  const source = bytes(`<svg xmlns="${SVG_NS}" width="10" height="10" viewBox="0\t0\n10\r10"><rect width="1" height="1"/><circle cx="2" cy="2" r="1"/><ellipse cx="4" cy="4" rx="2" ry="1"/><line x1="0" y1="0" x2="1" y2="1"/><polyline points="0\t0,1\n1"/><polygon points="0\r0 1 0 1 1"/></svg>`);
  const result = inspect(source);
  assert.equal(result.action, 'transformed');
  const transformed = Buffer.from(result.copyTransformedBytes()).toString('utf8');
  assert.match(transformed, /viewBox="0 0 10 10"/);
  for (const shape of ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']) {
    assert.ok(transformed.includes(`<${shape}`), `expected ${shape} in transformed SVG`);
  }
  assert.ok(transformed.includes('points="0 0 1 1"'));
  assert.ok(transformed.includes('points="0 0 1 0 1 1"'));

  const nonXmlSpaces = [
    ['no-break space separator', `<svg xmlns="${SVG_NS}" width="10" height="10" viewBox="0\u00a00 10 10"/>`],
    ['Unicode line separator suffix', `<svg xmlns="${SVG_NS}" width="10" height="10" viewBox="0 0 10 10\u2028"/>`],
    ['Unicode paragraph separator suffix', `<svg xmlns="${SVG_NS}" width="10" height="10"><polyline points="0 0 1 1\u2029"/></svg>`],
    ['Unicode line separator after scalar number', `<svg xmlns="${SVG_NS}" width="10\u2028" height="10"/>`],
    ['Unicode line separator after hex color', `<svg xmlns="${SVG_NS}" width="10" height="10"><rect width="1" height="1" fill="#abc\u2028"/></svg>`],
  ];
  for (const [name, source] of nonXmlSpaces) {
    const review = inspect(bytes(source));
    assert.equal(review.action, 'review', name);
    assert.equal(review.diagnostics[0].code, 'SVG_UNSUPPORTED_FEATURE', name);
    assert.equal(review.transformedHash, null, name);
  }
});

test('requires an exact SVG media type and keeps unsupported raster bytes in review', () => {
  const source = bytes(svg());
  const mismatch = inspect(source, 'image/png');
  assert.equal(mismatch.action, 'reject');
  assert.equal(mismatch.diagnostics[0].code, 'CONTENT_TYPE_MISMATCH');

  const unsupported = inspect(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png');
  assert.equal(unsupported.action, 'review');
  assert.equal(unsupported.diagnostics[0].code, 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal(unsupported.transformedHash, null);

  const missing = inspectSafeAssetBytes(source, {});
  assert.equal(missing.action, 'review');
  assert.equal(missing.diagnostics[0].code, 'CONTENT_TYPE_REQUIRED');
});

test('rejects malformed UTF-8, non-finite and out-of-bound geometry', async (t) => {
  const cases = [
    ['malformed UTF-8', Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff]), 'INVALID_UTF8'],
    ['infinite number', svg('<circle cx="1e999" cy="1" r="1"/>'), 'SVG_UNSUPPORTED_FEATURE'],
    ['negative width', svg('<rect width="-1" height="1"/>'), 'SVG_UNSUPPORTED_FEATURE'],
    ['oversized root dimension', `<svg xmlns="${SVG_NS}" width="999999" height="1"/>`, 'SVG_UNSUPPORTED_FEATURE'],
    ['unsupported path syntax', svg('<path d="M0 0"/>'), 'SVG_UNSUPPORTED_FEATURE'],
    ['attribute token limit', svg(`<polyline points="${Array(130).fill('1 1').join(' ')}"/>`), 'LIMIT_EXCEEDED'],
    ['attribute count limit', `<svg xmlns="${SVG_NS}" width="1" height="1" ${Array(22).fill(0).map((_, index) => `data-${index}="x"`).join(' ')}/>`, 'LIMIT_EXCEEDED'],
    ['attribute value token limit', svg(`<rect width="1" height="1" fill="${'x'.repeat(SAFE_ASSET_LIMITS.maxAttributeValueLength + 1)}"/>`), 'LIMIT_EXCEEDED'],
    ['overwritten oversized first attribute', svg(`<rect width="1" height="1" fill="${'x'.repeat(SAFE_ASSET_LIMITS.maxAttributeValueLength + 1)}" fill="red"/>`), 'LIMIT_EXCEEDED'],
    ['one thousand duplicate raw attributes', svg(`<rect ${Array(1000).fill('width="1"').join(' ')} height="1"/>`), 'SVG_MALFORMED'],
    ['raw attribute count limit', svg(`<rect ${Array(32).fill(0).map((_, index) => `data-${index}="x"`).join(' ')} width="1" height="1"/>`), 'LIMIT_EXCEEDED'],
    ['attribute name limit', `<svg xmlns="${SVG_NS}" width="1" height="1" ${`x${'a'.repeat(SAFE_ASSET_LIMITS.maxNameLength)}="y"`}/>`, 'LIMIT_EXCEEDED'],
    ['numeric token limit', svg(`<circle cx="${'1'.repeat(SAFE_ASSET_LIMITS.maxNumericTokenLength + 1)}" cy="1" r="1"/>`), 'LIMIT_EXCEEDED'],
  ];
  for (const [name, source, code] of cases) {
    await t.test(name, () => {
      const result = inspect(source instanceof Buffer ? source : bytes(source));
      assert.equal(result.action, code === 'SVG_UNSUPPORTED_FEATURE' ? 'review' : 'reject');
      assert.equal(result.diagnostics[0].code, code);
    });
  }
  assert.equal(SAFE_ASSET_LIMITS.maxSourceBytes, 128 * 1024);
});

test('enforces byte, depth, element, abort, and deadline bounds', async (t) => {
  const oversized = Buffer.alloc(SAFE_ASSET_LIMITS.maxSourceBytes + 1, 0x20);
  const tooLarge = inspect(oversized);
  assert.equal(tooLarge.action, 'reject');
  assert.equal(tooLarge.diagnostics[0].code, 'LIMIT_EXCEEDED');
  assert.equal(tooLarge.sourceSize, oversized.length);
  assert.equal(tooLarge.sourceHash, null);

  const tooDeep = inspect(bytes(`<svg xmlns="${SVG_NS}" width="1" height="1">${'<g>'.repeat(SAFE_ASSET_LIMITS.maxDepth)}${'</g>'.repeat(SAFE_ASSET_LIMITS.maxDepth)}</svg>`));
  assert.equal(tooDeep.action, 'reject');
  assert.equal(tooDeep.diagnostics[0].code, 'LIMIT_EXCEEDED');

  const tooMany = inspect(bytes(`<svg xmlns="${SVG_NS}" width="1" height="1">${'<rect width="1" height="1"/>'.repeat(SAFE_ASSET_LIMITS.maxElements)}</svg>`));
  assert.equal(tooMany.action, 'reject');
  assert.equal(tooMany.diagnostics[0].code, 'LIMIT_EXCEEDED');

  await t.test('pre-aborted signal', () => {
    const controller = new AbortController();
    controller.abort();
    const result = inspect(bytes(svg()), SVG_TYPE, { signal: controller.signal });
    assert.equal(result.action, 'reject');
    assert.equal(result.diagnostics[0].code, 'CANCELLED');
  });

  await t.test('expired deadline', () => {
    const result = inspect(bytes(svg()), SVG_TYPE, { deadlineAtMs: 0 });
    assert.equal(result.action, 'reject');
    assert.equal(result.diagnostics[0].code, 'DEADLINE_EXCEEDED');
  });

  await t.test('deadline expiry after result construction prevents publishing transformed bytes', () => {
    const originalNow = Object.getOwnPropertyDescriptor(performance, 'now');
    const originalEncode = Object.getOwnPropertyDescriptor(TextEncoder.prototype, 'encode');
    let fakeNow = 1000;
    let afterEncoding = false;
    let postEncodingChecks = 0;
    Object.defineProperty(performance, 'now', {
      configurable: true,
      writable: true,
      value() {
        if (afterEncoding) {
          postEncodingChecks += 1;
          if (postEncodingChecks >= 3) return 2000;
        }
        return fakeNow;
      },
    });
    Object.defineProperty(TextEncoder.prototype, 'encode', {
      ...originalEncode,
      value(value) {
        const output = originalEncode.value.call(this, value);
        afterEncoding = true;
        fakeNow = 1000;
        return output;
      },
    });
    let result;
    try {
      result = inspect(bytes(svg()), SVG_TYPE, { deadlineAtMs: 1500 });
    } finally {
      if (originalNow === undefined) delete performance.now;
      else Object.defineProperty(performance, 'now', originalNow);
      Object.defineProperty(TextEncoder.prototype, 'encode', originalEncode);
    }
    assert.equal(postEncodingChecks, 3, 'the final publication guard runs after result copying and hashing');
    assert.equal(result.action, 'reject');
    assert.equal(result.diagnostics[0].code, 'DEADLINE_EXCEEDED');
    assert.equal(result.transformedHash, null);
    assert.equal(result.copyTransformedBytes(), null);
  });
});

test('rejects a dangerous first duplicate value even when a later value is safe', () => {
  const source = bytes(svg('<rect fill="url(https://evil.invalid/a.svg)" fill="red" width="1" height="1"/>'));
  const result = inspect(source);
  assert.equal(result.action, 'reject');
  assert.equal(result.diagnostics[0].code, 'SVG_ACTIVE_CONTENT');
  assert.equal(result.transformedHash, null);
  assert.equal(result.copyTransformedBytes(), null);
});

test('copies source before inspection and keeps result bytes/hash stable across caller mutation', () => {
  const source = bytes(svg());
  const expectedSourceHash = hash(source);
  const result = inspect(source);
  source.fill(0);
  assert.equal(result.sourceHash, expectedSourceHash);

  const firstCopy = result.copyTransformedBytes();
  const expectedTransformedHash = result.transformedHash;
  firstCopy.fill(0);
  const secondCopy = result.copyTransformedBytes();
  assert.equal(result.transformedHash, expectedTransformedHash);
  assert.notDeepEqual(firstCopy, secondCopy);
  assert.equal(result.matchesTransformedBytes(secondCopy), true);
  assert.equal(result.matchesTransformedBytes(firstCopy), false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.diagnostics), true);
  assert.equal(Object.isFrozen(result.diagnostics[0]), true);
});

test('rejects accessor-backed options and proxy or non-byte candidate inputs without invoking getters', () => {
  let getterCalled = false;
  const accessorOptions = Object.defineProperty({}, 'contentType', {
    enumerable: true,
    get() {
      getterCalled = true;
      throw new Error('must not run');
    },
  });
  assert.equal(inspectSafeAssetBytes(bytes(svg()), accessorOptions).diagnostics[0].code, 'INVALID_INPUT');
  assert.equal(getterCalled, false);

  const proxyOptions = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('proxy options must be rejected');
    },
  });
  assert.equal(inspectSafeAssetBytes(bytes(svg()), proxyOptions).diagnostics[0].code, 'INVALID_INPUT');
  const proxyBytes = new Proxy(bytes(svg()), {});
  assert.equal(inspect(proxyBytes).diagnostics[0].code, 'INVALID_INPUT');
  assert.equal(inspect(new DataView(new ArrayBuffer(4))).diagnostics[0].code, 'INVALID_INPUT');
  assert.equal(inspect(new Uint8Array(new SharedArrayBuffer(4))).diagnostics[0].code, 'INVALID_INPUT');
});

test('does not call network or image-rendering globals', async () => {
  const sourceText = await readFile(new URL('../../../src/security/assets/inspect.mjs', import.meta.url), 'utf8');
  let fetchCalls = 0;
  let renderCalls = 0;
  const priorFetch = globalThis.fetch;
  const priorCreateImageBitmap = globalThis.createImageBitmap;
  globalThis.fetch = () => {
    fetchCalls += 1;
    throw new Error('network access is outside this module');
  };
  globalThis.createImageBitmap = () => {
    renderCalls += 1;
    throw new Error('rendering is outside this module');
  };
  try {
    assert.equal(inspect(bytes(svg())).action, 'transformed');
  } finally {
    globalThis.fetch = priorFetch;
    if (priorCreateImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = priorCreateImageBitmap;
  }
  assert.equal(fetchCalls, 0);
  assert.equal(renderCalls, 0);
  assert.doesNotMatch(sourceText, /from ['"](?:\.\.\/controlled-fetch|\.\.\/\.\.\/[^'"]*render)/);
});
