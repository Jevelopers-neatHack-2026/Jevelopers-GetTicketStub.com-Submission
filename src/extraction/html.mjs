import { finished } from "node:stream/promises";
import { ParserStream } from "parse5-parser-stream";
import { performance } from "node:perf_hooks";
import { exactRange, normalizeCandidateValue, resolveUrlSuggestion, textCandidate } from "./source.mjs";

const HIDDEN_TAGS = new Set(["head", "script", "style", "template", "noscript", "title"]);
const OPEN_GRAPH_FIELDS = new Map([
  ["og:title", "name"],
  ["og:description", "description"],
  ["og:url", "url"],
  ["og:image", "image"],
  ["og:image:url", "image"],
  ["og:image:secure_url", "image"],
  ["og:type", "openGraphType"],
  ["og:site_name", "siteName"],
  ["og:locale", "locale"],
  ["article:published_time", "articlePublishedTime"],
  ["article:modified_time", "articleModifiedTime"],
  ["article:expiration_time", "articleExpirationTime"],
  ["article:section", "articleSection"],
  ["article:tag", "articleTag"],
]);
const STATUS_TEXT = /\b(cancel(?:led|ed|lation)?|postpon(?:ed|ement)?|reschedul(?:ed|e|ing)|new date|date changed|moved to)\b/i;
const ACCESS_TEXT = /\b(access denied|request blocked|you (?:have been|are) blocked|verify (?:that )?you are human|security challenge|unusual traffic|captcha)\b/i;
const JS_REQUIRED_TEXT = /\b(?:javascript|js) (?:is )?(?:required|disabled|not enabled)|enable (?:javascript|js) to continue\b/i;
const MOUNT_IDS = new Set(["root", "app", "__next", "__nuxt", "svelte"]);

export async function parseHtmlDocument(text, { signal, limits }) {
  const parseErrors = [];
  const parser = new ParserStream({
    sourceCodeLocationInfo: true,
    scriptingEnabled: false,
    onParseError(error) {
      if (parseErrors.length >= limits.maxHtmlParseErrors) return;
      parseErrors.push(Object.freeze({
        code: String(error.code),
        startOffset: Number.isInteger(error.startOffset) ? error.startOffset : null,
        endOffset: Number.isInteger(error.endOffset) ? error.endOffset : null,
      }));
    },
  });
  const completion = finished(parser).then(
    () => ({ ok: true }),
    () => ({ ok: false }),
  );
  const startedAt = performance.now();
  let offset = 0;

  while (offset < text.length) {
    if (signal?.aborted) {
      parser.destroy();
      await completion;
      return { ok: false, code: "CANCELED" };
    }
    if (performance.now() - startedAt > limits.parseTimeoutMs) {
      parser.destroy();
      await completion;
      return { ok: false, code: "PARSER_DEADLINE" };
    }

    let endOffset = Math.min(text.length, offset + limits.htmlChunkCodeUnits);
    if (endOffset < text.length) {
      const previous = text.charCodeAt(endOffset - 1);
      const next = text.charCodeAt(endOffset);
      if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        endOffset = endOffset - offset > 1 ? endOffset - 1 : endOffset + 1;
      }
    }

    try {
      await new Promise((resolve, reject) => {
        parser.write(text.slice(offset, endOffset), "utf8", (error) => error ? reject(error) : resolve());
      });
      await new Promise((resolve) => setImmediate(resolve));
    } catch {
      parser.destroy();
      await completion;
      return { ok: false, code: signal?.aborted ? "CANCELED" : "HTML_PARSER_FAILURE" };
    }
    offset = endOffset;
  }

  if (signal?.aborted) {
    parser.destroy();
    await completion;
    return { ok: false, code: "CANCELED" };
  }
  if (performance.now() - startedAt > limits.parseTimeoutMs) {
    parser.destroy();
    await completion;
    return { ok: false, code: "PARSER_DEADLINE" };
  }

  parser.end();
  const finishedResult = await completion;
  if (!finishedResult.ok) return { ok: false, code: "HTML_PARSER_FAILURE" };
  return { ok: true, document: parser.document, parseErrors };
}

export async function collectHtmlEvidence({
  document,
  htmlDocument,
  text,
  sourceBytes,
  byteOffsetMap,
  signal,
  limits,
  diagnostics,
}) {
  const canonicalSuggestions = [];
  const pageMetadata = [];
  const visibleText = [];
  const statusMentions = [];
  const accessSignals = [];
  const scriptBlocks = [];
  const jsRequiredSignals = [];
  let mountPointCount = 0;
  let scriptElementCount = 0;
  let nodeCount = 0;
  let visibleTextBytes = 0;
  let visibleCharacterCount = 0;
  let visibleTextTruncated = false;
  let metadataTruncated = false;
  let canonicalTruncated = false;
  let statusSignalsTruncated = false;
  let accessSignalsTruncated = false;
  let noscriptSignalsTruncated = false;

  const stack = [{ node: htmlDocument, hidden: false, insideNoscript: false, insideTemplate: false }];
  while (stack.length > 0) {
    if (signal?.aborted) return { canceled: true };
    if (nodeCount > 0 && nodeCount % limits.traversalYieldEvery === 0) {
      await new Promise((resolve) => setImmediate(resolve));
      if (signal?.aborted) return { canceled: true };
    }
    const current = stack.pop();
    const node = current.node;
    nodeCount += 1;
    if (nodeCount > limits.maxHtmlNodes) {
      addDiagnostic(diagnostics, limits, "HTML_NODE_LIMIT", null);
      return { resourceLimited: true };
    }

    const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
    const ownHidden = tagName !== "" && (HIDDEN_TAGS.has(tagName) || hasHiddenPresentation(node));
    const hidden = current.hidden || ownHidden;
    const insideNoscript = current.insideNoscript || tagName === "noscript";
    const insideTemplate = current.insideTemplate || tagName === "template";
    const location = node?.sourceCodeLocation;

    if (tagName === "link" && !insideTemplate) {
      const rel = attributeValue(node, "rel");
      if (rel && rel.toLowerCase().split(/\s+/).includes("canonical")) {
        const href = attributeValue(node, "href");
        const range = attributeValueRange(text, location, "href");
        if (href !== undefined && range) {
          const candidate = makeHtmlAttributeCandidate({
            field: "canonical.url",
            kind: "canonical",
            text,
            sourceBytes,
            byteOffsetMap,
            range,
            decodedValue: href,
            suggestionOnly: true,
          });
          if (candidate && canonicalSuggestions.length < limits.maxCanonicalSuggestions) {
            canonicalSuggestions.push(Object.freeze({
              ...candidate,
              urlSuggestion: resolveUrlSuggestion(href, document.url),
            }));
          } else if (candidate && !canonicalTruncated) {
            addDiagnostic(diagnostics, limits, "CANONICAL_SUGGESTION_LIMIT", null);
            canonicalTruncated = true;
          } else if (!candidate) {
            addDiagnostic(diagnostics, limits, "SOURCE_POSITION_UNAVAILABLE", null);
          }
        } else {
          addDiagnostic(diagnostics, limits, "CANONICAL_HREF_UNAVAILABLE", null);
        }
      }
    } else if (tagName === "meta" && !insideTemplate) {
      const property = (attributeValue(node, "property") ?? attributeValue(node, "name") ?? "").trim().toLowerCase();
      const field = OPEN_GRAPH_FIELDS.get(property);
      const content = attributeValue(node, "content");
      const range = attributeValueRange(text, location, "content");
      if (field && content !== undefined && range) {
        const candidate = makeHtmlAttributeCandidate({
          field: "openGraph." + field,
          kind: "open-graph",
          text,
          sourceBytes,
          byteOffsetMap,
          range,
          decodedValue: content,
          property,
          suggestionOnly: ["og:url", "og:image", "og:image:url", "og:image:secure_url"].includes(property),
        });
        if (candidate && pageMetadata.length < limits.maxPageMetadataCandidates) {
          pageMetadata.push(Object.freeze({
            ...candidate,
            property,
            ...(field === "url" || field === "image"
              ? { urlSuggestion: resolveUrlSuggestion(content, document.url) }
              : {}),
          }));
        } else if (candidate && !metadataTruncated) {
          addDiagnostic(diagnostics, limits, "PAGE_METADATA_LIMIT", null);
          metadataTruncated = true;
        } else if (!candidate) {
          addDiagnostic(diagnostics, limits, "SOURCE_POSITION_UNAVAILABLE", null);
        }
      }
    } else if (tagName === "script") {
      if (!insideTemplate && !current.insideNoscript) scriptElementCount += 1;
      const type = (attributeValue(node, "type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!insideTemplate && !current.insideNoscript && type === "application/ld+json") {
        const span = scriptContentSpan(location);
        if (span && scriptBlocks.length <= limits.maxJsonLdBlocks) scriptBlocks.push(Object.freeze(span));
        else if (!span) addDiagnostic(diagnostics, limits, "JSONLD_SCRIPT_POSITION_UNAVAILABLE", null);
      }
    }

    if (tagName === "noscript" && !current.hidden && !insideTemplate && !hasHiddenPresentation(node)) {
      if (jsRequiredSignals.length < limits.maxNoscriptSignals) {
        const signalCandidate = textInsideNoscript(node, text, sourceBytes, byteOffsetMap, limits);
        if (signalCandidate) jsRequiredSignals.push(signalCandidate);
      } else if (!noscriptSignalsTruncated) {
        addDiagnostic(diagnostics, limits, "NOSCRIPT_SIGNAL_LIMIT", null);
        noscriptSignalsTruncated = true;
      }
    }

    if (tagName !== "" && !hidden && hasMountPoint(node)) mountPointCount += 1;
    if (node?.nodeName === "#text" && !hidden && !insideNoscript
      && typeof node.value === "string" && node.value.trim() !== "") {
      const span = location && exactRange(text, sourceBytes, byteOffsetMap, location.startOffset, location.endOffset);
      const normalizedValue = normalizeCandidateValue(node.value);
      visibleCharacterCount += normalizedValue.length;
      const rawLength = span?.locator.endByte - span?.locator.startByte;
      if (!span) {
        addDiagnostic(diagnostics, limits, "VISIBLE_TEXT_POSITION_UNAVAILABLE", null);
      } else {
        const candidate = makeHtmlTextCandidate({
          field: "visibleText",
          text,
          sourceBytes,
          byteOffsetMap,
          startOffset: location.startOffset,
          endOffset: location.endOffset,
          normalizedValue,
        });
        if (candidate) {
          if (STATUS_TEXT.test(normalizedValue)) {
            if (statusMentions.length < limits.maxStatusSignalCandidates) statusMentions.push(candidate);
            else if (!statusSignalsTruncated) {
              addDiagnostic(diagnostics, limits, "STATUS_SIGNAL_LIMIT", null);
              statusSignalsTruncated = true;
            }
          }
          if (ACCESS_TEXT.test(normalizedValue)) {
            if (accessSignals.length < limits.maxStatusSignalCandidates) accessSignals.push(candidate);
            else if (!accessSignalsTruncated) {
              addDiagnostic(diagnostics, limits, "ACCESS_SIGNAL_LIMIT", null);
              accessSignalsTruncated = true;
            }
          }

          if (visibleText.length >= limits.maxVisibleTextSegments
            || visibleTextBytes + rawLength > limits.maxVisibleTextBytes) {
            if (!visibleTextTruncated) addDiagnostic(diagnostics, limits, "VISIBLE_TEXT_LIMIT", null);
            visibleTextTruncated = true;
          } else {
            visibleTextBytes += rawLength;
            visibleText.push(candidate);
          }
        }
      }
    }

    const children = Array.isArray(node?.childNodes) ? node.childNodes : [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], hidden, insideNoscript, insideTemplate });
    }
  }

  for (const signalCandidate of jsRequiredSignals) {
    if (JS_REQUIRED_TEXT.test(signalCandidate.normalizedValue)) {
      addDiagnostic(diagnostics, limits, "NOSCRIPT_REQUIRES_JAVASCRIPT", signalCandidate.source.locator);
    }
  }

  const shellSignals = mountPointCount > 0 && !hasMeaningfulPageEvidence(pageMetadata, canonicalSuggestions);
  const jsRequired = jsRequiredSignals.some((item) => JS_REQUIRED_TEXT.test(item.normalizedValue))
    || (scriptElementCount > 0 && shellSignals && visibleCharacterCount < limits.jsRequiredVisibleCharacterLimit);

  return {
    canonicalSuggestions,
    pageMetadata,
    visibleText,
    statusMentions,
    accessSignals,
    scriptBlocks,
    jsRequired,
    mountPointCount,
    visibleTextTruncated,
    nodeCount,
  };
}

function makeHtmlAttributeCandidate({
  field,
  kind,
  text,
  sourceBytes,
  byteOffsetMap,
  range,
  decodedValue,
  property,
  suggestionOnly,
}) {
  return textCandidate({
    field,
    kind,
    text,
    bytes: sourceBytes,
    byteOffsetMap,
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    normalizedValue: decodedValue,
    property,
    suggestionOnly,
  });
}

function makeHtmlTextCandidate({
  field,
  text,
  sourceBytes,
  byteOffsetMap,
  startOffset,
  endOffset,
  normalizedValue,
}) {
  return textCandidate({
    field,
    kind: "visible-text",
    text,
    bytes: sourceBytes,
    byteOffsetMap,
    startOffset,
    endOffset,
    normalizedValue,
  });
}

function attributeValue(node, name) {
  return node.attrs?.find((attribute) => attribute.name.toLowerCase() === name)?.value;
}

function attributeValueRange(text, elementLocation, attributeName) {
  const location = elementLocation?.attrs?.[attributeName];
  if (!location || !Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)) return null;
  const startOffset = location.startOffset;
  const raw = text.slice(startOffset, location.endOffset);
  let cursor = 0;
  while (cursor < raw.length && !/[\s=/>]/.test(raw[cursor])) cursor += 1;
  if (raw.slice(0, cursor).toLowerCase() !== attributeName.toLowerCase()) return null;
  while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  if (raw[cursor] !== "=") return { startOffset: location.endOffset, endOffset: location.endOffset };
  cursor += 1;
  while (/\s/.test(raw[cursor] ?? "")) cursor += 1;
  const quote = raw[cursor] === '"' || raw[cursor] === "'" ? raw[cursor] : null;
  if (quote !== null) {
    cursor += 1;
    const valueStart = cursor;
    while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
    if (cursor >= raw.length) return null;
    return { startOffset: startOffset + valueStart, endOffset: startOffset + cursor };
  }
  const valueStart = cursor;
  while (cursor < raw.length && !/[\s>]/.test(raw[cursor])) cursor += 1;
  return { startOffset: startOffset + valueStart, endOffset: startOffset + cursor };
}

function scriptContentSpan(location) {
  if (!location?.startTag || !Number.isInteger(location.startTag.endOffset)) return null;
  const startOffset = location.startTag.endOffset;
  const endOffset = Number.isInteger(location.endTag?.startOffset)
    ? location.endTag.startOffset
    : location.endOffset;
  if (!Number.isInteger(endOffset) || endOffset < startOffset) return null;
  return { startOffset, endOffset };
}

function hasHiddenPresentation(node) {
  const attrs = node.attrs ?? [];
  if (attrs.some((attribute) => attribute.name === "hidden" || attribute.name === "inert"
    || (attribute.name === "aria-hidden" && attribute.value.trim().toLowerCase() === "true"))) return true;
  const style = attributeValue(node, "style");
  if (typeof style !== "string") return false;
  for (const declaration of style.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).replace(/!\s*important\s*$/i, "").trim().toLowerCase();
    if (property === "display" && value === "none") return true;
    if (property === "visibility" && (value === "hidden" || value === "collapse")) return true;
    if (property === "content-visibility" && value === "hidden") return true;
    if (property === "opacity" && /^0(?:\.0+)?$/.test(value)) return true;
  }
  return false;
}

function hasMountPoint(node) {
  const id = attributeValue(node, "id")?.trim().toLowerCase();
  if (id && MOUNT_IDS.has(id)) return true;
  return (node.attrs ?? []).some((attribute) => (
    attribute.name === "data-reactroot"
    || attribute.name === "ng-app"
    || attribute.name === "data-v-app"
    || attribute.name === "data-sveltekit-preload-data"
  ));
}

function textInsideNoscript(node, text, sourceBytes, byteOffsetMap, limits) {
  const pieces = [];
  const stack = (Array.isArray(node.childNodes) ? node.childNodes : []).map((child) => ({ node: child, hidden: false }));
  let visited = 0;
  while (stack.length > 0 && visited < limits.maxNoscriptNodes) {
    const current = stack.pop();
    visited += 1;
    const child = current.node;
    const tagName = typeof child?.tagName === "string" ? child.tagName.toLowerCase() : "";
    const hidden = current.hidden || (tagName !== "" && (HIDDEN_TAGS.has(tagName) || hasHiddenPresentation(child)));
    if (child?.nodeName === "#text" && !hidden && typeof child.value === "string") pieces.push(child.value);
    if (hidden) continue;
    for (const descendant of child?.childNodes ?? []) stack.push({ node: descendant, hidden });
  }
  if (stack.length > 0) return null;
  const value = normalizeCandidateValue(pieces.join(" "));
  if (value === "") return null;
  const location = node.sourceCodeLocation;
  if (!location || !Number.isInteger(location.startOffset) || !Number.isInteger(location.endOffset)) return null;
  return textCandidate({
    field: "accessLimitation.javascriptRequirementCopy",
    kind: "noscript-signal",
    text,
    bytes: sourceBytes,
    byteOffsetMap,
    startOffset: location.startOffset,
    endOffset: location.endOffset,
    normalizedValue: value,
    suggestionOnly: true,
  });
}

function hasMeaningfulPageEvidence(pageMetadata, canonicalSuggestions) {
  return pageMetadata.length > 0 || canonicalSuggestions.length > 0;
}

function addDiagnostic(diagnostics, limits, code, locator) {
  if (diagnostics.length >= limits.maxDiagnostics) return;
  diagnostics.push(Object.freeze({ code, ...(locator ? { locator } : {}) }));
}
