import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testFiles = [
  "tests/generation/concepts.test.mjs",
  "tests/models/creative-api-integration.test.mjs",
  "tests/models/openai-images.test.mjs",
  "tests/versions/store.test.mjs",
];
const requiredTests = [
  ["CE04-A01", "actual Creative API v1.1 concepts.create edits two authorized references and publishes parentless siblings"],
  ["CE04-A02", "concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST"],
  ["CE04-A03", "malformed native concept output keeps the exact attempts private and publishes zero versions"],
  ["CE04-A04", "concept response stage survives a hard process exit and resumes the identical attempt without redispatch"],
  ["CE04-A04-partial", "a reconciled staged sibling resumes the untouched slot after a hard process exit"],
  ["CE04-A05-duplicate", "concurrent concepts.create replay observes the active job without duplicating native dispatch"],
  ["CE04-A05-cancel", "concept dispatch rechecks public cancellation and the durable lease after the final awaited owner authorization"],
  ["CE04-A05-late", "late native concept response after public cancellation stays private and leaves an unknown financial hold"],
  ["CE04-A05-owner", "late native concept response cannot mutate the attempt after a replacement owner recovers it"],
  ["CE04-known-retry", "a known fully mapped native failure gets one distinct metered retry for a single requested concept"],
  ["CE04-C03-forgery", "public provider and usage-mapper settlement claims cannot clear an unmatched C03 hold"],
  ["CE04-C03-replay", "settled native edit mapping metadata matches persisted result and exact completed replay"],
  ["CE04-native-two-refs", "parentless concept edit preflights and posts exactly two authorized image references"],
  ["CE04-v10-migration", "reconstructed v9 private attribution tables migrate to v10 with populated rows, CHECKs, triggers, and foreign keys"],
];
const inputFiles = [
  "package.json", "Makefile", ".github/workflows/api.yml", "scripts/concepts-check.mjs",
  "scripts/concepts-package-check.mjs", "src/api/v1.d.mts", "src/api/v1.mjs", "src/generation/concepts.mjs",
  "src/generation/concepts.d.mts", "src/models/openai-images.mjs", "src/runtime/creative-runtime.mjs",
  "src/telemetry/evidence.mjs", "src/versions/api-ports.mjs", "src/versions/store.mjs",
  "tests/generation/concepts.test.mjs", "tests/models/creative-api-integration.test.mjs",
  "tests/models/openai-images.test.mjs", "tests/versions/store.test.mjs",
  "tests/api/concepts-public-consumer.mts", "docs/api/creative-api.md", "docs/creative/concept-generation.md",
];
const externalMissing = Object.freeze([
  "canonical_C01_concepts_catalog_agreement_and_consumer_acceptance",
  "Finance_accepted_concept_operation_mapping_and_live_reservation_authority",
  "live_provider_account_capability_and_usage_reconciliation_evidence",
  "CE08_host_production_object_store_and_SQLite_deployment_qualification",
  "CE09_owner_inspection_and_host_acceptance_evidence",
  "CE11_owner_outbox_and_external_event_sink_acceptance",
]);

function parseArgs(argv) {
  const options = { mode: "mock", output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--mode") options.mode = argv[++index];
    else if (argv[index] === "--out") options.output = argv[++index];
    else throw new TypeError("Use --mode mock|CI|failclosedlive and optional --out <repo-relative-path>.");
  }
  if (!["mock", "CI", "failclosedlive"].includes(options.mode)) throw new TypeError("Unsupported concepts check mode.");
  if (options.output && path.isAbsolute(options.output)) throw new TypeError("Evidence output must be repository-relative.");
  return options;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function writeEvidence(evidence, outputPath) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(repoRoot, outputPath);
    if (!resolved.startsWith(`${repoRoot}${path.sep}`)) throw new TypeError("Evidence output must stay inside the repository.");
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, serialized, { mode: 0o600 });
  }
  process.stdout.write(serialized);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "failclosedlive") {
    await writeEvidence({
      evidence_schema: "creative-concepts-live-gate/1.0",
      target: "CE-04",
      mode: "failclosedlive",
      status: "blocked",
      acceptance_allowed: false,
      provider_dispatches: 0,
      paid_provider_calls: 0,
      provider_credentials_read: false,
      actual_network_requests: 0,
      external_owner_evidence: "pending",
      missing_owner_evidence: [...externalMissing],
      gate_boundary: "This local gate does not read credentials, contact a provider, reserve budget, settle an attempt, or authorize live execution.",
    }, options.output);
    process.exitCode = 2;
    return;
  }

  const testArgs = ["--test", "--test-concurrency=1", "--test-reporter=tap", ...testFiles];
  const child = spawnSync(process.execPath, testArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 360_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  const logPath = path.join(repoRoot, `build/concepts-${options.mode}-test.tap`);
  await mkdir(path.dirname(logPath), { recursive: true });
  await writeFile(logPath, output, { mode: 0o600 });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);

  const titles = new Set([...output.matchAll(/^# Subtest: (.+)$/gm)].map((match) => match[1]));
  const failed = new Set([...output.matchAll(/^not ok \d+ - (.+)$/gm)].map((match) => match[1]));
  const cases = requiredTests.map(([caseId, title]) => ({
    case_id: caseId,
    title,
    status: titles.has(title) && !failed.has(title) ? "passed" : "failed_or_missing",
  }));
  const counts = {
    tests: Number(output.match(/^# tests (\d+)$/m)?.[1] ?? 0),
    passed: Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0),
    failed: Number(output.match(/^# fail (\d+)$/m)?.[1] ?? -1),
    skipped: Number(output.match(/^# skipped (\d+)$/m)?.[1] ?? -1),
    cancelled: Number(output.match(/^# cancelled (\d+)$/m)?.[1] ?? -1),
  };
  const inputSha256 = {};
  for (const relative of inputFiles) inputSha256[relative] = sha256(await readFile(path.join(repoRoot, relative)));
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain=v1"], { cwd: repoRoot, encoding: "utf8" });
  const passed = child.status === 0 && !child.error && counts.tests > 0 && counts.failed === 0 &&
    counts.skipped === 0 && counts.cancelled === 0 && cases.every((item) => item.status === "passed");
  const evidence = {
    evidence_schema: "creative-concepts-check/1.0",
    target: "CE-04",
    mode: options.mode,
    status: passed ? "passed" : "failed",
    acceptance_allowed: false,
    runtime: { node: process.versions.node, minimum: "22.23.3", paired_development_runtime: "24.15.0" },
    source_revision: { head: head.status === 0 ? head.stdout.trim() : null,
      working_tree_clean: status.status === 0 && status.stdout.trim() === "" },
    test_command: { argv: [process.execPath, ...testArgs], cwd: repoRoot, exit_code: child.status ?? null,
      signal: child.signal ?? null, error: child.error?.message ?? null, counts, tap_log: path.relative(repoRoot, logPath) },
    required_cases: cases,
    input_sha256: inputSha256,
    external_acceptance: "pending_owner_agreements_and_live_evidence",
    actual_provider_calls: 0,
    actual_network_requests: 0,
    paid_provider_calls: 0,
    provider_credentials_read: false,
  };
  await writeEvidence(evidence, options.output);
  if (!passed) process.exitCode = child.status && child.status > 0 ? child.status : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
