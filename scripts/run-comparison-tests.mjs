import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptFile = fileURLToPath(new URL("../tests/comparison-suite.mjs", import.meta.url));

export function parseComparisonOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
  const results = [];
  const summaries = [];
  const unrecognized = [];

  for (const line of lines) {
    const resultMatch = /^(PASSED|FAILED) (.+)$/u.exec(line);
    if (resultMatch !== null) {
      const status = resultMatch[1].toLowerCase();
      const payload = resultMatch[2];
      const separator = status === "failed" ? payload.indexOf(": ") : -1;
      results.push({
        name: separator < 0 ? payload : payload.slice(0, separator),
        status,
        ...(separator < 0 ? {} : { detail: payload.slice(separator + 2) })
      });
      continue;
    }

    const summaryMatch = /^Private comparison suite: (\d+)\/(\d+) passed$/u.exec(line);
    if (summaryMatch !== null) {
      summaries.push({ passed: Number(summaryMatch[1]), total: Number(summaryMatch[2]) });
      continue;
    }
    unrecognized.push(line);
  }

  const summary = summaries.length === 1 ? summaries[0] : null;
  const names = new Set();
  let duplicateNames = false;
  for (const result of results) {
    if (names.has(result.name)) duplicateNames = true;
    names.add(result.name);
  }
  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  const valid = summary !== null && results.length > 0 && !duplicateNames && unrecognized.length === 0 &&
    summary.total === results.length && summary.passed === passed && summary.total - summary.passed === failed;

  return { results, summary, valid, duplicateNames, unrecognized };
}

export function runComparisonTests({ spawn = spawnSync } = {}) {
  const child = spawn(process.execPath, [scriptFile], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  const parsed = parseComparisonOutput(child.stdout);
  const results = [...parsed.results];
  const processError = child.error?.code ?? null;
  const stderrPresent = String(child.stderr ?? "").length > 0;

  if (!parsed.valid) {
    results.push({
      name: "comparison suite output validation",
      status: "failed",
      detail: parsed.duplicateNames
        ? "duplicate_test_name"
        : parsed.summary === null
          ? "missing_or_duplicate_summary"
          : parsed.unrecognized.length > 0
            ? "unexpected_output"
            : "summary_count_mismatch",
      ...(parsed.unrecognized.length === 0 ? {} : { output: parsed.unrecognized.join("\n").slice(0, 2_048) })
    });
  }

  if ((child.error !== undefined || child.status !== 0) && results.every((result) => result.status === "passed")) {
    results.push({
      name: "comparison suite process exit",
      status: "failed",
      detail: processError ?? `exit_${child.status ?? "unknown"}`
    });
  }
  if (stderrPresent) {
    results.push({
      name: "comparison suite stderr",
      status: "failed",
      detail: processError ?? "unexpected_stderr",
      output: String(child.stderr ?? "").slice(0, 2_048)
    });
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  const failureReasons = [];
  if (!parsed.valid) failureReasons.push("comparison_suite_output_invalid");
  if (child.error !== undefined) failureReasons.push(processError ?? "comparison_suite_process_error");
  if (child.status !== 0) failureReasons.push(`comparison_suite_process_exit_${child.status ?? "unknown"}`);
  if (stderrPresent) failureReasons.push("comparison_suite_unexpected_stderr");
  if (parsed.results.some((result) => result.status === "failed")) failureReasons.push("comparison_assertions_failed");

  return {
    schemaVersion: "fulfillment-comparison-suite-result/1",
    suite: "comparison",
    mode: "simulated",
    billing_mode: "simulated",
    status: failureReasons.length === 0 && failed === 0 ? "passed" : "failed",
    passed,
    failed,
    results,
    summary: parsed.summary,
    failureReasons,
    processExitCode: child.status ?? null,
    processSignal: child.signal ?? null,
    processError,
    stderrPresent,
    ...(parsed.valid ? {} : { processStdout: String(child.stdout ?? "").slice(0, 4_096) }),
    externalProviderCalls: 0,
    quoteCalls: 0,
    orderCalls: 0,
    financeCalls: 0
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runComparisonTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
