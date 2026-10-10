export type PdfTextReaderErrorCode =
  | "INVALID_INPUT"
  | "INVALID_OPTIONS"
  | "INVALID_LIMIT"
  | "INPUT_TOO_LARGE"
  | "MALFORMED_PDF"
  | "ENCRYPTED_PDF"
  | "ACTIVE_PDF_FEATURE"
  | "REMOTE_REFERENCE"
  | "REMOTE_RESOURCE_ATTEMPT"
  | "UNSUPPORTED_PDF_FEATURE"
  | "PAGE_LIMIT"
  | "DIMENSION_LIMIT"
  | "TEXT_LIMIT"
  | "OUTPUT_LIMIT"
  | "RESOURCE_LIMIT"
  | "NO_EMBEDDED_TEXT"
  | "ISOLATION_UNAVAILABLE"
  | "QUEUE_FULL"
  | "CANCELLED"
  | "TIMEOUT"
  | "CALLBACK_FAILED"
  | "PROTOCOL_ERROR"
  | "DECODER_UNAVAILABLE"
  | "DECODER_FAILURE";

export interface PdfTextBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly geometry: "approximate-text-item";
}

export interface PdfPageTextObservation {
  readonly pageIndex: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: 0 | 90 | 180 | 270;
  readonly coordinateSystem: "viewport-points-top-left";
  readonly textPresence: "text-present" | "no-embedded-text";
  readonly requiresInspection: true;
  readonly textBoxes: readonly PdfTextBox[];
}

export interface PdfTextReaderLimits {
  readonly maxInputBytes: number;
  readonly maxPages: number;
  readonly maxPagePoints: number;
  readonly maxTextCodeUnits: number;
  readonly maxTextItemCodeUnits: number;
  readonly maxTextItems: number;
  readonly maxOutputBytes: number;
  readonly maxAddressSpaceBytes: number;
  readonly maxCpuSeconds: number;
  readonly maxTimeoutMs: number;
  readonly maxConcurrency: number;
  readonly maxQueued: number;
}

interface PdfTextReadBase {
  readonly documentSha256?: string;
  readonly decoder: {
    readonly name: "pdfjs-dist";
    readonly version: "6.4.299";
    readonly configVersion: "ei-text-pdf/1";
  };
  readonly networkAttemptCount?: number;
}

export interface PdfTextObservation extends PdfTextReadBase {
  readonly kind: "observation";
  readonly completeness: "incomplete-text-only";
  readonly requiresInspection: true;
  readonly limits: Readonly<Record<string, number>>;
  readonly pages: readonly PdfPageTextObservation[];
  readonly networkAttemptCount: 0;
}

export interface PdfTextNoText extends PdfTextReadBase {
  readonly kind: "no-text";
  readonly code: "NO_EMBEDDED_TEXT";
  readonly completeness: "incomplete-text-only";
  readonly requiresInspection: true;
  readonly limits: Readonly<Record<string, number>>;
  readonly pages: readonly PdfPageTextObservation[];
  readonly networkAttemptCount: 0;
}

export interface PdfTextRejected extends PdfTextReadBase {
  readonly kind: "rejected";
  readonly code: PdfTextReaderErrorCode;
}

export type PdfTextReadResult = PdfTextObservation | PdfTextNoText | PdfTextRejected;

export interface PdfTextReaderOptions {
  /** Abort queued or running work; the running process is killed and reaped. */
  readonly signal?: AbortSignal;
  /** Wall deadline in milliseconds. Cannot exceed 20 seconds. */
  readonly timeoutMs?: number;
  /** A lower-only text cap; values above the reader's fixed cap are rejected. */
  readonly maxTextCodeUnits?: number;
  /** A lower-only child-output cap; values above the fixed cap are rejected. */
  readonly maxOutputBytes?: number;
  /** Receives completed zero-based page indexes, never page content. */
  readonly onPageComplete?: (pageIndex: number) => void;
}

export declare function readTextPdf(
  input: Uint8Array,
  options?: PdfTextReaderOptions,
): Promise<PdfTextReadResult>;

export declare const PDF_TEXT_READER_LIMITS: PdfTextReaderLimits;
