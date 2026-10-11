import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function runMockTests() {
  const child = spawnSync(process.execPath, ["tests/mock-suite.mjs"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env
  });
  const lines = (child.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  let report;
  try {
    report = JSON.parse(lines.at(-1));
    if (report.schemaVersion !== "fulfillment-mock-suite-result/1" || report.suite !== "mock" || !Array.isArray(report.results)) {
      throw new TypeError("invalid mock suite report");
    }
  } catch {
    report = {
      schemaVersion: "fulfillment-mock-suite-result/1",
      suite: "mock",
      mode: "simulated",
      billing_mode: "simulated",
      status: "failed",
      passed: 0,
      failed: 1,
      results: [{ id: "mock suite process", status: "failed", message: child.error?.code ?? "invalid_suite_output" }]
    };
  }
  if (child.error !== undefined || child.status !== 0) {
    report = {
      ...report,
      status: "failed",
      failed: Math.max(1, Number.isSafeInteger(report.failed) ? report.failed : 0),
      processExitCode: child.status,
      processError: child.error?.code ?? null,
      stderrPresent: (child.stderr ?? "").length > 0
    };
  }
  return { ...report, externalProviderCalls: 0 };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runMockTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
