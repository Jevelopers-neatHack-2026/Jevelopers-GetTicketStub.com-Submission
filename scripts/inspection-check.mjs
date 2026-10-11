import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_MISSING_EVIDENCE = Object.freeze([
  "owner_selected_vision_observer_target_and_capability",
  "trusted_live_observer_grant_and_finance_reservation_authority",
  "shared_contracts_decision_port_and_harness_consumer_acceptance",
  "finance_metering_budget_protocol_and_accepted_usage_mapping",
  "neatlogs_ingestion_readback_protocol_and_receipts",
  "q01_adjudicated_held_out_corpus_thresholds_and_promotion",
  "node_22_23_3_cloudlinux_cagefs_and_lve_qualification",
]);

const ACCEPTANCE_CASES = Object.freeze([
  { id: "CE09-A01", title: "CE09 acceptance case 1" },
  { id: "CE09-A02", title: "CE09 acceptance case 2" },
  { id: "CE09-A03", title: "CE09 acceptance case 3" },
  { id: "CE09-A04", title: "CE09 acceptance case 4" },
  { id: "CE09-A05", title: "CE09 acceptance case 5" },
  { id: "CE09-A06", title: "CE09 acceptance case 6" },
]);

const REQUIRED_TEST_TITLES = Object.freeze([
  "inspection hard exit reopens with a dispatching stage and never redispatches it",
  "inspection API decodes PNG, JPEG, and WebP with the pinned shared codec",
  "inspection repair remains review-gated when trusted owner usage evidence is unavailable",
  "CE09 acceptance case 4 persists cumulative root limits across restart and blocks a third repair",
  "populated V6 records migrate additively and replay legacy telemetry as unknown without redispatch",
  "storage schema v2 migrates additively through private provider attribution and inspection integration v7",
  "public projection rejects sensitive object keys and Basic credentials without echoing diagnostic paths",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseArgs(argv) {
  const options = { mode: "mock", output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mode") options.mode = argv[++index];
    else if (argv[index] === "--out") options.output = argv[++index];
    else throw new TypeError("Use --mode mock|live and optional --out <repo-relative-path>.");
  }
  if (!new Set(["mock", "live"]).has(options.mode)) throw new TypeError("Mode must be mock or live.");
  return options;
}

function liveGateReport() {
  return {
    evidence_schema: "creative-inspection-gate/1.0",
    target: "CE-09",
    mode: "live",
    status: "blocked",
    acceptance_allowed: false,
    provider_dispatches: 0,
    paid_provider_calls: 0,
    provider_credentials_read: false,
    promotion_status: "not_promoted",
    external_owner_evidence: "pending",
    missing_owner_evidence: [...LIVE_MISSING_EVIDENCE],
    gate_boundary: "This gate does not read credentials, contact an observer or DecisionPort, or authorize a Finance reservation.",
  };
}

async function outputEvidence(value, output, { stdout = true } = {}) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (output) {
    if (path.isAbsolute(output)) throw new TypeError("Evidence output must be repository-relative.");
    const resolved = path.resolve(repoRoot, output);
    if (!resolved.startsWith(`${repoRoot}${path.sep}`)) throw new TypeError("Evidence output must stay inside the repository.");
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, serialized, { mode: 0o600 });
  }
  if (stdout) process.stdout.write(serialized);
}

async function mockEvidence(outputPath) {
  const inspectionTests = (await readdir(path.join(repoRoot, "tests/inspection")))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join("tests/inspection", name));
  const testArgs = ["--test", "--test-reporter=tap", ...inspectionTests,
    "tests/api/creative-api.test.mjs", "tests/versions/api-integration.test.mjs",
    "tests/versions/store.test.mjs", "tests/models/openai-images.test.mjs", "tests/contracts/acceptance-gate.test.mjs"];
  const child = spawnSync(process.execPath, testArgs, { cwd: repoRoot, encoding: "utf8", timeout: 240_000,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  const log = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const logPath = path.resolve(repoRoot, "build/inspection-test.tap");
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, log, { mode: 0o600 });

  const manifestBytes = await readFile(path.join(repoRoot, "fixtures/inspection/manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const missing = [];
  for (const item of ACCEPTANCE_CASES) if (!log.includes(item.title)) missing.push(item.id);
  const fixtureBuckets = manifest.buckets.map((bucket) => ({ id: bucket.id, fixture_hash: bucket.fixture_hash,
    exercised: log.includes(bucket.id) }));
  for (const bucket of fixtureBuckets) if (!bucket.exercised) missing.push(`bucket:${bucket.id}`);
  for (const title of REQUIRED_TEST_TITLES) if (!log.includes(title)) missing.push(`test:${title}`);
  const testCount = Number(log.match(/^# tests (\d+)$/m)?.[1] ?? 0);
  const failCount = Number(log.match(/^# fail (\d+)$/m)?.[1] ?? -1);
  const passCount = Number(log.match(/^# pass (\d+)$/m)?.[1] ?? 0);
  if (child.error) missing.push("runner_spawn_error");
  if (child.status !== 0) missing.push("test_runner_failed");
  if (testCount === 0 || passCount === 0 || failCount !== 0) missing.push("test_summary_missing_or_failed");
  const inputs = {};
  for (const relative of ["package.json", "Makefile", ".github/workflows/api.yml", "scripts/inspection-check.mjs",
    "scripts/acceptance-gate.mjs", "src/api/v1.mjs", "src/api/v1.d.mts", "src/runtime/creative-runtime.mjs",
    "src/versions/api-ports.mjs", "src/versions/store.mjs", "src/inspection/index.mjs", "src/inspection/index.d.mts",
    "src/models/openai-images.mjs", "fixtures/inspection/manifest.json", "tests/versions/api-integration.test.mjs",
    "tests/versions/store.test.mjs", "tests/api/creative-api.test.mjs", "tests/inspection/inspection.test.mjs",
    "tests/models/openai-images.test.mjs"]) {
    inputs[relative] = sha256(await readFile(path.join(repoRoot, relative)));
  }
  const receiptPath = path.join(repoRoot, "fixtures/versions/base6-populated-v6/manifest.json");
  inputs["fixtures/versions/base6-populated-v6/manifest.json"] = sha256(await readFile(receiptPath));
  const result = {
    evidence_schema: "creative-inspection-evidence/1.0",
    target: "CE-09",
    mode: "mock",
    status: child.status === 0 && missing.length === 0 ? "passed" : "failed",
    acceptance_allowed: false,
    provider_dispatches: 0,
    paid_provider_calls: 0,
    actual_network_requests: 0,
    provider_credentials_read: false,
    promotion_status: "not_promoted",
    runtime: { node: process.versions.node, minimum: "22.23.3", local_execution_only: true },
    public_subpath: "creative-engine/inspection",
    acceptance_cases: ACCEPTANCE_CASES.map((item) => ({ ...item, present: log.includes(item.title) })),
    fixture_buckets: fixtureBuckets,
    tests: { argv: [process.execPath, ...testArgs], cwd: repoRoot, status: child.status ?? null,
      passed: passCount, failed: failCount, count: testCount, log: path.relative(repoRoot, logPath) },
    base6_migration_fixture_manifest_sha256: inputs["fixtures/versions/base6-populated-v6/manifest.json"],
    input_sha256: inputs,
    missing_evidence: missing,
    external_acceptance: "pending_owner_capability_finance_usage_q01_and_host_evidence",
  };
  if (outputPath) await outputEvidence(result, outputPath, { stdout: false });
  if (missing.length) {
    process.stderr.write(`Inspection mock gate failed; see ${path.relative(repoRoot, logPath)}.\n`);
    for (const item of missing) process.stderr.write(`- ${item}\n`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = options.output ?? (options.mode === "live"
    ? "build/inspection-live-gate.json" : "build/inspection-evidence.json");
  if (options.mode === "live") {
    await outputEvidence(liveGateReport(), output);
    process.exitCode = 2;
    return;
  }
  const result = await mockEvidence(output);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "passed") process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
