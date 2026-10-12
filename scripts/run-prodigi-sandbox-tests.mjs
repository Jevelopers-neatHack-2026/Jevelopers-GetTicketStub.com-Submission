import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Pinned case identity: a dropped, renamed, duplicated or reordered case fails the run.
export const PRODIGI_SANDBOX_SUITE_CASE_IDS = Object.freeze([
  "secrets.reads-env-per-call",
  "secrets.rejects-mode-provider-reference-and-values",
  "secrets.missing-credential-fails-closed",
  "secrets.live-bindings-refused",
  "secrets.sandbox-live-separation",
  "secrets.only-sandbox-binding-exported",
  "mapping.quote-body",
  "mapping.order-body",
  "gates.disabled-by-default",
  "gates.decision-unverified-or-mismatch",
  "gates.missing-credential",
  "quote.single-post-and-projection",
  "quote.tax-basis-reconciliation",
  "quote.method-selection-and-malformed",
  "quote.port-feeds-execute-private-quote",
  "order.create-pii-free",
  "order.read-stage-mapping",
  "failures.http-classification",
  "failures.timeout",
  "fetch-port.sandbox-only-no-redirect",
  "policy.adapter-requires-call-permitted-state",
  "dispatch.throwing-response-getter-after-send-is-unknown",
  "dispatch.signal-listener-failure-after-send-is-unknown",
  "abort.pre-aborted-signal-sends-nothing",
  "abort.signal-aborted-during-secret-resolution-sends-nothing",
  "order.optional-carrier-and-tracking-degrade-to-null",
  "fetch-port.bounds-body-while-streaming",
  "env.process-env-is-never-read",
  "smoke.refuses-without-owner-approval",
  "guard.blocks-fetch-http-https-net-and-tls"
]);

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const suiteFile = fileURLToPath(new URL("../tests/prodigi-sandbox-suite.mjs", import.meta.url));
const guardFile = fileURLToPath(new URL("../tests/prodigi-sandbox-network-guard.mjs", import.meta.url));
const caseSchema = "fulfillment-prodigi-sandbox-case-results/1";

function credentialFreeEnvironment() {
  const environment = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

/** Returns the list of problems with the child's report; empty means valid. */
export function validateProdigiSandboxReport(report) {
  const problems = [];
  if (report === null || typeof report !== "object" || Array.isArray(report)) return ["report_not_object"];
  if (report.schemaVersion !== caseSchema || report.suite !== "prodigi-sandbox") problems.push("schema_mismatch");
  if (report.guardInstalled !== true) problems.push("network_guard_not_installed");
  if (!Number.isSafeInteger(report.externalProviderCalls) || report.externalProviderCalls !== 0) problems.push("external_provider_calls_nonzero");
  if (!Array.isArray(report.cases)) return [...problems, "cases_missing"];
  const ids = report.cases.map((item) => item?.id);
  if (ids.length !== PRODIGI_SANDBOX_SUITE_CASE_IDS.length || ids.some((id, index) => id !== PRODIGI_SANDBOX_SUITE_CASE_IDS[index])) {
    problems.push("case_identity_mismatch");
  }
  const passed = report.cases.filter((item) => item?.status === "passed").length;
  const failed = report.cases.filter((item) => item?.status === "failed").length;
  if (passed + failed !== report.cases.length || report.passed !== passed || report.failed !== failed) problems.push("inconsistent_counts");
  return problems;
}

export function runProdigiSandboxTests({ spawn = spawnSync } = {}) {
  const child = spawn(process.execPath, ["--import", guardFile, suiteFile, "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    env: credentialFreeEnvironment()
  });
  const problems = [];
  if (child.error) problems.push(`spawn_failed:${typeof child.error.code === "string" ? child.error.code : "unknown"}`);
  if (child.signal) problems.push(`child_signaled:${child.signal}`);
  if (typeof child.stderr === "string" && child.stderr.length > 0) problems.push("stderr_present");
  const lines = String(child.stdout ?? "").split("\n").filter((line) => line.length > 0);
  let report = null;
  if (lines.length !== 1) {
    problems.push("invalid_suite_output");
  } else {
    try {
      report = JSON.parse(lines[0]);
    } catch {
      problems.push("invalid_suite_output");
    }
  }
  if (report !== null) problems.push(...validateProdigiSandboxReport(report));
  const cases = Array.isArray(report?.cases) ? report.cases : [];
  const anyFailed = cases.some((item) => item?.status !== "passed");
  if (child.status !== (anyFailed ? 1 : 0)) problems.push(`unexpected_exit:${child.status}`);
  return {
    cases,
    problems,
    externalProviderCalls: Number.isSafeInteger(report?.externalProviderCalls) ? report.externalProviderCalls : null,
    passed: problems.length === 0 && !anyFailed
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runProdigiSandboxTests();
  for (const item of result.cases) {
    process.stdout.write(`${String(item?.status).toUpperCase()} ${item?.id}${item?.detail ? `: ${item.detail}` : ""}\n`);
  }
  for (const problem of result.problems) process.stdout.write(`FAILED runner: ${problem}\n`);
  const passedCount = result.cases.filter((item) => item?.status === "passed").length;
  process.stdout.write(`Prodigi sandbox adapter suite: ${passedCount}/${PRODIGI_SANDBOX_SUITE_CASE_IDS.length} passed ` +
    `(externalProviderCalls: ${result.externalProviderCalls ?? "unmeasured"}, measured by network guard)\n`);
  if (!result.passed) process.exitCode = 1;
}
