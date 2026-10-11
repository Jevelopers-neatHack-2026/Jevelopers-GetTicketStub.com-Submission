import { exactRange, textCandidate } from "./source.mjs";

const ORGANIZATION_TYPES = new Set([
  "Organization",
  "Airline",
  "Consortium",
  "Corporation",
  "EducationalOrganization",
  "GovernmentOrganization",
  "LibrarySystem",
  "LocalBusiness",
  "MedicalOrganization",
  "NGO",
  "PerformingGroup",
  "ResearchOrganization",
  "SportsOrganization",
  "WorkersUnion",
]);
const decodedScalarValues = new WeakMap();

export function decodedJsonLdScalarValue(candidate) {
  return candidate !== null && typeof candidate === "object"
    ? decodedScalarValues.get(candidate)
    : undefined;
}

export function indexJsonDocument(source, { maxDepth, maxNodes }) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, code: "MALFORMED_JSONLD" };
  }

  const positions = new Map();
  let offset = 0;
  let nodeCount = 0;

  const fail = (code) => {
    const error = new Error(code);
    error.code = code;
    throw error;
  };
  const skipWhitespace = () => {
    while (source[offset] === " " || source[offset] === "\t"
      || source[offset] === "\r" || source[offset] === "\n") offset += 1;
  };
  const scanString = () => {
    if (source[offset] !== '"') fail("MALFORMED_JSONLD");
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset];
      if (character === "\\") {
        offset += 2;
        continue;
      }
      offset += 1;
      if (character === '"') {
        let decoded;
        try {
          decoded = JSON.parse(source.slice(start, offset));
        } catch {
          fail("MALFORMED_JSONLD");
        }
        return { decoded, startOffset: start, endOffset: offset };
      }
    }
    fail("MALFORMED_JSONLD");
  };
  const scanPrimitive = () => {
    const pattern = /(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/y;
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) fail("MALFORMED_JSONLD");
    offset += match[0].length;
  };
  const pointerFor = (parts) => parts.length === 0
    ? ""
    : "/" + parts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");

  const scanValue = (parts, depth) => {
    if (depth > maxDepth) fail("JSON_DEPTH_LIMIT");
    skipWhitespace();
    if (offset >= source.length) fail("MALFORMED_JSONLD");
    nodeCount += 1;
    if (nodeCount > maxNodes) fail("JSON_NODE_LIMIT");

    const startOffset = offset;
    const leading = source[offset];
    if (leading === "{") {
      offset += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[offset] !== "}") {
        while (true) {
          skipWhitespace();
          const key = scanString().decoded;
          if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
          keys.add(key);
          skipWhitespace();
          if (source[offset] !== ":") fail("MALFORMED_JSONLD");
          offset += 1;
          scanValue([...parts, key], depth + 1);
          skipWhitespace();
          if (source[offset] === "}") break;
          if (source[offset] !== ",") fail("MALFORMED_JSONLD");
          offset += 1;
        }
      }
      if (source[offset] !== "}") fail("MALFORMED_JSONLD");
      offset += 1;
    } else if (leading === "[") {
      offset += 1;
      skipWhitespace();
      let index = 0;
      if (source[offset] !== "]") {
        while (true) {
          scanValue([...parts, String(index)], depth + 1);
          index += 1;
          skipWhitespace();
          if (source[offset] === "]") break;
          if (source[offset] !== ",") fail("MALFORMED_JSONLD");
          offset += 1;
        }
      }
      if (source[offset] !== "]") fail("MALFORMED_JSONLD");
      offset += 1;
    } else if (leading === '"') {
      scanString();
    } else {
      scanPrimitive();
    }

    positions.set(pointerFor(parts), Object.freeze({ startOffset, endOffset: offset }));
  };

  try {
    scanValue([], 0);
    skipWhitespace();
    if (offset !== source.length) fail("MALFORMED_JSONLD");
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === "string" ? error.code : "MALFORMED_JSONLD",
    };
  }

  return { ok: true, value, positions };
}

export function extractJsonLdEntities({
  source,
  sourceBytes,
  byteOffsetMap,
  jsonText,
  jsonStartOffset,
  jsonSourceSegments,
  blockIndex,
  limits,
}) {
  const indexed = indexJsonDocument(jsonText, {
    maxDepth: limits.maxJsonDepth,
    maxNodes: limits.maxJsonNodes,
  });
  if (!indexed.ok) return { ok: false, code: indexed.code, entities: [], organizations: [] };

  const events = [];
  const organizations = [];
  const sourceRange = (startOffset, endOffset) => sourceRangeForJsonOffsets(
    startOffset,
    endOffset,
    jsonStartOffset,
    jsonSourceSegments,
  );
  let candidateTruncated = false;
  const stack = [{ value: indexed.value, parts: [] }];

  while (stack.length > 0 && events.length + organizations.length < limits.maxEntities) {
    const current = stack.pop();
    const value = current.value;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], parts: [...current.parts, String(index)] });
      }
      continue;
    }
    if (value === null || typeof value !== "object") continue;

    const types = typeNames(value["@type"]);
    const eventLike = types.some((name) => /Event$/i.test(name));
    const organizationLike = types.some((name) => ORGANIZATION_TYPES.has(name) || /Organization$/i.test(name));
    const pointer = pointerFor(current.parts);
    if (eventLike || organizationLike) {
      const kind = eventLike ? "event" : "organization";
      const ordinal = kind === "event" ? events.length : organizations.length;
      const entityId = kind + ":script-" + blockIndex + ":" + pointer;
      const sourcePosition = indexed.positions.get(pointer);
      const entitySourceRange = sourcePosition
        ? sourceRange(sourcePosition.startOffset, sourcePosition.endOffset)
        : null;
      const exact = entitySourceRange
        ? exactRange(source, sourceBytes, byteOffsetMap, entitySourceRange.startOffset, entitySourceRange.endOffset)
        : null;
      const candidateResult = collectScalarCandidates({
        value,
        parts: current.parts,
        source,
        sourceBytes,
        byteOffsetMap,
        sourceRange,
        positions: indexed.positions,
        limits,
      });
      const candidates = candidateResult.candidates;
      candidateTruncated ||= candidateResult.truncated;
      const entity = Object.freeze({
        entityId,
        kind,
        ordinal,
        blockIndex,
        jsonPointer: pointer,
        typeNames: Object.freeze(types),
        source: exact
          ? Object.freeze({ kind: "jsonld", locator: exact.locator, jsonPointer: pointer })
          : null,
        candidates: Object.freeze(candidates),
      });
      (eventLike ? events : organizations).push(entity);
    }

    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      if (key === "@context") continue;
      if (child !== null && typeof child === "object") {
        stack.push({ value: child, parts: [...current.parts, key] });
      }
    }
  }

  const truncated = stack.length > 0;
  return { ok: true, entities: events, organizations, truncated, candidateTruncated };
}

function collectScalarCandidates({
  value,
  parts,
  source,
  sourceBytes,
  byteOffsetMap,
  sourceRange,
  positions,
  limits,
}) {
  const candidates = [];
  const stack = [{ value, pointerParts: parts, fieldParts: [], depth: 0 }];

  while (stack.length > 0 && candidates.length < limits.maxCandidatesPerEntity) {
    const current = stack.pop();
    const item = current.value;
    if (current.depth > limits.maxJsonDepth || current.pointerParts.at(-1) === "@context") continue;

    if (item === null || ["string", "number", "boolean"].includes(typeof item)) {
      if (current.fieldParts.length === 0) continue;
      const pointer = pointerFor(current.pointerParts);
      const location = positions.get(pointer);
      if (!location) continue;
      const mappedRange = sourceRange(location.startOffset, location.endOffset);
      if (!mappedRange) continue;
      const field = fieldName(current.fieldParts);
      const leafName = current.fieldParts.at(-1).toLowerCase();
      const candidate = textCandidate({
        field,
        kind: "jsonld",
        text: source,
        bytes: sourceBytes,
        byteOffsetMap,
        startOffset: mappedRange.startOffset,
        endOffset: mappedRange.endOffset,
        normalizedValue: item,
        jsonPointer: pointer,
        property: leafName,
        suggestionOnly: ["@id", "url", "sameas", "mainentityofpage"].includes(leafName),
      });
      if (candidate) {
        if (typeof item === "string") decodedScalarValues.set(candidate, item);
        candidates.push(candidate);
      }
      continue;
    }

    if (Array.isArray(item)) {
      for (let index = item.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: item[index],
          pointerParts: [...current.pointerParts, String(index)],
          fieldParts: [...current.fieldParts, "[" + index + "]"],
          depth: current.depth + 1,
        });
      }
      continue;
    }

    if (typeof item === "object") {
      const entries = Object.entries(item);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index];
        if (key === "@context") continue;
        stack.push({
          value: child,
          pointerParts: [...current.pointerParts, key],
          fieldParts: [...current.fieldParts, key],
          depth: current.depth + 1,
        });
      }
    }
  }

  return { candidates, truncated: stack.length > 0 };
}

function sourceRangeForJsonOffsets(startOffset, endOffset, jsonStartOffset, segments) {
  if (!Array.isArray(segments)) {
    return {
      startOffset: jsonStartOffset + startOffset,
      endOffset: jsonStartOffset + endOffset,
    };
  }
  const mappedStart = mapLogicalOffset(segments, startOffset, "start");
  const mappedEnd = mapLogicalOffset(segments, endOffset, "end");
  if (!Number.isInteger(mappedStart) || !Number.isInteger(mappedEnd) || mappedEnd < mappedStart) return null;
  return { startOffset: mappedStart, endOffset: mappedEnd };
}

function mapLogicalOffset(segments, offset, side) {
  if (segments.length === 0) return null;
  if (side === "end" && offset === 0) return segments[0].sourceStart;
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const segment = segments[middle];
    if (side === "start") {
      if (offset < segment.logicalStart) high = middle - 1;
      else if (offset >= segment.logicalEnd) low = middle + 1;
      else return segment.linear
        ? segment.sourceStart + (offset - segment.logicalStart)
        : segment.sourceStart;
    } else {
      if (offset <= segment.logicalStart) high = middle - 1;
      else if (offset > segment.logicalEnd) low = middle + 1;
      else return segment.linear
        ? segment.sourceStart + (offset - segment.logicalStart)
        : segment.sourceEnd;
    }
  }
  if (side === "start" && offset === segments.at(-1).logicalEnd) return segments.at(-1).sourceEnd;
  if (side === "end" && offset === segments.at(-1).logicalEnd) return segments.at(-1).sourceEnd;
  return null;
}

function typeNames(value) {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return values
    .filter((item) => typeof item === "string")
    .map((item) => item.split(/[\/#]/).at(-1))
    .filter((item) => item.length > 0);
}

function pointerFor(parts) {
  return parts.length === 0
    ? ""
    : "/" + parts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

function fieldName(parts) {
  let field = "";
  for (const part of parts) {
    if (/^\[[0-9]+\]$/.test(part)) field += part;
    else field += field.length === 0 ? part : "." + part;
  }
  return field;
}
