import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptFile = fileURLToPath(new URL("../tests/quote-suite.mjs", import.meta.url));

function parseQuoteOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
  const results = [];
  const summaries = [];
  const unrecognized = [];

  for (const line of lines) {
    const resultMatch = /^(PASSED|FAILED) (.+)$/u.exec(line);
    if (resultMatch !== null) {
      const status = resultMatch[1].toLowerCase();
      const payload = resultMatch[2];
      const detailSeparator = status === "failed" ? payload.indexOf(": ") : -1;
      results.push({
        name: detailSeparator < 0 ? payload : payload.slice(0, detailSeparator),
        status,
        ...(detailSeparator < 0 ? {} : { detail: payload.slice(detailSeparator + 2) })
      });
      continue;
    }

    const summaryMatch = /^Quote normalization suite: (\d+)\/(\d+) passed$/u.exec(line);
    if (summaryMatch !== null) {
      summaries.push({ passed: Number(summaryMatch[1]), total: Number(summaryMatch[2]) });
      continue;
    }
    unrecognized.push(line);
  }

  const summary = summaries.length === 1 ? summaries[0] : null;
  const observedPassed = results.filter((result) => result.status === "passed").length;
  const observedFailed = results.length - observedPassed;
  const valid = summary !== null && results.length > 0 && unrecognized.length === 0 &&
    summary.total === results.length && summary.passed === observedPassed && summary.total - summary.passed === observedFailed;

  return { results, valid, unrecognized };
}

export function runQuoteTests({ spawn = spawnSync } = {}) {
  const child = spawn(process.execPath, [scriptFile], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  const parsed = parseQuoteOutput(child.stdout);
  let results = parsed.results;

  if (!parsed.valid) {
    results = [
      ...results,
      {
        name: "quote suite process",
        status: "failed",
        detail: child.error?.code ?? "invalid_suite_output",
        ...(parsed.unrecognized.length === 0 ? {} : { output: parsed.unrecognized.join("\n").slice(0, 2048) })
      }
    ];
  }

  const processError = child.error?.code ?? null;
  if (child.error !== undefined || child.status !== 0) {
    if (results.every((result) => result.status === "passed")) {
      results = [...results, {
        name: "quote suite process exit",
        status: "failed",
        detail: processError ?? `exit_${child.status ?? "unknown"}`
      }];
    }
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  return {
    schemaVersion: "fulfillment-quote-suite-result/1",
    suite: "quote",
    mode: "simulated",
    billing_mode: "simulated",
    status: failed === 0 && child.error === undefined && child.status === 0 ? "passed" : "failed",
    passed,
    failed,
    results,
    processExitCode: child.status ?? null,
    processSignal: child.signal ?? null,
    processError,
    stderrPresent: String(child.stderr ?? "").length > 0,
    ...(parsed.valid ? {} : { processStdout: String(child.stdout ?? "").slice(0, 4096) }),
    externalProviderCalls: 0,
    orderCalls: 0
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runQuoteTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
