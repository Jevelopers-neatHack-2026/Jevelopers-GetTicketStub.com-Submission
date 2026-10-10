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
      _scriptParts: [],
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
    if (node.tagName === "script" && attributeValue(node, "type")?.split(";", 1)[0].trim().toLowerCase() === "application/ld+json") {
      const meaningfulParts = node._scriptParts.filter((part) => part.value.trim() !== "");
      if (meaningfulParts.length === 1 && meaningfulParts[0].kind === "cdata") {
        node.sourceCodeLocation.jsonContentSpan = {
          startOffset: meaningfulParts[0].startOffset,
          endOffset: meaningfulParts[0].endOffset,
        };
      }
    }
    delete node._selfClosing;
    delete node._scriptParts;
    sourceCursor = endOffset;
  };

  parser.ontext = function onText(value) {
    if (resourceLimited || parseError || value === "") return;
    const endOffset = textEventEnd(text, sourceCursor, Math.min(text.length, this.position));
    if (endOffset <= sourceCursor) return;
    appendText(stack[stack.length - 1], value, sourceCursor, endOffset, "text");
    sourceCursor = endOffset;
  };

  parser.oncdata = function onCdata(value) {
    if (resourceLimited || parseError) return;
    const open = text.indexOf("<![CDATA[", sourceCursor);
    if (open < 0) {
      parseError = new Error("CDATA source position unavailable");
      return;
    }
    const startOffset = open + 9;
    const close = text.indexOf("]]>", startOffset);
    if (close < 0) {
      parseError = new Error("Unterminated CDATA section");
      return;
    }
    appendText(stack[stack.length - 1], value, startOffset, close, "cdata");
    sourceCursor = close + 3;
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

function appendText(parent, value, startOffset, endOffset, kind) {
  if (endOffset < startOffset) return;
  const node = {
    nodeName: "#text",
    value,
    sourceCodeLocation: { startOffset, endOffset },
  };
  parent.childNodes.push(node);
  if (parent.tagName === "script") parent._scriptParts?.push({ kind, value, startOffset, endOffset });
}

function textEventEnd(text, startOffset, parserPosition) {
  const boundedPosition = Math.max(startOffset, Math.min(text.length, parserPosition));
  const markup = text.indexOf("<", startOffset);
  return markup >= 0 && markup < boundedPosition ? markup : boundedPosition;
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

function attributeValue(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
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

