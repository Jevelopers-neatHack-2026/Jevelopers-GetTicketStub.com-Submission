import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ORDER_AUTHORIZATION_SUITE_CASE_IDS = Object.freeze([
  "vector.consumer-signature-and-lookup-body-match-fixture-vector",
  "happy.claim-then-revalidate-signs-exact-bytes-and-binds-local-action-id",
  "identity.claim-key-and-action-id-match-the-producer-formulas",
  "terms.envelope-terms-and-tampered-token-are-ignored-and-issuer-rejects",
  "terms.each-missing-or-invalid-binding-is-rejected-without-http",
  "terms.non-fixture-provenance-and-source-failures-are-rejected-without-http",
  "terms.local-quote-amount-and-currency-mismatch-is-rejected-without-http",
  "revalidate.lookup-hit-still-revalidates-under-connector-terms",
  "revalidate.replayed-claim-still-revalidates",
  "revalidate.action-id-mismatch-is-rejected-before-revalidate",
  "ambiguous.lost-response-reconciles-through-lookup-with-one-key",
  "ambiguous.lookup-not-found-retries-once-with-the-same-key",
  "ambiguous.authorization-claimed-under-another-key-is-rejected",
  "ambiguous.second-ambiguity-throws-without-minting-a-new-key",
  "ambiguous.claim-failure-classification-and-timeout",
  "timeouts.revalidate-and-lookup-time-out-abort-and-throw",
  "key.is-deterministic-and-excludes-token-delivery-key-fingerprint-and-secret",
  "key.differs-by-order-tenant-project-provider-and-mode",
  "key.signing-key-rotation-after-lost-committed-response-replays-instead-of-stranding",
  "runtime.healthy-submit-revalidates-after-claim-and-before-the-single-dispatch",
  "runtime.lapse-during-budget-sends-nothing-and-is-stale-authorization",
  "runtime.lapse-while-dispatching-metering-is-awaited-sends-nothing-and-keeps-evidence",
  "runtime.revalidate-failure-or-malformed-answer-is-authorization-unavailable",
  "runtime.adapter-retry-revalidates-before-every-transport-request",
  "runtime.verifiers-without-the-method-behave-as-before",
  "runtime.twelve-delivery-keys-make-one-issuer-claim-and-one-dispatch",
  "responses.every-known-rejection-reason-is-rejected-for-claim-and-revalidate",
  "responses.unsafe-statuses-malformed-bodies-and-unknown-reasons-throw",
  "modes.sandbox-live-prodigi-unmapped-provider-and-cancel-are-refused-before-http",
  "records.fixture-live-mode-environment-audience-provider-and-expiry-are-rejected",
  "responses.revalidate-field-bindings-reject-each-mismatch-and-accept-canonical-equality",
  "signer.refuses-short-and-fixture-keys-and-leases-the-key-on-every-request",
  "redaction.errors-results-and-requests-never-expose-secrets-or-addresses",
  "bindings.no-accepted-binding-is-forged-and-sandbox-gates-are-untouched",
  "provenance.vendored-fixture-hashes-equal-provenance-and-pins",
  "runner.output-parser-rejects-malformed-and-inconsistent-reports",
  "runner.report-validator-and-process-control-reject-unsafe-reports"
]);

export const ORDER_AUTHORIZATION_SUITE_CASE_COUNT = ORDER_AUTHORIZATION_SUITE_CASE_IDS.length;

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const suiteFile = fileURLToPath(new URL("../tests/order-authorization-suite.mjs", import.meta.url));
const caseSchema = "fulfillment-order-authorization-case-results/1";
const reportSchema = "fulfillment-order-authorization-suite-result/1";
const outputFailureId = "runner.output-validation";
const processFailureId = "runner.process-exit";
const stderrFailureId = "runner.stderr";

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

export function parseOrderAuthorizationOutput(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0 || !stdout.endsWith("\n") || stdout.includes("\r")) {
    return { valid: false, cases: [] };
  }
  let report;
  try {
    report = JSON.parse(stdout.slice(0, -1));
  } catch {
    return { valid: false, cases: [] };
  }
  const reportKeys = ["schemaVersion", "suite", "caseCount", "passed", "failed", "skipped", "cases"];
  if (!exactKeys(report, reportKeys) || report.schemaVersion !== caseSchema || report.suite !== "order-authorization" ||
    report.caseCount !== ORDER_AUTHORIZATION_SUITE_CASE_COUNT || !Number.isSafeInteger(report.passed) ||
    !Number.isSafeInteger(report.failed) || report.skipped !== 0 || !Array.isArray(report.cases) ||
    report.passed < 0 || report.failed < 0 || report.passed + report.failed !== report.cases.length ||
    report.cases.length !== ORDER_AUTHORIZATION_SUITE_CASE_COUNT) return { valid: false, cases: [] };

  const cases = [];
  const seen = new Set();
  for (let index = 0; index < report.cases.length; index += 1) {
    const item = report.cases[index];
    const validStatus = item?.status === "passed"
      ? exactKeys(item, ["id", "status"])
      : item?.status === "failed" && exactKeys(item, ["id", "status", "detail"]) &&
        ["assertion_failed", "case_execution_failed"].includes(item.detail);
    if (!validStatus || item.id !== ORDER_AUTHORIZATION_SUITE_CASE_IDS[index] ||
      !["passed", "failed"].includes(item.status) || seen.has(item.id)) return { valid: false, cases: [] };
    seen.add(item.id);
    cases.push({ name: item.id, status: item.status, ...(item.status === "failed" ? { detail: item.detail } : {}) });
  }
  if (seen.size !== ORDER_AUTHORIZATION_SUITE_CASE_COUNT ||
    report.passed !== report.cases.filter((item) => item.status === "passed").length ||
    report.failed !== report.cases.filter((item) => item.status === "failed").length) {
    return { valid: false, cases: [] };
  }
  return { valid: true, cases };
}

export function validOrderAuthorizationRunnerReport(report) {
  const reportKeys = ["schemaVersion", "suite", "mode", "status", "passed", "failed", "results",
    "processExitCode", "processSignal", "processError", "stderrPresent", "externalProviderCalls",
    "orderCalls", "financeCalls", "sandboxReady", "liveEnabled", "releaseReady", "skipped"];
  if (!exactKeys(report, reportKeys) || report.schemaVersion !== reportSchema || report.suite !== "order-authorization" ||
    report.mode !== "simulated" || !["passed", "failed"].includes(report.status) ||
    !Number.isSafeInteger(report.passed) || !Number.isSafeInteger(report.failed) || !Array.isArray(report.results) ||
    report.passed < 0 || report.failed < 0 || report.passed + report.failed !== report.results.length ||
    ((!Number.isSafeInteger(report.processExitCode) || report.processExitCode < 0 || report.processExitCode > 255) && report.processExitCode !== null) ||
    (report.processSignal !== null && (typeof report.processSignal !== "string" || !/^SIG[A-Z0-9]{1,32}$/u.test(report.processSignal))) ||
    (report.processError !== null && (typeof report.processError !== "string" || !/^[A-Z][A-Z0-9_]{0,39}$/u.test(report.processError))) ||
    typeof report.stderrPresent !== "boolean" || report.externalProviderCalls !== 0 || report.orderCalls !== 0 ||
    report.financeCalls !== 0 || report.sandboxReady !== false || report.liveEnabled !== false ||
    report.releaseReady !== false || report.skipped !== 0) return false;

  const names = new Set();
  for (const item of report.results) {
    if (item === null || typeof item !== "object" || Array.isArray(item) ||
      !["passed", "failed"].includes(item.status) || typeof item.name !== "string" || names.has(item.name)) return false;
    if (item.status === "passed" && !exactKeys(item, ["name", "status"])) return false;
    if (item.status === "failed" && (!exactKeys(item, ["name", "status", "detail"]) || typeof item.detail !== "string")) return false;
    names.add(item.name);
  }
  if (report.passed !== report.results.filter((item) => item.status === "passed").length ||
    report.failed !== report.results.filter((item) => item.status === "failed").length ||
    report.status !== (report.failed === 0 ? "passed" : "failed")) return false;

  const ordinary = report.results.filter((item) => ![outputFailureId, processFailureId, stderrFailureId].includes(item.name));
  const ordinaryNames = ordinary.map((item) => item.name);
  const validOrdinaryPrefix = ordinaryNames.length === ORDER_AUTHORIZATION_SUITE_CASE_COUNT &&
    ordinaryNames.every((name, index) => name === ORDER_AUTHORIZATION_SUITE_CASE_IDS[index]) &&
    ordinary.every((item) => item.status === "passed" ||
      ["assertion_failed", "case_execution_failed"].includes(item.detail));
  if (report.status === "passed") {
    return validOrdinaryPrefix && ordinary.every((item) => item.status === "passed") &&
      report.results.length === ORDER_AUTHORIZATION_SUITE_CASE_COUNT &&
      report.processExitCode === 0 && report.processSignal === null && report.processError === null &&
      report.stderrPresent === false;
  }

  const special = report.results.filter((item) => [outputFailureId, processFailureId, stderrFailureId].includes(item.name));
  if (special.some((item) => item.status !== "failed")) return false;
  const allowedDetails = new Map([
    [outputFailureId, new Set(["invalid_suite_output", "runner_report_invalid"])],
    [processFailureId, new Set(["ENOENT", "EACCES", "spawn_failed", "invalid_spawn_result", "child_signaled",
      "child_exit_nonzero_or_unknown", "suite_failed_exit_success"])],
    [stderrFailureId, new Set(["stderr_present"])]
  ]);
  if (special.some((item) => item.name === processFailureId
    ? !allowedDetails.get(item.name)?.has(item.detail) && item.detail !== report.processError
    : !allowedDetails.get(item.name)?.has(item.detail))) return false;
  if (ordinary.length !== 0 && !validOrdinaryPrefix) return false;
  if (special.some((item) => item.name === outputFailureId) && ordinary.length !== 0) return false;
  if (report.stderrPresent !== special.some((item) => item.name === stderrFailureId)) return false;
  if ((report.processError !== null || report.processSignal !== null ||
    (report.processExitCode !== null && report.processExitCode !== 0)) &&
    !special.some((item) => item.name === processFailureId)) return false;
  if (ordinary.some((item) => item.status === "failed") && report.processExitCode === 0 &&
    !special.some((item) => item.name === processFailureId && item.detail === "suite_failed_exit_success")) return false;
  if (special.length === 0 && !ordinary.some((item) => item.status === "failed")) return false;
  if (report.processExitCode === 0 && report.processSignal === null && report.processError === null &&
    !report.stderrPresent && !special.some((item) => item.name === outputFailureId)) return false;
  return true;
}

function credentialFreeEnvironment() {
  const environment = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

function safeProcessError(error) {
  const code = error !== null && typeof error === "object" && typeof error.code === "string" ? error.code : "";
  return /^[A-Z][A-Z0-9_]{0,39}$/u.test(code) ? code : "spawn_failed";
}

export function runOrderAuthorizationTests({ spawn = spawnSync } = {}) {
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
    child = { stdout: "", stderr: "", status: null, signal: null, error: { code: safeProcessError(error) } };
  }
  if (child === null || typeof child !== "object") {
    child = { stdout: "", stderr: "", status: null, signal: null, error: { code: "invalid_spawn_result" } };
  }

  const parsed = parseOrderAuthorizationOutput(child.stdout);
  const processError = child.error === undefined ? null : safeProcessError(child.error);
  const rawSignal = child.signal;
  const processSignal = rawSignal === null || rawSignal === undefined
    ? null
    : typeof rawSignal === "string" && /^SIG[A-Z0-9]{1,32}$/u.test(rawSignal) ? rawSignal : "SIGUNKNOWN";
  const processExitCode = Number.isSafeInteger(child.status) && child.status >= 0 && child.status <= 255 ? child.status : null;
  const stderrPresent = typeof child.stderr !== "string" || child.stderr.length !== 0;
  const results = parsed.valid ? [...parsed.cases] : [];
  if (!parsed.valid) results.push({ name: outputFailureId, status: "failed", detail: "invalid_suite_output" });
  if ((processError !== null || processExitCode !== 0 || processSignal !== null) &&
    !results.some((item) => item.name === processFailureId)) {
    results.push({
      name: processFailureId,
      status: "failed",
      detail: processError ?? (processSignal !== null ? "child_signaled" : "child_exit_nonzero_or_unknown")
    });
  }
  if (stderrPresent) results.push({ name: stderrFailureId, status: "failed", detail: "stderr_present" });
  if (parsed.valid && parsed.cases.some((item) => item.status === "failed") && processExitCode === 0 &&
    processError === null && processSignal === null) {
    results.push({ name: processFailureId, status: "failed", detail: "suite_failed_exit_success" });
  }
  const passed = results.filter((item) => item.status === "passed").length;
  const failed = results.length - passed;
  const report = {
    schemaVersion: reportSchema,
    suite: "order-authorization",
    mode: "simulated",
    status: failed === 0 && processError === null && processExitCode === 0 && processSignal === null && !stderrPresent
      ? "passed" : "failed",
    passed,
    failed,
    results,
    processExitCode,
    processSignal,
    processError,
    stderrPresent,
    externalProviderCalls: 0,
    orderCalls: 0,
    financeCalls: 0,
    sandboxReady: false,
    liveEnabled: false,
    releaseReady: false,
    skipped: 0
  };
  return validOrderAuthorizationRunnerReport(report)
    ? report
    : {
      ...report,
      status: "failed",
      results: [{ name: outputFailureId, status: "failed", detail: "runner_report_invalid" }],
      passed: 0,
      failed: 1
    };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runOrderAuthorizationTests();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.status !== "passed") process.exitCode = 1;
}
