import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteFile = fileURLToPath(new URL("../tests/prodigi-product-details-suite.mjs", import.meta.url));
export const PRODIGI_PRODUCT_DETAILS_SUITE_CASE_COUNT = 15;

function credentialFreeEnvironment() {
  const environment = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

export function parseProdigiProductDetailsOutput(stdout) {
  if (typeof stdout !== "string" || !stdout.endsWith("\n") || stdout.includes("\r")) {
    return { results: [], valid: false, unrecognizedCount: stdout === "" ? 0 : 1 };
  }

  const lines = stdout.slice(0, -1).split("\n");
  const results = [];
  const names = new Set();
  let summary = null;
  let unrecognizedCount = 0;

  for (const [index, line] of lines.entries()) {
    if (line.length === 0 || line !== line.trim()) {
      unrecognizedCount += 1;
      continue;
    }
    const passMatch = /^PASS (.+)$/u.exec(line);
    const failMatch = /^FAIL (.+): (.+)$/u.exec(line);
    if ((passMatch !== null || failMatch !== null) && summary === null) {
      const name = passMatch?.[1] ?? failMatch?.[1];
      if (name === undefined || name.length > 240 || names.has(name)) {
        unrecognizedCount += 1;
        continue;
      }
      names.add(name);
      results.push({
        name,
        status: passMatch === null ? "failed" : "passed",
        ...(failMatch === null ? {} : { detail: failMatch[2] })
      });
      continue;
    }
    const summaryMatch = /^RESULT (\d+)\/(\d+)$/u.exec(line);
    if (summaryMatch !== null && index === lines.length - 1 && summary === null) {
      summary = { passed: Number(summaryMatch[1]), total: Number(summaryMatch[2]) };
      continue;
    }
    unrecognizedCount += 1;
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  const valid = summary !== null && unrecognizedCount === 0 &&
    results.length === PRODIGI_PRODUCT_DETAILS_SUITE_CASE_COUNT &&
    summary.total === PRODIGI_PRODUCT_DETAILS_SUITE_CASE_COUNT &&
    summary.total === results.length && summary.passed === passed && summary.total - summary.passed === failed;
  return { results, summary, valid, unrecognizedCount };
}

export function runProdigiProductDetailsTests({ spawn = spawnSync } = {}) {
  let child;
  try {
    child = spawn(process.execPath, [suiteFile], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      env: credentialFreeEnvironment()
    });
  } catch (error) {
    child = {
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      error: { code: error !== null && typeof error === "object" && "code" in error ? error.code : "spawn_failed" }
    };
  }
  if (child === null || typeof child !== "object") {
    child = { stdout: "", stderr: "", status: null, signal: null, error: { code: "invalid_spawn_result" } };
  }

  const parsed = parseProdigiProductDetailsOutput(child.stdout);
  const results = [...parsed.results];
  const processError = child.error?.code ?? null;
  if (!parsed.valid) {
    results.push({
      name: "Product Details suite output validation",
      status: "failed",
      detail: processError ?? `invalid_suite_output_${parsed.unrecognizedCount}`
    });
  }
  if ((child.error !== undefined || child.status !== 0 || (child.signal !== null && child.signal !== undefined)) &&
    results.every((result) => result.status === "passed")) {
    results.push({
      name: "Product Details suite process exit",
      status: "failed",
      detail: processError ?? (child.signal !== null && child.signal !== undefined
        ? `signal_${child.signal}` : `exit_${child.status ?? "unknown"}`)
    });
  }
  const stderrPresent = typeof child.stderr !== "string" || child.stderr.length > 0;
  if (stderrPresent && results.every((result) => result.name !== "Product Details suite stderr")) {
    results.push({ name: "Product Details suite stderr", status: "failed", detail: "stderr_present" });
  }

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.length - passed;
  return {
    schemaVersion: "fulfillment-prodigi-product-details-suite-result/1",
    suite: "prodigi-product-details",
    mode: "simulated",
    status: failed === 0 && child.error === undefined && child.status === 0 &&
      (child.signal === null || child.signal === undefined) && !stderrPresent ? "passed" : "failed",
    passed,
    failed,
    results,
    processExitCode: child.status ?? null,
    processSignal: child.signal ?? null,
    processError,
    stderrPresent,
    ...(parsed.valid ? {} : { processStdout: String(child.stdout ?? "").slice(0, 4_096) }),
    externalProviderCalls: 0,
    orderCalls: 0,
    financeCalls: 0,
    sandboxReady: false,
    liveEnabled: false,
    releaseReady: false,
    skipped: 0
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runProdigiProductDetailsTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
