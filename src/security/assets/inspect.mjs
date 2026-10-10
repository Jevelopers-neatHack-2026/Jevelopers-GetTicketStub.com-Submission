import { createHash, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isProxy } from 'node:util/types';
import sax from 'sax';

export const SAFE_ASSET_POLICY_VERSION = 'svg-static-geometry/1';
export const SAFE_ASSET_LIMITS = Object.freeze({
  maxSourceBytes: 128 * 1024,
  maxTransformedBytes: 512 * 1024,
  maxElements: 1024,
  maxDepth: 32,
  maxAttributesPerElement: 24,
  maxTokenLength: 8192,
  maxNameLength: 64,
  maxAttributeValueLength: 4096,
  maxNumericTokenLength: 128,
  maxPointsValues: 256,
  maxCoordinate: 65_536,
  maxDimension: 4096,
  maxViewBoxDimension: 16_384,
  maxProcessingMs: 250,
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const MIME_SVG = 'image/svg+xml';
const HARD_SOURCE_LIMIT = SAFE_ASSET_LIMITS.maxSourceBytes;
const NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const END_OF_INPUT = '(?![\\s\\S])';
const NUMBER_RE = new RegExp(`^${NUMBER_SOURCE}${END_OF_INPUT}`);
const XML_S_SOURCE = '[\\x20\\x09\\x0a\\x0d]';
const NUMBER_LIST_SEPARATOR_SOURCE = `(?:${XML_S_SOURCE}*,${XML_S_SOURCE}*|${XML_S_SOURCE}+)`;
const NUMBER_LIST_RE = new RegExp(`^${XML_S_SOURCE}*${NUMBER_SOURCE}(?:${NUMBER_LIST_SEPARATOR_SOURCE}${NUMBER_SOURCE})*${XML_S_SOURCE}*${END_OF_INPUT}`);
const POINT_NUMBER_RE = new RegExp(NUMBER_SOURCE, 'g');
const SHORT_HEX_COLOR_RE = /^#[0-9a-f]{3}(?![\s\S])/;
const LONG_HEX_COLOR_RE = /^#[0-9a-f]{6}(?![\s\S])/;
const PAINT_NUMERIC_ATTRIBUTES = new Set([
  'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-miterlimit',
]);
const GEOMETRY_NUMERIC_ATTRIBUTES = new Set([
  'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2',
]);
const PAINT_ATTRIBUTES = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'fill-rule',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
]);
const SHAPE_ATTRIBUTES = Object.freeze({
  rect: new Set(['x', 'y', 'width', 'height', 'rx', 'ry']),
  circle: new Set(['cx', 'cy', 'r']),
  ellipse: new Set(['cx', 'cy', 'rx', 'ry']),
  line: new Set(['x1', 'y1', 'x2', 'y2']),
  polyline: new Set(['points']),
  polygon: new Set(['points']),
});
const SAFE_ELEMENTS = new Set(['svg', 'g', ...Object.keys(SHAPE_ATTRIBUTES)]);
const ACTIVE_ELEMENTS = new Set([
  'script', 'foreignobject', 'image', 'use', 'a', 'iframe', 'object', 'embed', 'style',
  'animate', 'animatemotion', 'animatetransform', 'set', 'feimage', 'font', 'font-face', 'text', 'tspan', 'textpath',
]);
const ACTIVE_ATTRIBUTES = new Set([
  'font', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant',
  'font-weight', 'font-feature-settings', 'font-kerning', 'text-decoration', 'writing-mode',
]);
const SAFE_COLORS = new Set([
  'none', 'black', 'white', 'red', 'green', 'blue', 'yellow', 'gray', 'grey', 'silver',
  'maroon', 'purple', 'fuchsia', 'lime', 'olive', 'navy', 'teal', 'aqua',
]);
const SAFE_FILL_RULES = new Set(['nonzero', 'evenodd']);
const SAFE_LINE_CAPS = new Set(['butt', 'round', 'square']);
const SAFE_LINE_JOINS = new Set(['miter', 'round', 'bevel']);
const OPTION_KEYS = new Set(['contentType', 'signal', 'deadlineAtMs']);

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')?.get;
const typedArraySet = Uint8Array.prototype.set;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get;
const abortSignalAbortedGetter = typeof AbortSignal === 'function'
  ? Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get
  : undefined;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function cloneBytes(bytes) {
  const copy = new Uint8Array(bytes.length);
  typedArraySet.call(copy, bytes);
  return copy;
}

function copyCandidateBytes(candidate, maxBytes = HARD_SOURCE_LIMIT) {
  try {
    if (isProxy(candidate)) return null;
    if (!ArrayBuffer.isView(candidate)) return null;
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return null;
    const length = typedArrayLengthGetter.call(candidate);
    const byteOffset = typedArrayByteOffsetGetter.call(candidate);
    const backing = typedArrayBufferGetter.call(candidate);
    const backingLength = arrayBufferByteLengthGetter.call(backing);
    if (!Number.isSafeInteger(length) || length < 1 || length > maxBytes
      || !Number.isSafeInteger(byteOffset) || byteOffset < 0
      || !Number.isSafeInteger(backingLength) || byteOffset + length > backingLength) return null;
    const copy = new Uint8Array(length);
    typedArraySet.call(copy, candidate);
    return copy;
  } catch {
    // Proxies, detached storage and shared buffers are outside the owned-byte contract.
    return null;
  }
}

function candidateByteLength(candidate) {
  try {
    if (isProxy(candidate)) return null;
    if (!ArrayBuffer.isView(candidate)) return null;
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return null;
    const length = typedArrayLengthGetter.call(candidate);
    const byteOffset = typedArrayByteOffsetGetter.call(candidate);
    const backing = typedArrayBufferGetter.call(candidate);
    const backingLength = arrayBufferByteLengthGetter.call(backing);
    if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(byteOffset) || byteOffset < 0
      || !Number.isSafeInteger(backingLength) || byteOffset + length > backingLength) return null;
    return length;
  } catch {
    return null;
  }
}

function readOptions(options) {
  if (options === undefined) return { contentType: null, signal: null, deadlineAtMs: null, valid: true };
  try {
    if (options === null || typeof options !== 'object' || isProxy(options)) return { valid: false };
    const prototype = Object.getPrototypeOf(options);
    if (prototype !== Object.prototype && prototype !== null) return { valid: false };
    const descriptors = Object.getOwnPropertyDescriptors(options);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.has(key))) return { valid: false };
    const values = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return { valid: false };
      values[key] = descriptor.value;
    }
    const contentType = values.contentType;
    const signal = values.signal ?? null;
    const deadlineAtMs = values.deadlineAtMs ?? null;
    if (contentType !== undefined && (typeof contentType !== 'string' || contentType.length > 128 || !isWellFormedUnicode(contentType))) {
      return { valid: false };
    }
    if (signal !== null && !isAbortSignal(signal)) return { valid: false };
    if (deadlineAtMs !== null && (!Number.isFinite(deadlineAtMs) || deadlineAtMs < 0)) return { valid: false };
    return {
      valid: true,
      contentType: contentType === undefined ? null : contentType,
      signal,
      deadlineAtMs,
    };
  } catch {
    return { valid: false };
  }
}

function isAbortSignal(value) {
  if (!abortSignalAbortedGetter) return false;
  try {
    abortSignalAbortedGetter.call(value);
    return true;
  } catch {
    return false;
  }
}

function isAborted(signal) {
  if (signal === null) return false;
  try {
    return abortSignalAbortedGetter.call(signal) === true;
  } catch {
    return true;
  }
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

// XML 1.0 Fifth Edition production [2] Char, excluding surrogates and U+FFFE/U+FFFF.
function isXml10Character(codePoint) {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function hasXml10Characters(text, check) {
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 0x3ff) === 0 && check() !== null) return null;
    const first = text.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = text.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return false;
      const codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
      if (!isXml10Character(codePoint)) return false;
      index += 1;
      continue;
    }
    if (first >= 0xdc00 && first <= 0xdfff) return false;
    if (!isXml10Character(first)) return false;
  }
  return check() === null;
}

function makeResult({ action, code, sourceBytes = null, sourceSize = null, sourceHash = undefined, transformedBytes = null }) {
  const internalTransformedBytes = transformedBytes === null ? null : cloneBytes(transformedBytes);
  const retainedSourceHash = sourceHash === undefined ? (sourceBytes === null ? null : sha256(sourceBytes)) : sourceHash;
  const transformedHash = internalTransformedBytes === null ? null : sha256(internalTransformedBytes);
  const diagnostics = Object.freeze([Object.freeze({ code })]);
  return Object.freeze({
    policyVersion: SAFE_ASSET_POLICY_VERSION,
    action,
    contentType: action === 'transformed' ? MIME_SVG : null,
    sourceHash: retainedSourceHash,
    transformedHash,
    sourceSize: sourceBytes === null ? sourceSize : sourceBytes.length,
    transformedSize: internalTransformedBytes === null ? null : internalTransformedBytes.length,
    diagnostics,
    copyTransformedBytes() {
      return internalTransformedBytes === null ? null : cloneBytes(internalTransformedBytes);
    },
    matchesTransformedBytes(candidate) {
      if (internalTransformedBytes === null) return false;
      const owned = copyCandidateBytes(candidate, SAFE_ASSET_LIMITS.maxTransformedBytes);
      if (owned === null || owned.length !== internalTransformedBytes.length) return false;
      return timingSafeEqual(owned, internalTransformedBytes);
    },
  });
}

function fail(action, code, sourceBytes = null, sourceSize = null, sourceHash = undefined) {
  return makeResult({ action, code, sourceBytes, sourceSize, sourceHash });
}

function guardState(options, localDeadlineAtMs) {
  if (isAborted(options.signal)) return 'CANCELLED';
  const now = performance.now();
  if (now >= localDeadlineAtMs || (options.deadlineAtMs !== null && now >= options.deadlineAtMs)) {
    return 'DEADLINE_EXCEEDED';
  }
  return null;
}

function parseFiniteNumber(value, { min = -SAFE_ASSET_LIMITS.maxCoordinate, max = SAFE_ASSET_LIMITS.maxCoordinate } = {}) {
  if (value.length === 0 || value.length > 128 || !NUMBER_RE.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  if (number === 0 && /[1-9]/.test(value)) return null;
  return Object.is(number, -0) ? '0' : String(number);
}

function parseNumberList(value, maxValues = SAFE_ASSET_LIMITS.maxPointsValues) {
  if (value.length === 0 || value.length > SAFE_ASSET_LIMITS.maxAttributeValueLength || !NUMBER_LIST_RE.test(value)) return null;
  const rawValues = value.match(POINT_NUMBER_RE);
  if (!rawValues || rawValues.length > maxValues) return null;
  const normalized = [];
  for (const item of rawValues) {
    const number = parseFiniteNumber(item);
    if (number === null) return null;
    normalized.push(number);
  }
  return normalized;
}

function hasOversizedNumberToken(value) {
  const tokens = value.match(POINT_NUMBER_RE);
  return tokens?.some((token) => token.length > SAFE_ASSET_LIMITS.maxNumericTokenLength) === true;
}

function safeColor(value) {
  const normalized = value.toLowerCase();
  if (SAFE_COLORS.has(normalized)) return normalized;
  if (SHORT_HEX_COLOR_RE.test(normalized) || LONG_HEX_COLOR_RE.test(normalized)) return normalized;
  return null;
}

function dangerousValue(value) {
  return /url\s*\(|@import|javascript\s*:|data\s*:/i.test(value);
}

function attributeMap(tag, state) {
  const attributes = Object.values(tag.attributes ?? {});
  if (attributes.length > SAFE_ASSET_LIMITS.maxAttributesPerElement) {
    state.fail('reject', 'LIMIT_EXCEEDED');
    return null;
  }
  const result = new Map();
  for (const attribute of attributes) {
    if (typeof attribute.name !== 'string' || typeof attribute.value !== 'string'
      || attribute.name.length > SAFE_ASSET_LIMITS.maxNameLength
      || attribute.value.length > SAFE_ASSET_LIMITS.maxAttributeValueLength) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return null;
    }
    const name = attribute.name;
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith('on') || ACTIVE_ATTRIBUTES.has(lowerName) || lowerName === 'style' || lowerName === 'href' || lowerName.endsWith(':href') || lowerName === 'src'
      || dangerousValue(attribute.value)) {
      state.fail('reject', 'SVG_ACTIVE_CONTENT');
      return null;
    }
    if (result.has(name)) {
      state.fail('reject', 'SVG_MALFORMED');
      return null;
    }
    result.set(name, attribute);
  }
  return result;
}

function commonPaintAttributes(name, value) {
  if (name === 'fill' || name === 'stroke') return safeColor(value);
  if (name === 'fill-rule') return SAFE_FILL_RULES.has(value) ? value : null;
  if (name === 'stroke-linecap') return SAFE_LINE_CAPS.has(value) ? value : null;
  if (name === 'stroke-linejoin') return SAFE_LINE_JOINS.has(value) ? value : null;
  if (PAINT_NUMERIC_ATTRIBUTES.has(name)) {
    const min = name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity' ? 0
      : name === 'stroke-width' ? 0
        : name === 'stroke-miterlimit' ? 1
          : -SAFE_ASSET_LIMITS.maxCoordinate;
    const max = name === 'opacity' || name === 'fill-opacity' || name === 'stroke-opacity' ? 1
      : name === 'stroke-width' ? 128
        : name === 'stroke-miterlimit' ? 10
          : SAFE_ASSET_LIMITS.maxCoordinate;
    return parseFiniteNumber(value, { min, max });
  }
  return undefined;
}

function parseAttributes(tag, name, state) {
  const source = attributeMap(tag, state);
  if (source === null) return null;
  const output = Object.create(null);
  const allowedShape = SHAPE_ATTRIBUTES[name];
  const isRoot = name === 'svg';
  const isGroup = name === 'g';
  const allowed = new Set([
    ...(isRoot ? ['xmlns', 'width', 'height', 'viewBox'] : []),
    ...(isRoot || isGroup || allowedShape ? PAINT_ATTRIBUTES : []),
    ...(allowedShape ?? []),
  ]);

  for (const [attributeName, attribute] of source) {
    if (attributeName === 'xmlns') {
      if (!isRoot || attribute.value !== SVG_NS || attribute.prefix !== 'xmlns' || attribute.uri !== XMLNS_NS) {
        state.fail('reject', 'UNSUPPORTED_NAMESPACE');
        return null;
      }
      output.xmlns = SVG_NS;
      continue;
    }
    if (attribute.prefix !== '' || attribute.uri !== '') {
      state.fail('reject', 'UNSUPPORTED_NAMESPACE');
      return null;
    }
    if (!allowed.has(attributeName)) {
      state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
      return null;
    }
    if (PAINT_NUMERIC_ATTRIBUTES.has(attributeName) || GEOMETRY_NUMERIC_ATTRIBUTES.has(attributeName)) {
      const numericValue = isRoot && (attributeName === 'width' || attributeName === 'height') && attribute.value.endsWith('px')
        ? attribute.value.slice(0, -2)
        : attribute.value;
      if (numericValue.length > SAFE_ASSET_LIMITS.maxNumericTokenLength) {
        state.fail('reject', 'LIMIT_EXCEEDED');
        return null;
      }
    }

    let normalized;
    if (isRoot && (attributeName === 'width' || attributeName === 'height')) {
      const dimensionText = attribute.value.endsWith('px') ? attribute.value.slice(0, -2) : attribute.value;
      normalized = parseFiniteNumber(dimensionText, { min: Number.MIN_VALUE, max: SAFE_ASSET_LIMITS.maxDimension });
    } else if (isRoot && attributeName === 'viewBox') {
      if (hasOversizedNumberToken(attribute.value)) {
        state.fail('reject', 'LIMIT_EXCEEDED');
        return null;
      }
      const viewBox = parseNumberList(attribute.value, 4);
      if (viewBox?.length === 4 && Number(viewBox[2]) > 0 && Number(viewBox[3]) > 0
        && Number(viewBox[2]) <= SAFE_ASSET_LIMITS.maxViewBoxDimension
        && Number(viewBox[3]) <= SAFE_ASSET_LIMITS.maxViewBoxDimension) {
        normalized = viewBox.join(' ');
      } else normalized = null;
    } else if (attributeName === 'points') {
      const pointTokens = attribute.value.match(POINT_NUMBER_RE);
      if (pointTokens && pointTokens.length > SAFE_ASSET_LIMITS.maxPointsValues) {
        state.fail('reject', 'LIMIT_EXCEEDED');
        return null;
      }
      if (hasOversizedNumberToken(attribute.value)) {
        state.fail('reject', 'LIMIT_EXCEEDED');
        return null;
      }
      const numbers = parseNumberList(attribute.value);
      const minimumValues = name === 'polygon' ? 6 : 4;
      if (numbers?.length >= minimumValues && numbers.length % 2 === 0) normalized = numbers.join(' ');
      else normalized = null;
    } else {
      normalized = commonPaintAttributes(attributeName, attribute.value);
      if (normalized === undefined) {
        const nonnegative = ['width', 'height', 'rx', 'ry', 'r'].includes(attributeName);
        normalized = parseFiniteNumber(attribute.value, {
          min: nonnegative ? 0 : -SAFE_ASSET_LIMITS.maxCoordinate,
          max: nonnegative ? SAFE_ASSET_LIMITS.maxDimension : SAFE_ASSET_LIMITS.maxCoordinate,
        });
      }
    }

    if (normalized === null) {
      state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
      return null;
    }
    output[attributeName] = normalized;
  }

  if (isRoot) {
    if (!Object.hasOwn(output, 'xmlns') || !Object.hasOwn(output, 'width') || !Object.hasOwn(output, 'height')) {
      state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
      return null;
    }
  }
  for (const required of name === 'rect' ? ['width', 'height']
    : name === 'circle' ? ['cx', 'cy', 'r']
      : name === 'ellipse' ? ['cx', 'cy', 'rx', 'ry']
        : name === 'line' ? ['x1', 'y1', 'x2', 'y2']
          : name === 'polyline' || name === 'polygon' ? ['points'] : []) {
    if (!Object.hasOwn(output, required)) {
      state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
      return null;
    }
  }
  return output;
}

function serializeAttributes(attributes) {
  return Object.keys(attributes).sort().map((name) => ` ${name}="${escapeAttribute(attributes[name])}"`).join('');
}

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function serializeNode(node, state) {
  state.guard();
  if (state.action !== null) return null;
  const attributes = serializeAttributes(node.attributes);
  if (node.name !== 'svg' && node.name !== 'g') return `<${node.name}${attributes}/>`;
  const children = [];
  for (const child of node.children) {
    const serializedChild = serializeNode(child, state);
    if (serializedChild === null) return null;
    children.push(serializedChild);
  }
  return `<${node.name}${attributes}>${children.join('')}</${node.name}>`;
}

function looksLikeMarkup(bytes) {
  try {
    const prefix = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
    return prefix.replace(/^\uFEFF/, '').trimStart().startsWith('<');
  } catch {
    return false;
  }
}

function parseSvg(text, options, deadlineAtMs) {
  const state = {
    action: null,
    code: null,
    root: null,
    stack: [],
    elementCount: 0,
    fail(action, code) {
      if (this.action === null) {
        this.action = action;
        this.code = code;
      }
    },
    guard() {
      const code = guardState(options, deadlineAtMs);
      if (code !== null) this.fail('reject', code);
      return code;
    },
  };
  state.guard();
  if (state.action !== null) return { action: state.action, code: state.code };
  const validXmlCharacters = hasXml10Characters(text, () => state.guard());
  if (state.action !== null) return { action: state.action, code: state.code };
  if (!validXmlCharacters) return { action: 'reject', code: 'SVG_MALFORMED' };
  if (text.includes('&')) return { action: 'reject', code: 'SVG_ENTITY_REFERENCE' };
  if (text.includes('<!')) return { action: 'reject', code: 'SVG_UNSUPPORTED_DECLARATION' };
  if (text.includes('<?')) return { action: 'reject', code: 'SVG_UNSUPPORTED_DECLARATION' };
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, position: true });
  parser.onerror = () => state.fail('reject', 'SVG_MALFORMED');
  parser.ondoctype = () => state.fail('reject', 'SVG_UNSUPPORTED_DECLARATION');
  parser.onprocessinginstruction = () => state.fail('reject', 'SVG_UNSUPPORTED_DECLARATION');
  parser.oncomment = () => state.fail('reject', 'SVG_UNSUPPORTED_DECLARATION');
  let rawAttributeNames = new Set();
  let rawAttributeCount = 0;
  parser.onopentagstart = () => {
    state.guard();
    rawAttributeNames = new Set();
    rawAttributeCount = 0;
  };
  parser.onattribute = (attribute) => {
    state.guard();
    if (typeof attribute.name !== 'string' || typeof attribute.value !== 'string') {
      state.fail('reject', 'SVG_MALFORMED');
      return;
    }
    if (attribute.name.length > SAFE_ASSET_LIMITS.maxNameLength
      || attribute.value.length > SAFE_ASSET_LIMITS.maxAttributeValueLength) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return;
    }
    rawAttributeCount += 1;
    if (rawAttributeCount > SAFE_ASSET_LIMITS.maxAttributesPerElement) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return;
    }
    if (rawAttributeNames.has(attribute.name)) {
      state.fail('reject', 'SVG_MALFORMED');
      return;
    }
    rawAttributeNames.add(attribute.name);
    const lowerName = attribute.name.toLowerCase();
    if (lowerName.startsWith('on') || ACTIVE_ATTRIBUTES.has(lowerName) || lowerName === 'style'
      || lowerName === 'href' || lowerName.endsWith(':href') || lowerName === 'src'
      || dangerousValue(attribute.value)) {
      state.fail('reject', 'SVG_ACTIVE_CONTENT');
    }
  };
  parser.ontext = (value) => {
    if (state.action !== null) return;
    state.guard();
    if (state.action !== null) return;
    if (value.length > SAFE_ASSET_LIMITS.maxTokenLength) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return;
    }
    if (/[^\t\n\r ]/.test(value)) state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
  };
  parser.onopentag = (tag) => {
    if (state.action !== null) return;
    state.guard();
    if (state.action !== null) return;
    state.elementCount += 1;
    if (state.elementCount > SAFE_ASSET_LIMITS.maxElements || state.stack.length + 1 > SAFE_ASSET_LIMITS.maxDepth) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return;
    }
    const rawName = tag.name;
    const lowerName = typeof rawName === 'string' ? rawName.toLowerCase() : '';
    if (typeof rawName !== 'string' || rawName.length > SAFE_ASSET_LIMITS.maxNameLength) {
      state.fail('reject', 'LIMIT_EXCEEDED');
      return;
    }
    if (ACTIVE_ELEMENTS.has(lowerName)) {
      state.fail('reject', 'SVG_ACTIVE_CONTENT');
      return;
    }
    if (state.stack.length === 0 && (state.root !== null || tag.local !== 'svg')) {
      state.fail('reject', 'SVG_MALFORMED');
      return;
    }
    if (tag.uri !== SVG_NS || tag.prefix !== '') {
      state.fail('reject', 'UNSUPPORTED_NAMESPACE');
      return;
    }
    if (tag.name !== tag.local || !SAFE_ELEMENTS.has(rawName)) {
      state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
      return;
    }
    if (state.stack.length > 0) {
      const parent = state.stack[state.stack.length - 1];
      if (parent.name !== 'svg' && parent.name !== 'g') {
        state.fail('review', 'SVG_UNSUPPORTED_FEATURE');
        return;
      }
    } else if (state.root !== null) {
      state.fail('reject', 'SVG_MALFORMED');
      return;
    }
    const attributes = parseAttributes(tag, rawName, state);
    if (attributes === null || state.action !== null) return;
    const node = { name: rawName, attributes, children: [] };
    if (state.stack.length === 0) state.root = node;
    else state.stack[state.stack.length - 1].children.push(node);
    state.stack.push(node);
  };
  parser.onclosetag = (name) => {
    if (state.action !== null) return;
    state.guard();
    if (state.action !== null) return;
    const node = state.stack.pop();
    if (!node || node.name !== name) {
      state.fail('reject', 'SVG_MALFORMED');
      return;
    }
  };

  try {
    for (let offset = 0; offset < text.length && state.action === null;) {
      const guardCode = state.guard();
      if (guardCode !== null) break;
      let end = Math.min(text.length, offset + 1024);
      if (end < text.length) {
        const last = text.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) end -= 1;
      }
      parser.write(text.slice(offset, end));
      offset = end;
    }
    if (state.action === null) {
      state.guard();
      if (state.action === null) {
        parser.close();
        state.guard();
      }
    }
  } catch {
    state.fail('reject', 'SVG_MALFORMED');
  }
  if (state.action !== null) return { action: state.action, code: state.code };
  if (state.stack.length !== 0 || state.root === null) return { action: 'reject', code: 'SVG_MALFORMED' };
  const serialized = serializeNode(state.root, state);
  if (state.action !== null || serialized === null) return { action: state.action, code: state.code };
  const transformedBytes = new TextEncoder().encode(serialized);
  state.guard();
  if (state.action !== null) return { action: state.action, code: state.code };
  if (transformedBytes.length > SAFE_ASSET_LIMITS.maxTransformedBytes) return { action: 'reject', code: 'LIMIT_EXCEEDED' };
  return { action: 'transformed', code: 'SVG_SANITIZED', transformedBytes };
}

/**
 * Inspect a bounded byte snapshot. The only supported transformation is a
 * deterministic serialization of the closed static SVG geometry subset.
 */
export function inspectSafeAssetBytes(candidateBytes, options) {
  const operationStartedAtMs = performance.now();
  const localDeadlineAtMs = operationStartedAtMs + SAFE_ASSET_LIMITS.maxProcessingMs;
  const parsedOptions = readOptions(options);
  if (!parsedOptions.valid) return fail('reject', 'INVALID_INPUT');
  const initialGuard = guardState(parsedOptions, localDeadlineAtMs);
  if (initialGuard !== null) return fail('reject', initialGuard);

  const candidateSize = candidateByteLength(candidateBytes);
  if (candidateSize === null) return fail('reject', 'INVALID_INPUT');
  if (candidateSize > SAFE_ASSET_LIMITS.maxSourceBytes) return fail('reject', 'LIMIT_EXCEEDED', null, candidateSize);
  const sourceBytes = copyCandidateBytes(candidateBytes);
  if (sourceBytes === null) return fail('reject', 'INVALID_INPUT');
  const sourceHash = sha256(sourceBytes);
  const postSnapshotGuard = guardState(parsedOptions, localDeadlineAtMs);
  if (postSnapshotGuard !== null) return fail('reject', postSnapshotGuard, sourceBytes, null, sourceHash);
  if (sourceBytes.length > SAFE_ASSET_LIMITS.maxSourceBytes) return fail('reject', 'LIMIT_EXCEEDED', sourceBytes, null, sourceHash);

  const contentType = parsedOptions.contentType?.trim().toLowerCase() ?? '';
  if (contentType !== MIME_SVG) {
    const code = contentType !== '' && looksLikeMarkup(sourceBytes) ? 'CONTENT_TYPE_MISMATCH'
      : contentType.length === 0 ? 'CONTENT_TYPE_REQUIRED' : 'UNSUPPORTED_CONTENT_TYPE';
    const guardCode = guardState(parsedOptions, localDeadlineAtMs);
    if (guardCode !== null) return fail('reject', guardCode, sourceBytes, null, sourceHash);
    return fail(code === 'CONTENT_TYPE_MISMATCH' ? 'reject' : 'review', code, sourceBytes, null, sourceHash);
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  } catch {
    const guardCode = guardState(parsedOptions, localDeadlineAtMs);
    return fail('reject', guardCode ?? 'INVALID_UTF8', sourceBytes, null, sourceHash);
  }
  const guardCode = guardState(parsedOptions, localDeadlineAtMs);
  if (guardCode !== null) return fail('reject', guardCode, sourceBytes, null, sourceHash);
  const parsed = parseSvg(text, parsedOptions, localDeadlineAtMs);
  const postParseGuard = guardState(parsedOptions, localDeadlineAtMs);
  if (postParseGuard !== null) return fail('reject', postParseGuard, sourceBytes, null, sourceHash);
  if (parsed.action !== 'transformed') return fail(parsed.action, parsed.code, sourceBytes, null, sourceHash);
  const transformedResult = makeResult({
    action: 'transformed',
    code: parsed.code,
    sourceBytes,
    sourceHash,
    transformedBytes: parsed.transformedBytes,
  });
  const beforePublishGuard = guardState(parsedOptions, localDeadlineAtMs);
  if (beforePublishGuard !== null) return fail('reject', beforePublishGuard, sourceBytes, null, sourceHash);
  return transformedResult;
}
