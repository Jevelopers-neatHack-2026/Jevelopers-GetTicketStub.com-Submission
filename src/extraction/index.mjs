import { collectHtmlEvidence, declaredCharsetFromHtmlDocument, parseHtmlDocument } from "./html.mjs";
import { extractJsonLdEntities } from "./jsonld.mjs";
import { parseXhtmlDocument, xhtmlXmlDeclarationEncodingFromBytes } from "./xhtml.mjs";
import {
  createByteOffsetMap,
  declaredCharset,
  decodeUtf8,
  exactRange,
  isHttpDocumentUrl,
  readRetrievedDocument,
  sha256,
  sourceFromDocument,
  textCandidate,
} from "./source.mjs";

export const DETERMINISTIC_EXTRACTION_VERSION = "ei-deterministic-extraction/1.3.0";

export const EXTRACTION_LIMITS = Object.freeze({
  maxDocumentBytes: 2 * 1024 * 1024,
  maxHtmlNodes: 100_000,
  maxHtmlParseErrors: 32,
  htmlChunkCodeUnits: 16 * 1024,
  parseTimeoutMs: 2_500,
  traversalYieldEvery: 256,
  maxVisibleTextSegments: 4_000,
  maxVisibleTextBytes: 512 * 1024,
  maxStatusSignalCandidates: 128,
  maxPageMetadataCandidates: 1_000,
  maxAssetSources: 128,
  maxCanonicalSuggestions: 256,
  maxNoscriptNodes: 1_024,
  maxNoscriptSignals: 64,
  jsRequiredVisibleCharacterLimit: 120,
  maxJsonLdBlocks: 32,
  maxJsonLdBytes: 512 * 1024,
  maxJsonDepth: 64,
  maxJsonNodes: 30_000,
  maxEntities: 128,
  maxCandidatesPerEntity: 256,
  maxDiagnostics: 128,
});

const TEXT_TYPES = new Set(["text/html", "application/xhtml+xml", "text/plain"]);
const JSON_LD_TYPE = "application/ld+json";
const UTF8_CHARSETS = new Set(["utf-8", "utf8"]);
const JSON_PARSER_VERSION = `node@${process.versions.node}/JSON.parse+ei-json-index@1`;

export async function extractDeterministically(documentInput, options = {}) {
  const diagnostics = [];
  const document = readRetrievedDocument(documentInput);
  const limits = resolveLimits(options?.limits);
  const signal = options?.signal;

  if (!document) {
    return emptyResult({
      status: "INVALID_INPUT",
      source: null,
      sourceHash: null,
      diagnostics: [{ code: "INVALID_RETRIEVED_DOCUMENT" }],
    });
  }
  if (!isHttpDocumentUrl(document.url)) {
    return emptyResult({
      status: "INVALID_INPUT",
      source: null,
      sourceHash: null,
      diagnostics: [{ code: "SOURCE_URL_MUST_BE_HTTP" }],
    });
  }
  if (signal?.aborted) {
    const hash = document.bytes.byteLength <= limits.maxDocumentBytes ? sha256(document.bytes) : null;
    return emptyResult({
      status: "CANCELED",
      source: sourceFromDocument(document, hash),
      sourceHash: hash,
      diagnostics: [{ code: "CANCELED_BEFORE_EXTRACTION" }],
      termination: "CANCELED",
    });
  }

  if (document.bytes.byteLength > limits.maxDocumentBytes) {
    return emptyResult({
      status: "RESOURCE_LIMIT",
      source: sourceFromDocument(document, null),
      sourceHash: null,
      diagnostics: [{ code: "DOCUMENT_BYTE_LIMIT", limit: limits.maxDocumentBytes }],
      termination: "RESOURCE_LIMIT",
    });
  }

  const bytes = Buffer.from(document.bytes);
  const sourceHash = sha256(bytes);
  const source = sourceFromDocument(document, sourceHash);
  const contentType = document.contentType.split(";", 1)[0].trim().toLowerCase();
  if (!TEXT_TYPES.has(contentType) && contentType !== JSON_LD_TYPE) {
    return emptyResult({
      status: "UNSUPPORTED_MEDIA",
      source,
      sourceHash,
      diagnostics: [{ code: "UNSUPPORTED_CONTENT_TYPE" }],
    });
  }

  const headerCharset = declaredCharset(document.contentType);
  if (headerCharset && !UTF8_CHARSETS.has(headerCharset)) {
    return emptyResult({
      status: "UNSUPPORTED_ENCODING",
      source,
      sourceHash,
      diagnostics: [{ code: "UNSUPPORTED_CHARSET", charset: headerCharset }],
    });
  }

  const decoded = decodeUtf8(bytes);
  if (!decoded.ok) {
    if (!headerCharset && contentType === "text/html") {
      const scanned = await scanHtmlCharsetFromBytes(bytes, signal, limits);
      if (scanned.code === "CANCELED") {
        return emptyResult({ status: "CANCELED", source, sourceHash, diagnostics: [{ code: "CANCELED_DURING_CHARSET_SCAN" }], termination: "CANCELED" });
      }
      if (scanned.code === "PARSER_DEADLINE") {
        return emptyResult({ status: "RESOURCE_LIMIT", source, sourceHash, diagnostics: [{ code: "PARSER_DEADLINE" }], termination: "PARSER_DEADLINE" });
      }
      if (scanned.charset && !UTF8_CHARSETS.has(scanned.charset)) {
        return emptyResult({
          status: "UNSUPPORTED_ENCODING",
          source,
          sourceHash,
          diagnostics: [{ code: "UNSUPPORTED_CHARSET", charset: scanned.charset }],
        });
      }
    } else if (!headerCharset && contentType === "application/xhtml+xml") {
      const xmlCharset = xhtmlXmlDeclarationEncodingFromBytes(bytes);
      if (xmlCharset && !UTF8_CHARSETS.has(xmlCharset)) {
        return emptyResult({
          status: "UNSUPPORTED_ENCODING",
          source,
          sourceHash,
          diagnostics: [{ code: "UNSUPPORTED_CHARSET", charset: xmlCharset }],
        });
      }
    }
    return emptyResult({
      status: "MALFORMED_ENCODING",
      source,
      sourceHash,
      diagnostics: [{ code: "MALFORMED_UTF8" }],
    });
  }
  const text = decoded.text;
  const byteOffsetMap = createByteOffsetMap(text, bytes.length);
  if (!byteOffsetMap) {
    return emptyResult({
      status: "MALFORMED_ENCODING",
      source,
      sourceHash,
      diagnostics: [{ code: "SOURCE_POSITION_MAPPING_FAILED" }],
    });
  }

  const state = {
    source,
    sourceHash,
    headerCharset,
    bytes,
    text,
    byteOffsetMap,
    limits,
    diagnostics,
    canonicalSuggestions: [],
    pageMetadata: [],
    assetSources: [],
    assetSourcesTruncated: false,
    visibleText: [],
    statusMentions: [],
    accessSignals: [],
    events: [],
    organizations: [],
    jsonLdBlocks: [],
    ambiguities: [],
    conflicts: [],
    termination: null,
    forcedStatus: null,
    jsRequired: false,
    visibleTextTruncated: false,
  };

  if (contentType === "text/plain") {
    collectPlainText(state);
  } else if (contentType === JSON_LD_TYPE) {
    await collectStandaloneJsonLd(state, signal);
  } else {
    await collectHtml(state, signal, contentType);
  }

  if (signal?.aborted && state.termination === null) {
    state.termination = "CANCELED";
    addDiagnostic(state, "CANCELED_DURING_EXTRACTION");
  }

  state.conflicts = detectConflicts(state.events, state.organizations, state.pageMetadata, state.diagnostics, limits);
  if (state.events.length > 1) {
    state.ambiguities.push(Object.freeze({
      kind: "multiple_event_occurrences",
      entityIds: Object.freeze(state.events.map((event) => event.entityId)),
      resolution: "kept_separate",
    }));
    if (state.pageMetadata.length > 0) {
      state.ambiguities.push(Object.freeze({
        kind: "page_metadata_not_assigned_to_event",
        candidateCount: state.pageMetadata.length,
      }));
    }
  }

  const answerEvidenceCount = state.events.length + state.organizations.length
    + state.pageMetadata.length + state.visibleText.length + state.statusMentions.length;
  let status;
  if (state.forcedStatus) status = state.forcedStatus;
  else if (state.accessSignals.length > 0) status = "ACCESS_RESTRICTED";
  else if (state.termination === "CANCELED") status = "CANCELED";
  else if ((state.termination === "RESOURCE_LIMIT" || state.termination === "PARSER_DEADLINE")
    && answerEvidenceCount === 0) status = "RESOURCE_LIMIT";
  else if (state.jsRequired && state.events.length === 0 && state.organizations.length === 0
    && state.pageMetadata.length === 0 && state.statusMentions.length === 0
    && state.visibleText.length <= 1) status = "JS_REQUIRED";
  else if (answerEvidenceCount === 0 && state.termination === null) status = "NO_ANSWER";
  else status = "PARTIAL";

  if (answerEvidenceCount === 0 && state.termination === null && status === "NO_ANSWER") {
    addDiagnostic(state, "NO_EVENT_CANDIDATES");
  }

  return Object.freeze({
    extractorVersion: DETERMINISTIC_EXTRACTION_VERSION,
    parserVersions: Object.freeze({
      html: "parse5@8.0.1",
      htmlStream: "parse5-parser-stream@8.0.0",
      xml: "sax@1.6.1",
      json: JSON_PARSER_VERSION,
    }),
    status,
    termination: state.termination,
    source,
    sourceHash,
    canonicalSuggestions: Object.freeze(state.canonicalSuggestions),
    pageMetadata: Object.freeze(state.pageMetadata),
    assetSources: Object.freeze(state.assetSources),
    assetSourcesTruncated: state.assetSourcesTruncated,
    events: Object.freeze(state.events),
    organizations: Object.freeze(state.organizations),
    visibleText: Object.freeze(state.visibleText),
    statusMentions: Object.freeze(state.statusMentions),
    accessSignals: Object.freeze(state.accessSignals),
    conflicts: Object.freeze(state.conflicts),
    ambiguities: Object.freeze(state.ambiguities),
    jsonLdBlocks: Object.freeze(state.jsonLdBlocks),
    diagnostics: Object.freeze(state.diagnostics),
  });
}

async function collectHtml(state, signal, contentType) {
  const parsed = contentType === "text/html"
    ? await parseHtmlDocument(state.text, { signal, limits: state.limits })
    : await parseXhtmlDocument(state.text, { signal, limits: state.limits });
  if (!parsed.ok) {
    state.termination = parsed.code === "CANCELED" ? "CANCELED"
      : parsed.code === "PARSER_DEADLINE" ? "PARSER_DEADLINE"
        : (parsed.code === "HTML_NODE_LIMIT" || parsed.code === "XHTML_TOKEN_BUFFER_LIMIT") ? "RESOURCE_LIMIT"
          : parsed.code === "HTML_PARSER_FAILURE" ? null : null;
    if (parsed.code === "XHTML_TOKEN_BUFFER_LIMIT") {
      addDiagnostic(state, parsed.code, { bufferName: parsed.bufferName, limit: parsed.limit });
    } else {
      addDiagnostic(state, parsed.code);
    }
    return;
  }

  const declaredDocumentCharset = state.headerCharset ?? (contentType === "text/html"
    ? declaredCharsetFromHtmlDocument(parsed.document, state.byteOffsetMap)
    : parsed.xmlEncoding?.toLowerCase() ?? null);
  if (declaredDocumentCharset && !UTF8_CHARSETS.has(declaredDocumentCharset)) {
    state.forcedStatus = "UNSUPPORTED_ENCODING";
    addDiagnostic(state, "UNSUPPORTED_CHARSET", { charset: declaredDocumentCharset });
    return;
  }

  for (const error of parsed.parseErrors ?? []) {
    const exact = Number.isInteger(error.startOffset) && Number.isInteger(error.endOffset)
      ? exactRange(state.text, state.bytes, state.byteOffsetMap, error.startOffset, error.endOffset)
      : null;
    addDiagnostic(state, "HTML_RECOVERED_PARSE_ERROR", {
      htmlCode: error.code,
      ...(exact ? { locator: exact.locator } : {}),
    });
  }

  const html = await collectHtmlEvidence({
    document: { url: state.source.url },
    htmlDocument: parsed.document,
    text: state.text,
    sourceBytes: state.bytes,
    byteOffsetMap: state.byteOffsetMap,
    signal,
    limits: state.limits,
    diagnostics: state.diagnostics,
  });
  if (html.canceled) {
    state.termination = "CANCELED";
    addDiagnostic(state, "CANCELED_DURING_HTML_TRAVERSAL");
    return;
  }
  if (!Array.isArray(html.scriptBlocks)) {
    state.termination = "RESOURCE_LIMIT";
    return;
  }
  state.canonicalSuggestions = html.canonicalSuggestions;
  state.pageMetadata = html.pageMetadata;
  state.assetSources = html.assetSources;
  state.assetSourcesTruncated = html.assetSourcesTruncated;
  state.visibleText = html.visibleText;
  state.statusMentions = html.statusMentions;
  state.accessSignals = html.accessSignals;
  state.jsRequired = html.jsRequired;
  state.visibleTextTruncated = html.visibleTextTruncated;
  if (html.resourceLimited) state.termination = "RESOURCE_LIMIT";

  const seenBlocks = new Map();
  for (let index = 0; index < html.scriptBlocks.length; index += 1) {
    if (signal?.aborted) {
      state.termination = "CANCELED";
      addDiagnostic(state, "CANCELED_DURING_JSONLD");
      return;
    }
    if (index >= state.limits.maxJsonLdBlocks) {
      state.termination = "RESOURCE_LIMIT";
      addDiagnostic(state, "JSONLD_BLOCK_LIMIT", { limit: state.limits.maxJsonLdBlocks });
      return;
    }

    const block = html.scriptBlocks[index];
    const exactBlock = exactRange(state.text, state.bytes, state.byteOffsetMap, block.startOffset, block.endOffset);
    if (!exactBlock) {
      addDiagnostic(state, "JSONLD_SCRIPT_POSITION_UNAVAILABLE");
      continue;
    }
    if (exactBlock.locator.endByte - exactBlock.locator.startByte > state.limits.maxJsonLdBytes) {
      addDiagnostic(state, "JSONLD_BYTE_LIMIT", { locator: exactBlock.locator, limit: state.limits.maxJsonLdBytes });
      state.termination = "RESOURCE_LIMIT";
      state.jsonLdBlocks.push(Object.freeze({ blockIndex: index, status: "resource_limited", locator: exactBlock.locator }));
      continue;
    }
    if (block.jsonResourceLimited === true) {
      addDiagnostic(state, "JSONLD_SOURCE_MAP_LIMIT", { blockIndex: index, locator: exactBlock.locator });
      state.termination = "RESOURCE_LIMIT";
      state.jsonLdBlocks.push(Object.freeze({ blockIndex: index, status: "resource_limited", locator: exactBlock.locator }));
      continue;
    }

    const blockDigest = sha256(Buffer.from(exactBlock.rawValue, "utf8"));
    const duplicateOfBlockIndex = seenBlocks.get(blockDigest);
    if (duplicateOfBlockIndex !== undefined) {
      addDiagnostic(state, "DUPLICATE_JSONLD_BLOCK", {
        blockIndex: index,
        duplicateOfBlockIndex,
        locator: exactBlock.locator,
      });
    } else {
      seenBlocks.set(blockDigest, index);
    }

    let jsonText = typeof block.jsonText === "string" ? block.jsonText : exactBlock.rawValue;
    let jsonStartOffset = typeof block.jsonText === "string" ? 0 : block.startOffset;
    let jsonSourceSegments = block.jsonSourceSegments;
    if (jsonText.startsWith("\uFEFF")) {
      jsonText = jsonText.slice(1);
      if (Array.isArray(jsonSourceSegments)) jsonSourceSegments = trimJsonSourceSegments(jsonSourceSegments, 1);
      else jsonStartOffset += 1;
    }
    const extracted = extractJsonLdEntities({
      source: state.text,
      sourceBytes: state.bytes,
      byteOffsetMap: state.byteOffsetMap,
      jsonText,
      jsonStartOffset,
      jsonSourceSegments,
      blockIndex: index,
      limits: {
        ...state.limits,
        maxEntities: Math.max(0, state.limits.maxEntities - state.events.length - state.organizations.length),
      },
    });
    if (!extracted.ok) {
      addDiagnostic(state, extracted.code, { blockIndex: index, locator: exactBlock.locator });
      const resourceFailure = extracted.code === "JSON_DEPTH_LIMIT" || extracted.code === "JSON_NODE_LIMIT";
      if (resourceFailure) state.termination = "RESOURCE_LIMIT";
      state.jsonLdBlocks.push(Object.freeze({
        blockIndex: index,
        status: resourceFailure ? "resource_limited" : "malformed",
        locator: exactBlock.locator,
        ...(duplicateOfBlockIndex !== undefined ? { duplicateOfBlockIndex } : {}),
      }));
      continue;
    }
    state.events.push(...extracted.entities);
    state.organizations.push(...extracted.organizations);
    const knownOrganizationAssetLocators = jsonLdAssetLocatorKeys(extracted.organizations, "organization");
    appendJsonLdAssetSources(state, extracted.organizations, "organization");
    appendJsonLdAssetSources(state, extracted.entities, "event", knownOrganizationAssetLocators);
    if (extracted.truncated) {
      state.termination = "RESOURCE_LIMIT";
      addDiagnostic(state, "JSONLD_ENTITY_LIMIT", { blockIndex: index });
    }
    if (extracted.candidateTruncated) {
      state.termination = "RESOURCE_LIMIT";
      addDiagnostic(state, "JSONLD_CANDIDATE_LIMIT", { blockIndex: index });
    }
    state.jsonLdBlocks.push(Object.freeze({
      blockIndex: index,
      status: extracted.truncated || extracted.candidateTruncated ? "resource_limited"
        : duplicateOfBlockIndex === undefined ? "parsed" : "duplicate_parsed",
      locator: exactBlock.locator,
      eventCount: extracted.entities.length,
      organizationCount: extracted.organizations.length,
      ...(duplicateOfBlockIndex !== undefined ? { duplicateOfBlockIndex } : {}),
    }));
  }
}

function trimJsonSourceSegments(segments, removedCodeUnits) {
  const trimmed = [];
  for (const segment of segments) {
    if (segment.logicalEnd <= removedCodeUnits) continue;
    const removedFromSegment = Math.max(0, removedCodeUnits - segment.logicalStart);
    if (removedFromSegment > 0 && !segment.linear) continue;
    const logicalStart = Math.max(segment.logicalStart, removedCodeUnits) - removedCodeUnits;
    trimmed.push({
      ...segment,
      logicalStart,
      logicalEnd: segment.logicalEnd - removedCodeUnits,
      sourceStart: segment.sourceStart + removedFromSegment,
    });
  }
  return trimmed;
}

async function scanHtmlCharsetFromBytes(bytes, signal, limits) {
  const prefix = bytes.subarray(0, Math.min(bytes.length, 2048)).toString("latin1");
  const parsed = await parseHtmlDocument(prefix, { signal, limits });
  if (!parsed.ok) return { charset: null, code: parsed.code };
  return { charset: declaredCharsetFromHtmlDocument(parsed.document, null, 2048), code: null };
}

async function collectStandaloneJsonLd(state, signal) {
  if (signal?.aborted) {
    state.termination = "CANCELED";
    addDiagnostic(state, "CANCELED_BEFORE_JSONLD");
    return;
  }
  let jsonText = state.text;
  let jsonStartOffset = 0;
  if (jsonText.startsWith("\uFEFF")) {
    jsonText = jsonText.slice(1);
    jsonStartOffset = 1;
  }
  if (state.bytes.length > state.limits.maxJsonLdBytes) {
    state.termination = "RESOURCE_LIMIT";
    addDiagnostic(state, "JSONLD_BYTE_LIMIT", { limit: state.limits.maxJsonLdBytes });
    state.jsonLdBlocks.push(Object.freeze({
      blockIndex: 0,
      status: "resource_limited",
      locator: Object.freeze({ kind: "text-range", startByte: 0, endByte: state.bytes.length }),
    }));
    return;
  }
  const extracted = extractJsonLdEntities({
    source: state.text,
    sourceBytes: state.bytes,
    byteOffsetMap: state.byteOffsetMap,
    jsonText,
    jsonStartOffset,
    blockIndex: 0,
    limits: state.limits,
  });
  if (!extracted.ok) {
    addDiagnostic(state, extracted.code, { locator: { kind: "text-range", startByte: 0, endByte: state.bytes.length } });
    const resourceFailure = extracted.code === "JSON_DEPTH_LIMIT" || extracted.code === "JSON_NODE_LIMIT";
    if (resourceFailure) state.termination = "RESOURCE_LIMIT";
    state.jsonLdBlocks.push(Object.freeze({
      blockIndex: 0,
      status: resourceFailure ? "resource_limited" : "malformed",
      locator: Object.freeze({ kind: "text-range", startByte: 0, endByte: state.bytes.length }),
    }));
    return;
  }
  state.events.push(...extracted.entities);
  state.organizations.push(...extracted.organizations);
  const knownOrganizationAssetLocators = jsonLdAssetLocatorKeys(extracted.organizations, "organization");
  appendJsonLdAssetSources(state, extracted.organizations, "organization");
  appendJsonLdAssetSources(state, extracted.entities, "event", knownOrganizationAssetLocators);
  if (extracted.truncated || extracted.candidateTruncated) state.termination = "RESOURCE_LIMIT";
  state.jsonLdBlocks.push(Object.freeze({
    blockIndex: 0,
    status: extracted.truncated || extracted.candidateTruncated ? "resource_limited" : "parsed",
    locator: Object.freeze({ kind: "text-range", startByte: 0, endByte: state.bytes.length }),
    eventCount: extracted.entities.length,
    organizationCount: extracted.organizations.length,
  }));
  if (extracted.truncated) addDiagnostic(state, "JSONLD_ENTITY_LIMIT", { blockIndex: 0 });
  if (extracted.candidateTruncated) addDiagnostic(state, "JSONLD_CANDIDATE_LIMIT", { blockIndex: 0 });
}

function jsonLdAssetLocatorKeys(entities, entityKind) {
  const keys = new Set();
  for (const entity of entities) {
    for (const candidate of entity.candidates) {
      if (!jsonLdAssetCandidateShape(candidate, entityKind, entity.jsonPointer)) continue;
      const locator = candidate.source?.locator;
      if (locator?.kind === "text-range") keys.add(`${locator.startByte}:${locator.endByte}`);
    }
  }
  return keys;
}

function jsonPointerParts(pointer) {
  if (typeof pointer !== "string" || (pointer !== "" && !pointer.startsWith("/")) || /~(?![01])/.test(pointer)) return null;
  if (pointer === "") return [];
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function isArrayIndex(value) {
  return /^(?:0|[1-9][0-9]*)$/.test(value);
}

function jsonLdAssetPath(parts, start = 0) {
  let cursor = start;
  while (isArrayIndex(parts[cursor] ?? "")) cursor += 1;
  const family = parts[cursor]?.toLowerCase();
  if (family !== "image" && family !== "logo") return null;
  cursor += 1;
  if (cursor === parts.length) return { family };

  // Arrays of strings and arrays of ImageObject are both represented by actual
  // numeric pointer segments. Do not use the flattened display field here: a
  // JSON key such as "organizer.logo" is one pointer segment, not two.
  while (isArrayIndex(parts[cursor] ?? "")) cursor += 1;
  if (cursor === parts.length) return { family };
  const leaf = parts[cursor]?.toLowerCase();
  if (["url", "contenturl", "@id"].includes(leaf) && cursor + 1 === parts.length) return { family };
  return null;
}

function jsonLdAssetCandidateShape(candidate, entityKind, entityPointer) {
  if (typeof candidate.normalizedValue !== "string") return null;
  const entityParts = jsonPointerParts(entityPointer);
  const candidateParts = jsonPointerParts(candidate.source?.jsonPointer);
  if (!entityParts || !candidateParts || candidateParts.length <= entityParts.length
    || entityParts.some((part, index) => candidateParts[index] !== part)) return null;
  const relative = candidateParts.slice(entityParts.length);
  let shape = jsonLdAssetPath(relative);
  let nestedOrganizer = false;
  if (!shape && entityKind === "event") {
    let organizerIndex = 0;
    while (isArrayIndex(relative[organizerIndex] ?? "")) organizerIndex += 1;
    if (relative[organizerIndex]?.toLowerCase() === "organizer") {
      shape = jsonLdAssetPath(relative, organizerIndex + 1);
      nestedOrganizer = shape !== null;
    }
  }
  return shape ? { ...shape, nestedOrganizer } : null;
}

function appendJsonLdAssetSources(state, entities, entityKind, knownOrganizationAssetLocators = new Set()) {
  for (const entity of entities) {
    for (const candidate of entity.candidates) {
      const shape = jsonLdAssetCandidateShape(candidate, entityKind, entity.jsonPointer);
      if (!shape) continue;
      const { family, nestedOrganizer } = shape;
      const locator = candidate.source?.locator;
      if (nestedOrganizer && locator?.kind === "text-range"
        && knownOrganizationAssetLocators.has(`${locator.startByte}:${locator.endByte}`)) continue;
      if (state.assetSources.length >= state.limits.maxAssetSources) {
        if (!state.assetSourcesTruncated) {
          state.assetSourcesTruncated = true;
          state.termination = "RESOURCE_LIMIT";
          addDiagnostic(state, "ASSET_SOURCE_LIMIT", { limit: state.limits.maxAssetSources });
        }
        return;
      }
      state.assetSources.push(Object.freeze({
        candidate,
        sourceForm: family === "logo" ? "jsonld-logo" : "jsonld-image",
        association: nestedOrganizer
          ? Object.freeze({
            kind: "nested-entity-source-claim",
            parentEntityKind: "event",
            parentEntityId: entity.entityId,
            roleHint: "organizer",
            parentPointer: entity.jsonPointer,
            assetPointer: candidate.source?.jsonPointer ?? "",
          })
          : Object.freeze({
            kind: "entity-source-claim",
            entityKind,
            entityId: entity.entityId,
            blockIndex: entity.blockIndex,
            entityPointer: entity.jsonPointer,
            assetPointer: candidate.source?.jsonPointer ?? "",
          }),
      }));
    }
  }
}

function collectPlainText(state) {
  if (state.text.trim() === "") {
    addDiagnostic(state, "EMPTY_DOCUMENT");
    return;
  }
  const truncated = state.bytes.length > state.limits.maxVisibleTextBytes || state.limits.maxVisibleTextSegments === 0;
  let endOffset = state.text.length;
  if (state.bytes.length > state.limits.maxVisibleTextBytes) {
    endOffset = 0;
    for (let index = 0; index < state.byteOffsetMap.length; index += 1) {
      const byteOffset = state.byteOffsetMap[index];
      if (byteOffset === 0xffff_ffff) continue;
      if (byteOffset > state.limits.maxVisibleTextBytes) break;
      endOffset = index;
    }
  }
  const candidate = endOffset > 0 && state.limits.maxVisibleTextSegments > 0
    ? textCandidate({
      field: "visibleText",
      kind: "visible-text",
      text: state.text,
      bytes: state.bytes,
      byteOffsetMap: state.byteOffsetMap,
      startOffset: 0,
      endOffset,
      normalizedValue: state.text.slice(0, endOffset).replace(/^\uFEFF/, ""),
    })
    : null;
  if (candidate && typeof candidate.normalizedValue === "string" && candidate.normalizedValue !== "") {
    state.visibleText.push(candidate);
  }
  if (truncated) {
    state.termination = "RESOURCE_LIMIT";
    state.visibleTextTruncated = true;
    addDiagnostic(state, "VISIBLE_TEXT_LIMIT", { limit: state.limits.maxVisibleTextBytes });
  }
  const wholeDocumentCandidate = textCandidate({
    field: "visibleText",
    kind: "visible-text",
    text: state.text,
    bytes: state.bytes,
    byteOffsetMap: state.byteOffsetMap,
    startOffset: 0,
    endOffset: state.text.length,
    normalizedValue: state.text.replace(/^\uFEFF/, ""),
  });
  if (!wholeDocumentCandidate) return;
  appendPlainTextSignal(
    state,
    wholeDocumentCandidate,
    state.statusMentions,
    /\b(cancel(?:led|ed|lation)?|postpon(?:ed|ement)?|reschedul(?:ed|e|ing)|new date|date changed|moved to)\b/i,
    "STATUS_SIGNAL_LIMIT",
  );
  appendPlainTextSignal(
    state,
    wholeDocumentCandidate,
    state.accessSignals,
    /\b(access denied|request blocked|you (?:have been|are) blocked|verify (?:that )?you are human|security challenge|unusual traffic|captcha)\b/i,
    "ACCESS_SIGNAL_LIMIT",
  );
}

function appendPlainTextSignal(state, candidate, target, pattern, limitCode) {
  if (!pattern.test(candidate.normalizedValue)) return;
  if (target.length < state.limits.maxStatusSignalCandidates) {
    target.push(candidate);
  } else {
    state.termination = "RESOURCE_LIMIT";
    addDiagnostic(state, limitCode);
  }
}

function detectConflicts(events, organizations, pageMetadata, diagnostics, limits) {
  const conflicts = [];
  for (const event of events) {
    const candidates = [...event.candidates];
    if (events.length === 1) {
      for (const metadata of pageMetadata) {
        const mappedField = eventFieldForOpenGraph(metadata.property);
        if (mappedField) candidates.push({ ...metadata, field: mappedField });
      }
    }
    appendConflicts(conflicts, event.entityId, candidates, limits.maxDiagnostics);
  }
  for (const organization of organizations) {
    appendConflicts(conflicts, organization.entityId, organization.candidates, limits.maxDiagnostics);
  }
  appendConflicts(conflicts, "page", pageMetadata, limits.maxDiagnostics);
  if (events.length > 1 && pageMetadata.some((metadata) => eventFieldForOpenGraph(metadata.property))) {
    if (diagnostics.length < limits.maxDiagnostics) {
      diagnostics.push(Object.freeze({ code: "PAGE_METADATA_NOT_ASSIGNED_TO_MULTIPLE_EVENTS" }));
    }
  }
  return conflicts;
}

function appendConflicts(output, scope, candidates, maximum) {
  const fields = new Map();
  for (const candidate of candidates) {
    if (!fields.has(candidate.field)) fields.set(candidate.field, []);
    fields.get(candidate.field).push(candidate);
  }
  for (const [field, values] of fields) {
    const distinct = new Map(values.map((candidate) => [stableValue(candidate.normalizedValue), candidate]));
    if (distinct.size < 2 || output.length >= maximum) continue;
    output.push(Object.freeze({
      scope,
      field,
      candidates: Object.freeze([...distinct.values()]),
    }));
  }
}

function eventFieldForOpenGraph(property) {
  if (property === "og:title") return "name";
  if (property === "og:description") return "description";
  if (property === "og:url") return "url";
  if (["og:image", "og:image:url", "og:image:secure_url"].includes(property)) return "image";
  return null;
}

function stableValue(value) {
  if (value === null) return "null";
  if (typeof value === "string") return "string:" + value;
  if (typeof value === "number") return "number:" + String(value);
  if (typeof value === "boolean") return "boolean:" + String(value);
  return typeof value + ":" + String(value);
}

function resolveLimits(requested) {
  const limits = {};
  for (const [key, maximum] of Object.entries(EXTRACTION_LIMITS)) {
    const value = requested && typeof requested === "object" ? requested[key] : undefined;
    const minimum = key === "htmlChunkCodeUnits" || key === "traversalYieldEvery" ? 1 : 0;
    limits[key] = Number.isSafeInteger(value) && value >= 0 ? Math.max(minimum, Math.min(value, maximum)) : maximum;
  }
  return Object.freeze(limits);
}

function addDiagnostic(state, code, details) {
  if (state.diagnostics.length >= state.limits.maxDiagnostics) return;
  state.diagnostics.push(Object.freeze({ code, ...(details ?? {}) }));
}

function emptyResult({ status, source, sourceHash, diagnostics, termination = null }) {
  return Object.freeze({
    extractorVersion: DETERMINISTIC_EXTRACTION_VERSION,
    parserVersions: Object.freeze({
      html: "parse5@8.0.1",
      htmlStream: "parse5-parser-stream@8.0.0",
      xml: "sax@1.6.1",
      json: JSON_PARSER_VERSION,
    }),
    status,
    termination,
    source,
    sourceHash,
    canonicalSuggestions: Object.freeze([]),
    pageMetadata: Object.freeze([]),
    assetSources: Object.freeze([]),
    assetSourcesTruncated: false,
    events: Object.freeze([]),
    organizations: Object.freeze([]),
    visibleText: Object.freeze([]),
    statusMentions: Object.freeze([]),
    accessSignals: Object.freeze([]),
    conflicts: Object.freeze([]),
    ambiguities: Object.freeze([]),
    jsonLdBlocks: Object.freeze([]),
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze(item))),
  });
}
