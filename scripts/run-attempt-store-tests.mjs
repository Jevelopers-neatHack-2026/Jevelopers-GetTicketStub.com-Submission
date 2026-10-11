import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseSuiteOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return { report: null, reason: lines.length === 0 ? "missing_suite_output" : "duplicate_or_unexpected_suite_output" };
  try {
    const report = JSON.parse(lines[0]);
    if (report === null || typeof report !== "object" || Array.isArray(report) ||
      report.schemaVersion !== "fulfillment-attempt-store-suite/1" || report.suite !== "attempt-store" ||
      report.mode !== "simulated" || report.billing_mode !== "simulated" ||
      report.externalProviderCalls !== 0 || typeof report.networkDeniedByOs !== "boolean" ||
      !Array.isArray(report.results) || report.results.length === 0 ||
      !Number.isSafeInteger(report.passed) || !Number.isSafeInteger(report.failed) ||
      (report.status !== "passed" && report.status !== "failed")) {
      return { report: null, reason: "malformed_suite_report" };
    }
    const names = new Set();
    let passed = 0;
    let failed = 0;
    for (const result of report.results) {
      if (result === null || typeof result !== "object" || Array.isArray(result) ||
        typeof result.name !== "string" || result.name.length === 0 ||
        (result.status !== "passed" && result.status !== "failed") || names.has(result.name)) {
        return { report: null, reason: "malformed_or_duplicate_test_results" };
      }
      names.add(result.name);
      if (result.status === "passed") passed += 1;
      else failed += 1;
    }
    if (report.passed !== passed || report.failed !== failed ||
      report.status !== (failed === 0 ? "passed" : "failed")) {
      return { report: null, reason: "inconsistent_suite_counts" };
    }
    return { report, reason: null };
  } catch {
    return { report: null, reason: "malformed_suite_json" };
  }
}

export function runAttemptStoreTests({ spawn = spawnSync } = {}) {
  const child = spawn(process.execPath, ["tests/attempt-store-suite.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  const parsed = parseSuiteOutput(child.stdout);
  let report = parsed.report ?? {
    schemaVersion: "fulfillment-attempt-store-runner-result/1",
    suite: "attempt-store",
    mode: "simulated",
    billing_mode: "simulated",
    status: "failed",
    passed: 0,
    failed: 1,
    results: [{ name: "attempt store suite process", status: "failed", message: child.error?.code ?? parsed.reason }],
    externalProviderCalls: 0
  };

  if (parsed.report !== null && (child.error !== undefined || child.status !== 0)) {
    report = {
      ...report,
      status: "failed",
      failed: report.failed + 1,
      results: [...report.results, {
        name: "attempt store suite process exit",
        status: "failed",
        message: child.error?.code ?? `exit_${child.status ?? "unknown"}`
      }]
    };
  }

  return {
    ...report,
    status: child.error === undefined && child.status === 0 && parsed.report !== null && report.status === "passed"
      ? "passed"
      : "failed",
    processExitCode: child.status ?? null,
    processSignal: child.signal ?? null,
    processError: child.error?.code ?? null,
    stderrPresent: String(child.stderr ?? "").length > 0,
    ...(parsed.report === null ? { processStdout: String(child.stdout ?? "").slice(0, 4096) } : {}),
    externalProviderCalls: 0
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runAttemptStoreTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
