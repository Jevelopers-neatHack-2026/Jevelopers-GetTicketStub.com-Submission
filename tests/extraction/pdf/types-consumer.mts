import {
  PDF_TEXT_READER_LIMITS,
  readTextPdf,
  type PdfTextBox,
  type PdfTextReadResult,
} from "../../../src/extraction/pdf/index.mjs";

const controller = new AbortController();
const read: Promise<PdfTextReadResult> = readTextPdf(new Uint8Array(), {
  signal: controller.signal,
  timeoutMs: 20_000,
  maxTextCodeUnits: 1_000,
  maxOutputBytes: 4_096,
  onPageComplete(pageIndex) {
    const page: number = pageIndex;
    void page;
  },
});

const pages: number = PDF_TEXT_READER_LIMITS.maxPages;
function consumeBox(box: PdfTextBox): string {
  return `${box.text} @ ${box.x},${box.y}`;
}

async function consume(result: PdfTextReadResult): Promise<void> {
  if (result.kind === "observation") {
    const lines: string[] = result.pages.flatMap((page) => page.textBoxes.map(consumeBox));
    const completeness: "incomplete-text-only" = result.completeness;
    void lines;
    void completeness;
    // @ts-expect-error PDF text observations do not invent original byte offsets.
    void result.pages[0].textBoxes[0].sourceByteStart;
  } else if (result.kind === "no-text") {
    const code: "NO_EMBEDDED_TEXT" = result.code;
    const completeness: "incomplete-text-only" = result.completeness;
    void code;
    void completeness;
  } else {
    const code: string = result.code;
    void code;
  }
}

void read.then(consume);
void pages;
