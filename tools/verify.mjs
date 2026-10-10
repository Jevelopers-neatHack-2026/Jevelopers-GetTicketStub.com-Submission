import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { finished } from "node:stream/promises";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = Object.freeze({
  "safe-retrieval": ["tests/security"],
  "content-privacy": ["tests/privacy", "tests/security/injection"],
  evals: ["tests/evals"],
  "research-api": ["tests/api"],
  "verify-runner": ["tests/runner"],
});

function optionsFromCli(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const match = current.match(/^--(case|mode)=(.+)$/);
    if (match) parsed[match[1]] = match[2];
    else if (current === "--case" || current === "--mode") parsed[current.slice(2)] = args[++index];
    else throw new Error("Unknown verification option");
  }
  return { caseName: parsed.case ?? process.env.CASE, mode: parsed.mode ?? process.env.MODE };
}

async function collectTestFiles(relativeDirectories) {
  const files = [];
  async function visit(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith(".test.mjs")) files.push(full);
    }
  }
  for (const directory of relativeDirectories) await visit(path.join(ROOT, directory));
  return [...new Set(files)].sort();
}

function safeConfigString(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1_024;
}

async function hasReleaseConfigShape() {
  const configuredPath = process.env.EVENT_INTELLIGENCE_LIVE_CONFIG;
  if (!configuredPath) return false;
  const resolvedPath = path.resolve(configuredPath);
  let configuration;
  try {
    const metadata = await stat(resolvedPath);
    if (!metadata.isFile() || metadata.size > 8_192) return false;
    const handle = await open(resolvedPath, "r");
    try {
      const bytes = Buffer.alloc(8_193);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== metadata.size || bytesRead > 8_192) return false;
      configuration = JSON.parse(bytes.subarray(0, bytesRead).toString("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return false;
  const expiry = typeof configuration.expires_at === "string" ? Date.parse(configuration.expires_at) : NaN;
  return safeConfigString(configuration.release_manifest)
    && safeConfigString(configuration.budget_authorization)
    && Number.isFinite(expiry)
    && expiry > Date.now();
}

export function evaluateCompletion(aggregate, enqueued) {
  const counts = aggregate?.counts;
  const terminal = counts
    ? counts.passed + counts.failed + counts.skipped + counts.todo + counts.cancelled
    : 0;
  const complete = Boolean(counts)
    && aggregate.success === true
    && enqueued > 0
    && enqueued === terminal
    && counts.failed === 0
    && counts.skipped === 0
    && counts.todo === 0
    && counts.cancelled === 0;
  return Object.freeze({ complete, terminal, counts });
}

function printSummary(summary) {
  process.stdout.write(`VERIFY_SUMMARY_JSON=${JSON.stringify(summary)}\n`);
  process.exitCode = summary.exit_code;
}

async function executeMock(caseName, directories) {
  const files = await collectTestFiles(directories);
  if (files.length === 0) {
    printSummary({
      case: caseName,
      mode: "mock",
      status: "failed",
      exit_code: 1,
      test_files: 0,
      expected_cases: 0,
      terminal_cases: 0,
      passed_cases: 0,
      failed_cases: 0,
      skipped_cases: 0,
      todo_cases: 0,
      cancelled_cases: 0,
      fixture_scope: "local controlled fixtures only",
      external_egress: "not measured",
      provider_activity: "none",
      reason: "no test files were collected",
    });
    return;
  }

  const testStream = run({ files, concurrency: 1, isolation: "process", cwd: ROOT });
  let aggregate;
  let enqueued = 0;
  testStream.on("test:enqueue", (data) => {
    if (data.type === "test") enqueued += 1;
  });
  testStream.on("test:summary", (data) => {
    if (data.file === undefined) aggregate = data;
  });
  const report = testStream.compose(spec);
  const reportFinished = finished(report);
  report.pipe(process.stdout, { end: false });
  await reportFinished;
  const { complete, terminal, counts } = evaluateCompletion(aggregate, enqueued);
  printSummary({
    case: caseName,
    mode: "mock",
    status: complete ? "passed" : "failed",
    exit_code: complete ? 0 : 1,
    test_files: files.length,
    expected_cases: enqueued,
    terminal_cases: terminal,
    passed_cases: counts?.passed ?? 0,
    failed_cases: counts?.failed ?? 0,
    skipped_cases: counts?.skipped ?? 0,
    todo_cases: counts?.todo ?? 0,
    cancelled_cases: counts?.cancelled ?? 0,
    fixture_scope: "local controlled fixtures only",
    external_egress: "not measured",
    provider_activity: "none",
    reason: complete ? null : "tests did not complete as an all-pass, non-skipped run",
  });
}

async function main() {
  let selected;
  try { selected = optionsFromCli(process.argv.slice(2)); }
  catch {
    printSummary({ case: null, mode: null, status: "failed", exit_code: 1, reason: "invalid verification arguments" });
    return;
  }
  const { caseName, mode } = selected;
  if (!caseName || !Object.hasOwn(CASES, caseName) || !["mock", "live"].includes(mode)) {
    printSummary({ case: caseName ?? null, mode: mode ?? null, status: "failed", exit_code: 1, reason: "unknown case or mode" });
    return;
  }
  if (Number(process.versions.node.split(".")[0]) !== 22) {
    printSummary({
      case: caseName,
      mode,
      status: "failed",
      exit_code: 1,
      runtime: process.versions.node,
      required_runtime: "Node 22.x",
      reason: "verification must run on the supported Node 22 runtime",
    });
    return;
  }
  if (mode === "live") {
    const configShapePresent = await hasReleaseConfigShape();
    printSummary({
      case: caseName,
      mode,
      status: "blocked",
      exit_code: 1,
      test_files: 0,
      expected_cases: 0,
      terminal_cases: 0,
      release_config_shape_present: configShapePresent,
      external_egress: "not measured",
      provider_activity: "none",
      reason: "live mode is disabled until an adapter and accepted EI-01/EI-09 integration exist; configuration presence or shape is not authenticated authorization; no request was attempted",
    });
    return;
  }
  await executeMock(caseName, CASES[caseName]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    printSummary({ case: null, mode: null, status: "failed", exit_code: 1, reason: "verification runner failed" });
  });
}
