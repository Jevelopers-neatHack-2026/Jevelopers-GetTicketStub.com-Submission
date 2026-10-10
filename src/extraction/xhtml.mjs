import sax from "sax";
import { performance } from "node:perf_hooks";

const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

export function xhtmlXmlDeclarationEncodingFromBytes(bytes) {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  const prefix = bytes.subarray(start, Math.min(bytes.length, start + 256)).toString("latin1");
  if (!prefix.startsWith("<?xml")) return null;
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, position: true });
  let encoding = null;
  parser.onprocessinginstruction = (instruction) => {
    if (instruction?.name === "xml") {
      encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(instruction.body)?.[2]?.toLowerCase() ?? null;
    }
  };
  parser.onerror = () => {};
  try {
    parser.write(prefix);
  } catch {
    // A prefix may stop inside the root element; the declaration has already been read.
  }
  return encoding;
}

/** Parse XHTML as well-formed XML, without resolving external identifiers. */
export async function parseXhtmlDocument(text, { signal, limits }) {
  const document = { nodeName: "#document", childNodes: [] };
  const stack = [document];
  const parser = sax.parser(true, { xmlns: true, strictEntities: true, position: true });
  const startedAt = performance.now();
  let nodeCount = 1;
  let resourceLimited = false;
  let parseError = null;
  let forbiddenDtd = false;
  let xmlEncoding = null;
  let sourceCursor = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let cdataSection = null;

  const onParserError = (error) => {
    parseError = error;
  };
  parser.onerror = onParserError;

  parser.onopentag = function onOpenTag(tag) {
    if (resourceLimited || parseError) return;
    nodeCount += 1;
    if (nodeCount > limits.maxHtmlNodes) {
      resourceLimited = true;
      return;
    }

    const startOffset = Math.max(0, this.startTagPosition - 1);
    const endOffset = Math.min(text.length, this.position);
    const attrRanges = xmlAttributeRanges(text, startOffset, endOffset);
    const attrs = [];
    for (const attribute of Object.values(tag.attributes ?? {})) {
      if (attribute.uri === XMLNS_NS || attribute.name === "xmlns" || attribute.prefix === "xmlns") continue;
      const name = String(attribute.name ?? attribute.local ?? "").toLowerCase();
      attrs.push({ name, value: String(attribute.value ?? "") });
    }

    const node = {
      nodeName: tag.name,
      tagName: String(tag.local || tag.name).toLowerCase(),
      namespaceURI: tag.uri || "",
      attrs,
      childNodes: [],
      _selfClosing: tag.isSelfClosing === true,
      ...(String(tag.local || tag.name).toLowerCase() === "script"
        && attrs.some((attribute) => attribute.name === "type"
          && attribute.value.split(";", 1)[0].trim().toLowerCase() === "application/ld+json")
        ? { _jsonLdText: "", _jsonLdSourceSegments: [], _jsonLdResourceLimited: false }
        : {}),
      sourceCodeLocation: {
        startOffset,
        endOffset,
        startTag: { startOffset, endOffset },
        attrs: attrRanges,
      },
    };
    stack[stack.length - 1].childNodes.push(node);
    stack.push(node);
    sourceCursor = endOffset;
  };

  parser.onclosetag = function onCloseTag(name) {
    if (resourceLimited || parseError) return;
    if (stack.length <= 1) {
      parseError = new Error("Unexpected closing element");
      return;
    }
    const node = stack.pop();
    if (String(node.nodeName) !== String(name)) {
      parseError = new Error("Mismatched closing element");
      return;
    }
    const endOffset = Math.min(text.length, this.position);
    if (!node._selfClosing) {
      const startOffset = Math.max(node.sourceCodeLocation.startTag.endOffset, this.startTagPosition - 1);
      node.sourceCodeLocation.endTag = { startOffset, endOffset };
    }
    node.sourceCodeLocation.endOffset = endOffset;
    if (typeof node._jsonLdResourceLimited === "boolean") {
      node.jsonLdText = typeof node._jsonLdText === "string" ? node._jsonLdText : null;
      node.jsonLdSourceSegments = node._jsonLdSourceSegments;
      node.jsonLdResourceLimited = node._jsonLdResourceLimited;
      delete node._jsonLdText;
      delete node._jsonLdSourceSegments;
      delete node._jsonLdResourceLimited;
    }
    delete node._selfClosing;
    sourceCursor = endOffset;
  };

  parser.ontext = function onText(value) {
    if (resourceLimited || parseError || value === "") return;
    const mapped = mapTextEvent(text, sourceCursor, value);
    if (!mapped) {
      parseError = new Error("XML text source mapping unavailable");
      return;
    }
    appendText(stack[stack.length - 1], value, mapped.startOffset, mapped.endOffset, mapped.segments, limits);
    sourceCursor = mapped.endOffset;
  };

  parser.onopencdata = function onOpenCdata() {
    if (cdataSection !== null) {
      parseError = new Error("Nested CDATA section");
      return;
    }
    cdataSection = { cursor: Math.min(text.length, this.position) };
    sourceCursor = cdataSection.cursor;
  };

  parser.oncdata = function onCdata(value) {
    if (resourceLimited || parseError) return;
    if (!cdataSection || typeof value !== "string" || value.length === 0) {
      parseError = new Error("CDATA lifecycle unavailable");
      return;
    }
    const startOffset = cdataSection.cursor;
    const endOffset = startOffset + value.length;
    if (endOffset > text.length || text.slice(startOffset, endOffset) !== value) {
      parseError = new Error("CDATA source mapping unavailable");
      return;
    }
    appendText(stack[stack.length - 1], value, startOffset, endOffset, [Object.freeze({
      logicalStart: 0,
      logicalEnd: value.length,
      sourceStart: startOffset,
      sourceEnd: endOffset,
      linear: true,
    })], limits);
    cdataSection.cursor = endOffset;
    sourceCursor = endOffset;
  };

  parser.onclosecdata = function onCloseCdata() {
    if (!cdataSection || this.position - cdataSection.cursor !== 3
      || text.slice(cdataSection.cursor, this.position) !== "]]>") {
      parseError = new Error("CDATA closing source mapping unavailable");
      return;
    }
    sourceCursor = this.position;
    cdataSection = null;
  };

  parser.oncomment = function onComment() {
    sourceCursor = Math.min(text.length, this.position);
  };
  parser.onprocessinginstruction = function onProcessingInstruction(instruction) {
    if (instruction?.name === "xml") {
      xmlEncoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(instruction.body)?.[2]?.toLowerCase() ?? null;
    }
    sourceCursor = Math.min(text.length, this.position);
  };
  parser.ondoctype = function onDoctype(value) {
    if (hasInternalSubset(value)) {
      forbiddenDtd = true;
      parseError = new Error("DTD entity declarations are unsupported");
    }
    sourceCursor = Math.min(text.length, this.position);
  };

  let offset = 0;
  while (offset < text.length) {
    if (signal?.aborted) return { ok: false, code: "CANCELED" };
    if (performance.now() - startedAt > limits.parseTimeoutMs) return { ok: false, code: "PARSER_DEADLINE" };
    if (resourceLimited) return { ok: false, code: "HTML_NODE_LIMIT" };
    if (parseError) return { ok: false, code: forbiddenDtd ? "XHTML_DTD_UNSUPPORTED" : "MALFORMED_XHTML" };

    let endOffset = Math.min(text.length, offset + limits.htmlChunkCodeUnits);
    if (endOffset < text.length) {
      const previous = text.charCodeAt(endOffset - 1);
      const next = text.charCodeAt(endOffset);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        endOffset = endOffset - offset > 1 ? endOffset - 1 : endOffset + 1;
      }
    }
    try {
      parser.write(text.slice(offset, endOffset));
    } catch {
      parseError ||= new Error("Malformed XHTML");
    }
    if (parseError) return { ok: false, code: forbiddenDtd ? "XHTML_DTD_UNSUPPORTED" : "MALFORMED_XHTML" };
    if (resourceLimited) return { ok: false, code: "HTML_NODE_LIMIT" };
    offset = endOffset;
    await new Promise((resolve) => setImmediate(resolve));
  }

  if (signal?.aborted) return { ok: false, code: "CANCELED" };
  if (performance.now() - startedAt > limits.parseTimeoutMs) return { ok: false, code: "PARSER_DEADLINE" };
  try {
    parser.close();
  } catch {
    parseError ||= new Error("Malformed XHTML");
  }
  if (parseError) return { ok: false, code: forbiddenDtd ? "XHTML_DTD_UNSUPPORTED" : "MALFORMED_XHTML" };
  if (stack.length !== 1) return { ok: false, code: "MALFORMED_XHTML" };
  return { ok: true, document, xmlEncoding };
}

function appendText(parent, value, startOffset, endOffset, segments, limits) {
  if (endOffset < startOffset) return;
  const node = {
    nodeName: "#text",
    value,
    sourceCodeLocation: { startOffset, endOffset },
  };
  parent.childNodes.push(node);
  if (!Array.isArray(parent._jsonLdSourceSegments) || parent._jsonLdResourceLimited) return;
  const logicalStart = parent._jsonLdText.length;
  if (logicalStart + value.length > limits.maxJsonLdBytes
    || parent._jsonLdSourceSegments.length + segments.length > limits.maxJsonLdBytes) {
    parent._jsonLdText = null;
    parent._jsonLdSourceSegments = null;
    parent._jsonLdResourceLimited = true;
    return;
  }
  parent._jsonLdText += value;
  for (const segment of segments) {
    parent._jsonLdSourceSegments.push({
      ...segment,
      logicalStart: logicalStart + segment.logicalStart,
      logicalEnd: logicalStart + segment.logicalEnd,
    });
  }
}

function mapTextEvent(source, startOffset, value) {
  const segments = [];
  let sourceOffset = startOffset;
  let logicalOffset = 0;
  while (logicalOffset < value.length) {
    const rawStart = sourceOffset;
    let decoded;
    let linear;
    if (source[sourceOffset] === "&") {
      const semicolon = source.indexOf(";", sourceOffset + 1);
      if (semicolon < 0 || semicolon - sourceOffset > 16) return null;
      decoded = decodeXmlReference(source.slice(sourceOffset, semicolon + 1));
      if (decoded === null) return null;
      sourceOffset = semicolon + 1;
      linear = false;
    } else {
      if (sourceOffset >= source.length || source[sourceOffset] === "<") return null;
      const codePoint = source.codePointAt(sourceOffset);
      decoded = String.fromCodePoint(codePoint);
      sourceOffset += decoded.length;
      linear = true;
    }
    if (!value.startsWith(decoded, logicalOffset)) return null;
    appendMappingSegment(segments, {
      logicalStart: logicalOffset,
      logicalEnd: logicalOffset + decoded.length,
      sourceStart: rawStart,
      sourceEnd: sourceOffset,
      linear,
    });
    logicalOffset += decoded.length;
  }
  return { startOffset, endOffset: sourceOffset, segments };
}

function decodeXmlReference(reference) {
  const entities = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
  };
  if (Object.hasOwn(entities, reference)) return entities[reference];
  const numeric = /^&#(?:(x)([0-9a-f]+)|([0-9]+));$/i.exec(reference);
  if (!numeric) return null;
  const codePoint = numeric[1]
    ? Number.parseInt(numeric[2], 16)
    : Number.parseInt(numeric[3], 10);
  const xmlCharacter = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
  if (!xmlCharacter) return null;
  return String.fromCodePoint(codePoint);
}

function appendMappingSegment(segments, next) {
  const previous = segments.at(-1);
  if (previous?.linear && next.linear
    && previous.logicalEnd === next.logicalStart
    && previous.sourceEnd === next.sourceStart) {
    previous.logicalEnd = next.logicalEnd;
    previous.sourceEnd = next.sourceEnd;
    return;
  }
  segments.push(next);
}

function xmlAttributeRanges(text, startOffset, endOffset) {
  const ranges = Object.create(null);
  let cursor = startOffset + 1;
  while (cursor < endOffset && !/[\s/>]/.test(text[cursor])) cursor += 1;
  while (cursor < endOffset) {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] === "/" || text[cursor] === ">") break;
    const nameStart = cursor;
    while (cursor < endOffset && !/[\s=/>]/.test(text[cursor])) cursor += 1;
    if (cursor === nameStart) break;
    const name = text.slice(nameStart, cursor).toLowerCase();
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (text[cursor] !== "=") {
      ranges[name] = { startOffset: nameStart, endOffset: cursor };
      continue;
    }
    cursor += 1;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    const quote = text[cursor] === '"' || text[cursor] === "'" ? text[cursor] : null;
    if (quote === null) continue;
    cursor += 1;
    while (cursor < endOffset && text[cursor] !== quote) cursor += 1;
    if (text[cursor] === quote) cursor += 1;
    ranges[name] = { startOffset: nameStart, endOffset: cursor };
  }
  return ranges;
}

function hasInternalSubset(doctype) {
  let quote = null;
  for (const character of doctype) {
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "[") return true;
  }
  return false;
}
