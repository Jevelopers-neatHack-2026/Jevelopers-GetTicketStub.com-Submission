import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
