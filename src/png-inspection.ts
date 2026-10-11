import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export const PNG_INSPECTION_LIMITS = Object.freeze({
  maxInputBytes: 20 * 1024 * 1024,
  maxChunkCount: 4096,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 16_777_216,
  maxInflatedBytes: 64 * 1024 * 1024
});

export type PngInspectionStatus =
  | "inspected"
  | "invalid"
  | "unsupported"
  | "resource_limit"
  | "expectation_mismatch";

export type PngObservedFormat = "png" | "pdf" | "jpeg" | "webp" | "zip" | "unknown";
export type PngObservedContentType =
  | "image/png"
  | "application/pdf"
  | "image/jpeg"
  | "image/webp"
  | "application/zip"
  | null;

export type PngExpectationField = "contentType" | "byteLength" | "sha256";
export type PngExpectationFailureCode =
  | "invalid_expected_value"
  | "value_mismatch";

export interface PngExpectationFailure {
  readonly field: PngExpectationField;
  readonly code: PngExpectationFailureCode;
}

export interface PngExpectationReport {
  readonly status: "not_requested" | "matched" | "mismatch" | "not_checked";
  readonly failures: readonly PngExpectationFailure[];
}

export interface PngPhysicalResolution {
  readonly pixelsPerUnitX: number;
  readonly pixelsPerUnitY: number;
  readonly unit: "unknown" | "metre";
  readonly dpiX: number | null;
  readonly dpiY: number | null;
}

export interface PngInspectionMetadata {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: 8;
  readonly colorType: 2;
  readonly compressionMethod: 0;
  readonly filterMethod: 0;
  readonly interlaceMethod: 0;
  readonly chunks: readonly string[];
  readonly idatChunkCount: number;
  readonly filteredByteLength: number;
  readonly filterTypesValid: true;
  readonly srgbRenderingIntent: 0 | 1 | 2 | 3 | null;
  readonly physicalResolution: PngPhysicalResolution | null;
}

export type PngInspectionCode =
  | "ok"
  | "input_invalid"
  | "input_view_unsupported"
  | "shared_memory_unsupported"
  | "input_too_large"
  | "signature_mismatch"
  | "format_not_supported"
  | "chunk_header_truncated"
  | "chunk_length_invalid"
  | "chunk_data_truncated"
  | "chunk_type_invalid"
  | "chunk_reserved_bit_invalid"
  | "chunk_crc_mismatch"
  | "chunk_count_limit"
  | "ihdr_missing_or_not_first"
  | "ihdr_duplicate"
  | "ihdr_length_invalid"
  | "ihdr_dimensions_invalid"
  | "ihdr_combination_invalid"
  | "ihdr_method_invalid"
  | "profile_not_supported"
  | "dimension_limit"
  | "pixel_count_limit"
  | "unsupported_chunk"
  | "chunk_order_invalid"
  | "chunk_duplicate"
  | "srgb_length_invalid"
  | "srgb_value_invalid"
  | "phys_length_invalid"
  | "phys_unit_invalid"
  | "idat_missing"
  | "idat_noncontiguous"
  | "iend_invalid"
  | "trailing_file_data"
  | "zlib_invalid"
  | "zlib_output_limit"
  | "scanline_size_mismatch"
  | "scanline_filter_invalid"
  | "expectation_mismatch";

export interface PngInspectionResult {
  readonly status: PngInspectionStatus;
  readonly code: PngInspectionCode;
  readonly format: PngObservedFormat;
  readonly contentType: PngObservedContentType;
  readonly byteLength: number | null;
  readonly sha256: string | null;
  readonly expectations: PngExpectationReport;
  /** Present only when the supported PNG profile was fully inspected. */
  readonly metadata: PngInspectionMetadata | null;
}

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const UINT31_MAX = 0x7fffffff;
const SRGB_INTENTS = new Set([0, 1, 2, 3]);
const EXPECTED_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/i;

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const uint8ArrayConstructor = Uint8Array;
const reflectApply = Reflect.apply;
const arrayBufferIsView = ArrayBuffer.isView;
const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const typedArraySet = Object.getOwnPropertyDescriptor(typedArrayPrototype, "set")?.value as
  | ((this: Uint8Array, source: ArrayLike<number> | ArrayBufferView) => void)
  | undefined;
const typedArrayTagGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteLength")?.get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayLengthGetter = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")?.get;
const sharedArrayBufferByteLengthGetter = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

type SnapshotResult =
  | { readonly kind: "ok"; readonly bytes: Uint8Array }
  | { readonly kind: "invalid" }
  | { readonly kind: "unsupported_view" }
  | { readonly kind: "shared_memory" }
  | { readonly kind: "resource_limit"; readonly byteLength: number };

interface ParsedFormat {
  readonly format: PngObservedFormat;
  readonly contentType: PngObservedContentType;
}

interface ParseResult {
  readonly status: "inspected" | "invalid" | "unsupported" | "resource_limit";
  readonly code: PngInspectionCode;
  readonly metadata: PngInspectionMetadata | null;
}

function emptyExpectations(status: PngExpectationReport["status"] = "not_requested"): PngExpectationReport {
  return Object.freeze({ status, failures: Object.freeze([]) });
}

function result(
  status: PngInspectionStatus,
  code: PngInspectionCode,
  format: PngObservedFormat,
  contentType: PngObservedContentType,
  byteLength: number | null,
  sha256: string | null,
  expectations: PngExpectationReport = emptyExpectations(),
  metadata: PngInspectionMetadata | null = null
): PngInspectionResult {
  return Object.freeze({ status, code, format, contentType, byteLength, sha256, expectations, metadata });
}

function isArrayBuffer(buffer: unknown): buffer is ArrayBuffer {
  if (arrayBufferByteLengthGetter === undefined) return false;
  try {
    reflectApply(arrayBufferByteLengthGetter, buffer, []);
    return true;
  } catch {
    return false;
  }
}

function isSharedBuffer(buffer: unknown): buffer is SharedArrayBuffer {
  if (sharedArrayBufferByteLengthGetter === undefined) return false;
  try {
    reflectApply(sharedArrayBufferByteLengthGetter, buffer, []);
    return true;
  } catch {
    return false;
  }
}

/** Copies only a genuine Uint8Array view, without consulting overridable instance properties. */
function snapshotBytes(value: unknown): SnapshotResult {
  if (!arrayBufferIsView(value)) return { kind: "invalid" };
  if (
    arrayBufferByteLengthGetter === undefined || typedArraySet === undefined ||
    typedArrayTagGetter === undefined || typedArrayBufferGetter === undefined ||
    typedArrayByteLengthGetter === undefined || typedArrayByteOffsetGetter === undefined ||
    typedArrayLengthGetter === undefined
  ) return { kind: "invalid" };

  let tag: unknown;
  let backing: unknown;
  let byteLength: unknown;
  let byteOffset: unknown;
  let elementLength: unknown;
  try {
    tag = reflectApply(typedArrayTagGetter, value, []);
    if (tag !== "Uint8Array") return { kind: "unsupported_view" };
    backing = reflectApply(typedArrayBufferGetter, value, []);
    byteLength = reflectApply(typedArrayByteLengthGetter, value, []);
    byteOffset = reflectApply(typedArrayByteOffsetGetter, value, []);
    elementLength = reflectApply(typedArrayLengthGetter, value, []);
  } catch {
    return { kind: "invalid" };
  }
  if (
    typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 ||
    typeof byteOffset !== "number" || !Number.isSafeInteger(byteOffset) || byteOffset < 0 ||
    typeof elementLength !== "number" || elementLength !== byteLength
  ) return { kind: "invalid" };
  if (isSharedBuffer(backing)) return { kind: "shared_memory" };
  if (!isArrayBuffer(backing)) return { kind: "invalid" };
  if (byteLength > PNG_INSPECTION_LIMITS.maxInputBytes) {
    return { kind: "resource_limit", byteLength };
  }

  try {
    // Construct a fresh fixed-length view from the internal-slot-validated buffer and copy with
    // the captured intrinsic. Neither step walks the caller-controlled prototype chain.
    const source = new uint8ArrayConstructor(backing, byteOffset, byteLength);
    const copy = new uint8ArrayConstructor(byteLength);
    reflectApply(typedArraySet, copy, [source]);
    return { kind: "ok", bytes: copy };
  } catch {
    return { kind: "invalid" };
  }
}

function classifyFormat(bytes: Uint8Array): ParsedFormat {
  if (bytes.byteLength >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return { format: "png", contentType: "image/png" };
  }
  if (bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { format: "pdf", contentType: "application/pdf" };
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { format: "jpeg", contentType: "image/jpeg" };
  }
  if (
    bytes.byteLength >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { format: "webp", contentType: "image/webp" };
  if (
    bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06) || (bytes[2] === 0x07 && bytes[3] === 0x08))
  ) return { format: "zip", contentType: "application/zip" };
  return { format: "unknown", contentType: null };
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function hasOwnErrorCode(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  try {
    return Object.getOwnPropertyDescriptor(error, "code")?.value === code;
  } catch {
    return false;
  }
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    const index = (crc ^ bytes[offset]!) & 0xff;
    crc = (crcTable[index] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  ) >>> 0;
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function isAsciiLetter(value: number): boolean {
  return value >= 0x41 && value <= 0x5a || value >= 0x61 && value <= 0x7a;
}

function isValidBitDepth(colorType: number, bitDepth: number): boolean {
  if (colorType === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (colorType === 2) return bitDepth === 8 || bitDepth === 16;
  if (colorType === 3) return [1, 2, 4, 8].includes(bitDepth);
  if (colorType === 4 || colorType === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

function parsePng(bytes: Uint8Array): ParseResult {
  let offset = PNG_SIGNATURE.length;
  let chunkCount = 0;
  let sawIhdr = false;
  let sawSrgb = false;
  let sawPhys = false;
  let sawIdat = false;
  let sawIend = false;
  let idatEnded = false;
  let unsupportedCode: PngInspectionCode | null = null;
  let width = 0;
  let height = 0;
  let srgbRenderingIntent: 0 | 1 | 2 | 3 | null = null;
  let physicalResolution: PngPhysicalResolution | null = null;
  const chunkTypes: string[] = [];
  const idatParts: Uint8Array[] = [];
  let idatByteLength = 0;

  while (offset < bytes.byteLength) {
    if (chunkCount >= PNG_INSPECTION_LIMITS.maxChunkCount) {
      return { status: "resource_limit", code: "chunk_count_limit", metadata: null };
    }
    if (bytes.byteLength - offset < 12) {
      return { status: "invalid", code: "chunk_header_truncated", metadata: null };
    }
    const length = uint32be(bytes, offset);
    if (length > UINT31_MAX) return { status: "invalid", code: "chunk_length_invalid", metadata: null };
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const remainingAfterHeader = bytes.byteLength - dataOffset;
    if (remainingAfterHeader < 4 || length > remainingAfterHeader - 4) {
      return { status: "invalid", code: "chunk_data_truncated", metadata: null };
    }
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    const typeBytes = [bytes[typeOffset]!, bytes[typeOffset + 1]!, bytes[typeOffset + 2]!, bytes[typeOffset + 3]!];
    if (!typeBytes.every(isAsciiLetter)) return { status: "invalid", code: "chunk_type_invalid", metadata: null };
    const type = chunkType(bytes, typeOffset);
    const expectedCrc = crc32(bytes, typeOffset, crcOffset);
    const actualCrc = uint32be(bytes, crcOffset);
    if (expectedCrc !== actualCrc) return { status: "invalid", code: "chunk_crc_mismatch", metadata: null };
    chunkCount += 1;
    chunkTypes.push(type);

    // PNG reserves the third-letter lowercase bit; a lowercase third letter is malformed.
    if (typeBytes[2]! >= 0x61) {
      return { status: "invalid", code: "chunk_reserved_bit_invalid", metadata: null };
    }

    if (!sawIhdr && type !== "IHDR") {
      return { status: "invalid", code: "ihdr_missing_or_not_first", metadata: null };
    }

    if (type === "IHDR") {
      if (sawIhdr) return { status: "invalid", code: "ihdr_duplicate", metadata: null };
      if (chunkCount !== 1) return { status: "invalid", code: "ihdr_missing_or_not_first", metadata: null };
      if (length !== 13) return { status: "invalid", code: "ihdr_length_invalid", metadata: null };
      width = uint32be(bytes, dataOffset);
      height = uint32be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8]!;
      const colorType = bytes[dataOffset + 9]!;
      const compressionMethod = bytes[dataOffset + 10]!;
      const filterMethod = bytes[dataOffset + 11]!;
      const interlaceMethod = bytes[dataOffset + 12]!;
      if (width === 0 || height === 0 || width > UINT31_MAX || height > UINT31_MAX) {
        return { status: "invalid", code: "ihdr_dimensions_invalid", metadata: null };
      }
      if (!isValidBitDepth(colorType, bitDepth)) return { status: "invalid", code: "ihdr_combination_invalid", metadata: null };
      if (compressionMethod !== 0 || filterMethod !== 0 || (interlaceMethod !== 0 && interlaceMethod !== 1)) {
        return { status: "invalid", code: "ihdr_method_invalid", metadata: null };
      }
      if (width > PNG_INSPECTION_LIMITS.maxWidth || height > PNG_INSPECTION_LIMITS.maxHeight) {
        return { status: "resource_limit", code: "dimension_limit", metadata: null };
      }
      if (width * height > PNG_INSPECTION_LIMITS.maxPixels) {
        return { status: "resource_limit", code: "pixel_count_limit", metadata: null };
      }
      if (colorType !== 2 || bitDepth !== 8 || interlaceMethod !== 0) {
        return { status: "unsupported", code: "profile_not_supported", metadata: null };
      }
      sawIhdr = true;
      offset = nextOffset;
      continue;
    }

    if (type === "sRGB") {
      if (sawIdat) return { status: "invalid", code: "chunk_order_invalid", metadata: null };
      if (sawSrgb) return { status: "invalid", code: "chunk_duplicate", metadata: null };
      if (length !== 1) return { status: "invalid", code: "srgb_length_invalid", metadata: null };
      const intent = bytes[dataOffset]!;
      if (!SRGB_INTENTS.has(intent)) return { status: "invalid", code: "srgb_value_invalid", metadata: null };
      srgbRenderingIntent = intent as 0 | 1 | 2 | 3;
      sawSrgb = true;
      offset = nextOffset;
      continue;
    }

    if (type === "pHYs") {
      if (sawIdat) return { status: "invalid", code: "chunk_order_invalid", metadata: null };
      if (sawPhys) return { status: "invalid", code: "chunk_duplicate", metadata: null };
      if (length !== 9) return { status: "invalid", code: "phys_length_invalid", metadata: null };
      const unitSpecifier = bytes[dataOffset + 8]!;
      if (unitSpecifier !== 0 && unitSpecifier !== 1) return { status: "invalid", code: "phys_unit_invalid", metadata: null };
      const pixelsPerUnitX = uint32be(bytes, dataOffset);
      const pixelsPerUnitY = uint32be(bytes, dataOffset + 4);
      physicalResolution = Object.freeze({
        pixelsPerUnitX,
        pixelsPerUnitY,
        unit: unitSpecifier === 1 ? "metre" : "unknown",
        dpiX: unitSpecifier === 1 ? pixelsPerUnitX * 0.0254 : null,
        dpiY: unitSpecifier === 1 ? pixelsPerUnitY * 0.0254 : null
      });
      sawPhys = true;
      offset = nextOffset;
      continue;
    }

    if (type === "IDAT") {
      if (idatEnded) return { status: "invalid", code: "idat_noncontiguous", metadata: null };
      sawIdat = true;
      idatParts.push(bytes.subarray(dataOffset, crcOffset));
      idatByteLength += length;
      offset = nextOffset;
      continue;
    }

    if (type === "IEND") {
      if (!sawIdat) return { status: "invalid", code: "idat_missing", metadata: null };
      if (length !== 0) return { status: "invalid", code: "iend_invalid", metadata: null };
      if (nextOffset !== bytes.byteLength) return { status: "invalid", code: "trailing_file_data", metadata: null };
      sawIend = true;
      offset = nextOffset;
      break;
    }

    if (sawIdat) idatEnded = true;

    // Well-formed chunks outside this deliberately narrow profile are not interpreted. Continue
    // only the bounded chunk-envelope scan to distinguish malformed ordering from unsupported data.
    // This includes ancillary chunks, optional truecolor PLTE, APNG chunks, and unknown critical chunks.
    unsupportedCode ??= "unsupported_chunk";
    offset = nextOffset;
  }

  if (offset !== bytes.byteLength || !sawIhdr || !sawIend) {
    return { status: "invalid", code: "iend_invalid", metadata: null };
  }
  if (!sawIdat || idatParts.length === 0) return { status: "invalid", code: "idat_missing", metadata: null };
  if (unsupportedCode !== null) return { status: "unsupported", code: unsupportedCode, metadata: null };

  const rowLength = width * 3 + 1;
  const expectedFilteredLength = rowLength * height;
  if (!Number.isSafeInteger(expectedFilteredLength) || expectedFilteredLength > PNG_INSPECTION_LIMITS.maxInflatedBytes) {
    return { status: "resource_limit", code: "zlib_output_limit", metadata: null };
  }
  let filtered: Uint8Array;
  try {
    const compressed = Buffer.concat(idatParts.map((part) => Buffer.from(part.buffer, part.byteOffset, part.byteLength)), idatByteLength);
    filtered = inflateSync(compressed, { maxOutputLength: PNG_INSPECTION_LIMITS.maxInflatedBytes });
  } catch (error) {
    if (hasOwnErrorCode(error, "ERR_BUFFER_TOO_LARGE")) {
      return { status: "resource_limit", code: "zlib_output_limit", metadata: null };
    }
    return { status: "invalid", code: "zlib_invalid", metadata: null };
  }
  if (filtered.byteLength > PNG_INSPECTION_LIMITS.maxInflatedBytes) {
    return { status: "resource_limit", code: "zlib_output_limit", metadata: null };
  }
  if (filtered.byteLength !== expectedFilteredLength) {
    return { status: "invalid", code: "scanline_size_mismatch", metadata: null };
  }
  for (let row = 0; row < height; row += 1) {
    const filter = filtered[row * rowLength];
    if (filter === undefined || filter > 4) {
      return { status: "invalid", code: "scanline_filter_invalid", metadata: null };
    }
  }

  return {
    status: "inspected",
    code: "ok",
    metadata: Object.freeze({
      width,
      height,
      bitDepth: 8,
      colorType: 2,
      compressionMethod: 0,
      filterMethod: 0,
      interlaceMethod: 0,
      chunks: Object.freeze(chunkTypes.slice()),
      idatChunkCount: idatParts.length,
      filteredByteLength: filtered.byteLength,
      filterTypesValid: true,
      srgbRenderingIntent,
      physicalResolution
    })
  };
}

function expectationReport(
  format: PngObservedFormat,
  contentType: PngObservedContentType,
  byteLength: number,
  digest: string,
  expectedContentType: unknown,
  expectedByteLength: unknown,
  expectedSha256: unknown
): PngExpectationReport {
  const requested = expectedContentType !== undefined || expectedByteLength !== undefined || expectedSha256 !== undefined;
  if (!requested) return emptyExpectations();
  const failures: PngExpectationFailure[] = [];
  if (expectedContentType !== undefined) {
    if (typeof expectedContentType !== "string") failures.push(Object.freeze({ field: "contentType", code: "invalid_expected_value" }));
    else if (expectedContentType !== contentType) failures.push(Object.freeze({ field: "contentType", code: "value_mismatch" }));
  }
  if (expectedByteLength !== undefined) {
    if (typeof expectedByteLength !== "number" || !Number.isSafeInteger(expectedByteLength) || expectedByteLength < 0) {
      failures.push(Object.freeze({ field: "byteLength", code: "invalid_expected_value" }));
    } else if (expectedByteLength !== byteLength) {
      failures.push(Object.freeze({ field: "byteLength", code: "value_mismatch" }));
    }
  }
  if (expectedSha256 !== undefined) {
    if (typeof expectedSha256 !== "string" || !EXPECTED_HASH_PATTERN.test(expectedSha256)) {
      failures.push(Object.freeze({ field: "sha256", code: "invalid_expected_value" }));
    } else if (expectedSha256.toLowerCase() !== digest) {
      failures.push(Object.freeze({ field: "sha256", code: "value_mismatch" }));
    }
  }
  return Object.freeze({
    status: failures.length === 0 ? "matched" : "mismatch",
    failures: Object.freeze(failures)
  });
}

/**
 * Inspects immutable bytes for the supported static RGB8 PNG profile.
 * Optional expected values are primitive file-level checks, not an approval or bundle contract.
 */
export function inspectPngBytes(
  input: unknown,
  expectedContentType?: unknown,
  expectedByteLength?: unknown,
  expectedSha256?: unknown
): PngInspectionResult {
  const snapshot = snapshotBytes(input);
  if (snapshot.kind === "invalid") {
    return result("invalid", "input_invalid", "unknown", null, null, null, emptyExpectations("not_checked"));
  }
  if (snapshot.kind === "unsupported_view") {
    return result("unsupported", "input_view_unsupported", "unknown", null, null, null, emptyExpectations("not_checked"));
  }
  if (snapshot.kind === "shared_memory") {
    return result("unsupported", "shared_memory_unsupported", "unknown", null, null, null, emptyExpectations("not_checked"));
  }
  if (snapshot.kind === "resource_limit") {
    return result("resource_limit", "input_too_large", "unknown", null, snapshot.byteLength, null, emptyExpectations("not_checked"));
  }

  const bytes = snapshot.bytes;
  const digest = sha256(bytes);
  const identified = classifyFormat(bytes);
  const expectations = expectationReport(
    identified.format,
    identified.contentType,
    bytes.byteLength,
    digest,
    expectedContentType,
    expectedByteLength,
    expectedSha256
  );

  if (identified.format !== "png") {
    const knownOtherFormat = identified.format !== "unknown";
    if (knownOtherFormat) {
      return result("unsupported", "format_not_supported", identified.format, identified.contentType, bytes.byteLength, digest, expectations);
    }
    return result("invalid", "signature_mismatch", identified.format, identified.contentType, bytes.byteLength, digest, expectations);
  }

  let parsed: ParseResult;
  try {
    parsed = parsePng(bytes);
  } catch {
    return result("invalid", "input_invalid", "png", "image/png", bytes.byteLength, digest, expectations);
  }
  if (parsed.status !== "inspected") {
    return result(parsed.status, parsed.code, "png", "image/png", bytes.byteLength, digest, expectations, parsed.metadata);
  }
  if (expectations.status === "mismatch") {
    return result("expectation_mismatch", "expectation_mismatch", "png", "image/png", bytes.byteLength, digest, expectations, parsed.metadata);
  }
  return result("inspected", "ok", "png", "image/png", bytes.byteLength, digest, expectations, parsed.metadata);
}
