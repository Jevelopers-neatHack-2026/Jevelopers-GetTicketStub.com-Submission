export type RetrievalErrorCode =
  | "POLICY_DENIED"
  | "DNS_FAILURE"
  | "TRANSPORT_FAILURE"
  | "RESOURCE_LIMIT"
  | "REDIRECT_LIMIT"
  | "REQUEST_LIMIT"
  | "UNSUPPORTED_MEDIA"
  | "CANCELED"
  | "DEADLINE_EXCEEDED";

export declare class RetrievalError extends Error {
  readonly code: RetrievalErrorCode;
}

export declare const DEFAULT_RUN_LIMITS: Readonly<{
  requests: 30;
  redirectsPerFetch: 5;
  concurrentFetches: 4;
  connectMilliseconds: 10000;
  totalMilliseconds: 30000;
  compressedBytesPerRequest: 10485760;
  decodedTextBytesPerRequest: 20971520;
  decodedMediaBytesPerRequest: 10485760;
  decodedBytesPerRun: 104857600;
  imageMaximumDimension: 10000;
  imageMaximumPixels: 20000000;
}>;

export type SupportedContentType =
  | "text/html"
  | "application/xhtml+xml"
  | "text/plain"
  | "application/json"
  | "application/ld+json"
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif";

export interface ImageDimensions {
  readonly width: number;
  readonly height: number;
}

export interface RetrievedDocument {
  readonly url: string;
  readonly contentType: SupportedContentType;
  readonly bytes: Uint8Array;
  readonly fetchedAt: string;
  readonly redirects: number;
  readonly image?: ImageDimensions;
}

export interface FetchOptions {
  readonly signal?: AbortSignal;
}

/** Internal retrieval primitive; it does not implement the accepted Research API. */
export declare class SafeFetcher {
  constructor();
  fetch(input: string, options?: FetchOptions): Promise<RetrievedDocument>;
}

export { isPublicAddress, parseAndValidateUrl, sameAddress, validateHostname } from "./url-policy.mjs";
export { resolveSystemHost } from "./dns-resolver.mjs";
