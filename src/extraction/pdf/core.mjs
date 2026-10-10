import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_DECODER_VERSION, PDF_LIMITS } from "./constants.mjs";

export { PDF_DECODER_VERSION, PDF_LIMITS } from "./constants.mjs";

class PdfReadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new PdfReadError(code);
}

function hasEntries(value) {
  if (value instanceof Map) return value.size > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

const REJECTED_PDF_NAMES = new Map([
  ["URI", "remote_reference"],
  ["GoToR", "remote_reference"],
  ["GoToE", "remote_reference"],
  ["ObjStm", "unsupported_pdf_feature"],
  ["OpenAction", "active_or_unsupported_feature"],
  ["AA", "active_or_unsupported_feature"],
  ["JavaScript", "active_or_unsupported_feature"],
  ["JS", "active_or_unsupported_feature"],
  ["Launch", "active_or_unsupported_feature"],
  ["SubmitForm", "active_or_unsupported_feature"],
  ["ImportData", "active_or_unsupported_feature"],
  ["Rendition", "active_or_unsupported_feature"],
  ["RichMedia", "active_or_unsupported_feature"],
  ["Movie", "active_or_unsupported_feature"],
  ["Sound", "active_or_unsupported_feature"],
  ["ResetForm", "active_or_unsupported_feature"],
  ["Hide", "active_or_unsupported_feature"],
  ["SetOCGState", "active_or_unsupported_feature"],
  ["GoTo3DView", "active_or_unsupported_feature"],
  ["XFA", "active_or_unsupported_feature"],
  ["EmbeddedFiles", "active_or_unsupported_feature"],
  ["EF", "active_or_unsupported_feature"],
  ["AF", "active_or_unsupported_feature"],
]);

function rejectedPdfName(bytes) {
  // PDF names can encode bytes as #xx; decode names before comparing so a
  // spelling such as /Java#53cript cannot bypass the bounded feature policy.
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isWhiteSpace = (byte) => byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
  const isDelimiter = (byte) => byte === 40 || byte === 41 || byte === 60 || byte === 62 || byte === 91 || byte === 93 || byte === 123 || byte === 125 || byte === 47 || byte === 37;
  const hexValue = (byte) => {
    if (byte >= 48 && byte <= 57) return byte - 48;
    if (byte >= 65 && byte <= 70) return byte - 55;
    if (byte >= 97 && byte <= 102) return byte - 87;
    return -1;
  };

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== 47) continue;
    let name = "";
    let cursor = index + 1;
    while (cursor < source.length && !isWhiteSpace(source[cursor]) && !isDelimiter(source[cursor])) {
      if (source[cursor] === 35 && cursor + 2 < source.length) {
        const high = hexValue(source[cursor + 1]);
        const low = hexValue(source[cursor + 2]);
        if (high >= 0 && low >= 0) {
          name += String.fromCharCode((high << 4) | low);
          cursor += 3;
          continue;
        }
      }
      name += String.fromCharCode(source[cursor]);
      cursor += 1;
    }
    const code = REJECTED_PDF_NAMES.get(name);
    if (code) return code;
    index = cursor - 1;
  }
  return null;
}

function hasRemoteOutline(outline) {
  const stack = [];
  for (const item of outline ?? []) stack.push({ item, depth: 1 });
  let visited = 0;
  while (stack.length > 0) {
    const { item, depth } = stack.pop();
    visited += 1;
    if (visited > PDF_LIMITS.maxOutlineNodes || depth > PDF_LIMITS.maxOutlineDepth) {
      fail("structure_limit");
    }
    if (
      (typeof item.url === "string" && item.url.length > 0) ||
      (typeof item.unsafeUrl === "string" && item.unsafeUrl.length > 0)
    ) {
      fail("remote_reference");
    }
    for (const child of item.items ?? []) stack.push({ item: child, depth: depth + 1 });
  }
  return false;
}

function roundGeometry(value) {
  if (!Number.isFinite(value)) fail("invalid_geometry");
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function applyTransform(transform, x, y) {
  const [a, b, c, d, e, f] = transform;
  return [a * x + c * y + e, b * x + d * y + f];
}

function textBox(item, viewport) {
  const transform = item.transform;
  if (
    !Array.isArray(transform) && !ArrayBuffer.isView(transform)
  ) {
    fail("invalid_geometry");
  }
  if (transform.length !== 6 || !Array.from(transform).every(Number.isFinite)) {
    fail("invalid_geometry");
  }

  const [a, b, c, d, originX, originY] = transform;
  const baselineLength = Math.hypot(a, b);
  const verticalLength = Math.hypot(c, d);
  const textWidth = item.width;
  const textHeight = item.height;
  if (
    !Number.isFinite(baselineLength) ||
    baselineLength === 0 ||
    !Number.isFinite(verticalLength) ||
    verticalLength === 0 ||
    !Number.isFinite(textWidth) ||
    textWidth < 0 ||
    !Number.isFinite(textHeight) ||
    textHeight < 0
  ) {
    fail("invalid_geometry");
  }

  const inlineX = (a / baselineLength) * textWidth;
  const inlineY = (b / baselineLength) * textWidth;
  const riseX = (c / verticalLength) * textHeight;
  const riseY = (d / verticalLength) * textHeight;
  const pagePoints = [
    [originX, originY],
    [originX + inlineX, originY + inlineY],
    [originX + inlineX + riseX, originY + inlineY + riseY],
    [originX + riseX, originY + riseY],
  ];
  const points = pagePoints.map(([x, y]) =>
    applyTransform(viewport.transform, x, y),
  );
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.max(0, Math.min(...xs));
  const top = Math.max(0, Math.min(...ys));
  const right = Math.min(viewport.width, Math.max(...xs));
  const bottom = Math.min(viewport.height, Math.max(...ys));

  return {
    x: roundGeometry(Math.min(left, viewport.width)),
    y: roundGeometry(Math.min(top, viewport.height)),
    width: roundGeometry(Math.max(0, right - left)),
    height: roundGeometry(Math.max(0, bottom - top)),
    text: item.str,
    geometry: "approximate-text-item",
  };
}

function pageDimensions(page) {
  const view = page.view;
  const rotation = ((page.rotate % 360) + 360) % 360;
  if (
    !Array.isArray(view) ||
    view.length !== 4 ||
    !view.every(Number.isFinite) ||
    ![0, 90, 180, 270].includes(rotation) ||
    !Number.isFinite(page.userUnit) ||
    page.userUnit <= 0
  ) {
    fail("invalid_geometry");
  }
  const userWidth = (view[2] - view[0]) * page.userUnit;
  const userHeight = (view[3] - view[1]) * page.userUnit;
  if (
    !Number.isFinite(userWidth) ||
    !Number.isFinite(userHeight) ||
    userWidth <= 0 ||
    userHeight <= 0
  ) {
    fail("invalid_geometry");
  }
  if (
    userWidth > PDF_LIMITS.maxPagePoints ||
    userHeight > PDF_LIMITS.maxPagePoints
  ) {
    fail("dimension_limit");
  }
  return { rotation, userWidth, userHeight };
}

async function rejectActiveFeatures(pdf) {
  if (pdf.isPureXfa) fail("active_or_unsupported_feature");
  if ((await pdf.hasJSActions()) || hasEntries(await pdf.getJSActions())) {
    fail("active_or_unsupported_feature");
  }
  if ((await pdf.getOpenAction()) !== null) {
    fail("active_or_unsupported_feature");
  }
  if (hasEntries(await pdf.getAttachments())) {
    fail("active_or_unsupported_feature");
  }
  hasRemoteOutline(await pdf.getOutline());
}

export async function decodePdfBytesForWorker(bytes, options = {}) {
  if (pdfjs.version !== PDF_DECODER_VERSION) fail("decoder_version_mismatch");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) fail("invalid_input");
  if (bytes.byteLength > PDF_LIMITS.maxInputBytes) fail("input_limit");
  const preflightCode = rejectedPdfName(bytes);
  if (preflightCode) fail(preflightCode);
  if (options.maxTextCodeUnits !== undefined) {
    if (
      !Number.isInteger(options.maxTextCodeUnits) ||
      options.maxTextCodeUnits < 1 ||
      options.maxTextCodeUnits > PDF_LIMITS.maxTextCodeUnits
    ) {
      fail("invalid_limit");
    }
  }
  const maxTextCodeUnits = options.maxTextCodeUnits ?? PDF_LIMITS.maxTextCodeUnits;
  let loadingTask;
  let pdf;
  try {
    loadingTask = pdfjs.getDocument({
      // PDF.js intentionally rejects Node Buffer instances. Copy into a plain
      // Uint8Array so the decoder cannot detach or mutate the caller's bytes.
      data: Uint8Array.from(bytes),
      stopAtErrors: true,
      useWasm: false,
      enableXfa: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      maxImageSize: 0,
      canvasMaxAreaInBytes: 0,
      verbosity: 0,
    });
    pdf = await loadingTask.promise;
    if (pdf.numPages < 1) fail("no_pages");
    if (pdf.numPages > PDF_LIMITS.maxPages) fail("page_limit");
    await rejectActiveFeatures(pdf);

    const pages = [];
    let textCodeUnits = 0;
    let textItems = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      if (page.isPureXfa || hasEntries(await page.getJSActions())) {
        fail("active_or_unsupported_feature");
      }
      const annotations = await page.getAnnotations({ intent: "display" });
      if (annotations.length > 0) fail("active_or_unsupported_feature");

      const { rotation } = pageDimensions(page);
      const viewport = page.getViewport({ scale: 1, rotation });
      if (
        !Number.isFinite(viewport.width) ||
        !Number.isFinite(viewport.height) ||
        viewport.width <= 0 ||
        viewport.height <= 0 ||
        viewport.width > PDF_LIMITS.maxPagePoints ||
        viewport.height > PDF_LIMITS.maxPagePoints
      ) {
        fail("dimension_limit");
      }

      const content = await page.getTextContent({ includeMarkedContent: false });
      const boxes = [];
      for (const item of content.items) {
        if (typeof item.str !== "string" || item.str.trim().length === 0) continue;
        if (item.str.length > PDF_LIMITS.maxTextItemCodeUnits) fail("text_limit");
        textCodeUnits += item.str.length;
        textItems += 1;
        if (
          textCodeUnits > maxTextCodeUnits ||
          textItems > PDF_LIMITS.maxTextItems
        ) {
          fail("text_limit");
        }
        boxes.push(textBox(item, viewport));
      }
      pages.push({
        pageIndex: pageNumber - 1,
        width: roundGeometry(viewport.width),
        height: roundGeometry(viewport.height),
        rotation,
        coordinateSystem: "viewport-points-top-left",
        textPresence: boxes.length > 0 ? "text-present" : "no-embedded-text",
        requiresInspection: true,
        textBoxes: boxes,
      });
      options.onPageComplete?.(pageNumber - 1);
    }

    const hasText = pages.some((page) => page.textBoxes.length > 0);
    return {
      kind: hasText ? "observation" : "no-text",
      completeness: "incomplete-text-only",
      pages,
      networkAttemptCount: 0,
    };
  } catch (error) {
    if (error instanceof PdfReadError) throw error;
    if (error?.name === "PasswordException") fail("encrypted_pdf");
    fail("malformed_pdf");
  } finally {
    try {
      if (pdf) await pdf.destroy();
      else if (loadingTask) await loadingTask.destroy();
    } catch {
      // The parent treats any incomplete worker protocol as failure.
    }
  }
}

export function isPdfReadError(error) {
  return error instanceof PdfReadError;
}
