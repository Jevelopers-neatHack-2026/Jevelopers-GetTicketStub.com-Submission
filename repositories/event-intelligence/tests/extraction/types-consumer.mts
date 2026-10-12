import type { RetrievedDocument } from "../../src/security/index.mjs";
import {
  extractDeterministically,
  type ExtractionCandidate,
  type ExtractionResult,
} from "../../src/extraction/index.mjs";

const source: RetrievedDocument = {
  url: "https://events.example.test/source",
  contentType: "text/html",
  bytes: new TextEncoder().encode("<p>Event details</p>"),
  fetchedAt: "2026-10-10T12:00:00.000Z",
  redirects: 0,
};

const extraction: Promise<ExtractionResult> = extractDeterministically(source, {
  limits: { maxDocumentBytes: 64 * 1024 },
});

function inspectCandidate(candidate: ExtractionCandidate): string {
  return `${candidate.normalizedValue ?? ""} @ ${candidate.source.locator.startByte}`;
}

void extraction.then((result) => result.visibleText.map(inspectCandidate));
