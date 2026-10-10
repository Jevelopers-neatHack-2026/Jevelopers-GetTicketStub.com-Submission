import { installPdfNetworkGuard } from "./network-guard.mjs";

const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CODE_UNITS = 100_000;

const requestedTextLimit = Number(process.argv[2] ?? MAX_TEXT_CODE_UNITS);
const requestedOutputLimit = Number(process.argv[3] ?? MAX_OUTPUT_BYTES);
const textLimit =
  Number.isInteger(requestedTextLimit) &&
  requestedTextLimit >= 1 &&
  requestedTextLimit <= MAX_TEXT_CODE_UNITS
    ? requestedTextLimit
    : null;
const outputLimit =
  Number.isInteger(requestedOutputLimit) &&
  requestedOutputLimit >= 4096 &&
  requestedOutputLimit <= MAX_OUTPUT_BYTES
    ? requestedOutputLimit
    : null;
let outputBytes = 0;
let outputStopped = false;

function writeLine(message) {
  if (outputStopped) return false;
  let line;
  try {
    line = `${JSON.stringify(message)}\n`;
  } catch {
    line = '{"kind":"error","code":"protocol_error"}\n';
  }
  const size = Buffer.byteLength(line, "utf8");
  if (size > outputLimit || outputBytes + size > outputLimit) {
    line = '{"kind":"error","code":"output_limit"}\n';
    outputStopped = true;
  }
  const actualSize = Buffer.byteLength(line, "utf8");
  if (outputBytes + actualSize > outputLimit) {
    outputStopped = true;
    return false;
  }
  outputBytes += actualSize;
  process.stdout.write(line);
  return !outputStopped;
}

function safeErrorCode(error) {
  if (error?.code === "PDF_EXTERNAL_RESOURCE_DENIED") return "remote_resource_attempt";
  if (typeof error?.code === "string" && /^[a-z_]{1,64}$/.test(error.code)) {
    return error.code;
  }
  return "decoder_failure";
}

async function readInput() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.byteLength;
    if (length > MAX_INPUT_BYTES) {
      return null;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length);
}

async function run() {
  const networkGuard = installPdfNetworkGuard();
  if (textLimit === null || outputLimit === null) {
    writeLine({ kind: "error", code: "invalid_limit", networkAttemptCount: 0 });
    return;
  }
  const bytes = await readInput();
  if (!bytes) {
    writeLine({ kind: "error", code: "input_limit", networkAttemptCount: networkGuard.attemptCount });
    return;
  }

  try {
    const { decodePdfBytesForWorker } = await import("./core.mjs");
    const decoded = await decodePdfBytesForWorker(bytes, {
      maxTextCodeUnits: textLimit,
      onPageComplete(pageIndex) {
        if (!writeLine({ kind: "progress", pageIndex })) {
          const error = new Error("PDF output limit exceeded");
          error.code = "output_limit";
          throw error;
        }
      },
    });
    if (networkGuard.attemptCount > 0) {
      writeLine({
        kind: "error",
        code: "remote_resource_attempt",
        networkAttemptCount: networkGuard.attemptCount,
      });
      return;
    }
    writeLine({
      kind: "result",
      decoderVersion: "6.4.299",
      configVersion: "ei-text-pdf/1",
      limits: {
        maxInputBytes: MAX_INPUT_BYTES,
        maxPages: 20,
        maxPagePoints: 14_400,
        maxTextCodeUnits: textLimit,
        maxTextItemCodeUnits: 20_000,
        maxTextItems: 2_000,
        maxOutputBytes: outputLimit,
        addressSpaceBytes: 6 * 1024 * 1024 * 1024,
        maxCpuSeconds: 15,
        maxWallMilliseconds: 20_000,
      },
      networkAttemptCount: 0,
      ...decoded,
    });
  } catch (error) {
    writeLine({
      kind: "error",
      code: safeErrorCode(error),
      networkAttemptCount: networkGuard.attemptCount,
    });
  }
}

await run();
