import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The external gates G1-G6 of CE-03-OR. Offline checks cannot satisfy any of them. */
export const OPENROUTER_ADAPTER_MISSING_EVIDENCE = Object.freeze([
  "creative_engine_openrouter_account_credits_key_limits_and_separate_host_injected_key",
  "owner_selected_model_id_and_provider_tag_with_verified_generation_and_separately_verified_edit_entitlement",
  "authorized_budgeted_live_smoke_for_generation_and_for_edit_with_sanitized_evidence",
  "finance_c03_owner_acceptance_of_openrouter_reported_cost_semantics_and_missing_generation_id",
  "owner_acceptance_that_reference_guided_edit_without_mask_or_documented_parent_preservation_satisfies_ce07_art01",
  "deployment_host_composition_secret_storage_and_native_codec_qualification",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitEvidence() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain=v1"], { cwd: repoRoot, encoding: "utf8" });
  return {
    commit_sha: head.status === 0 ? head.stdout.trim() : null,
    working_tree_clean: status.status === 0 && status.stdout.trim() === "",
  };
}

/** Fail-closed live gate. It reads no credential or environment variable and issues no request. */
export function createOpenRouterAdapterGateReport() {
  return Object.freeze({
    evidence_schema: "creative-openrouter-image-adapter-gate/1.0",
    target: "CE-03-OR",
    mode: "live",
    status: "blocked",
    acceptance_allowed: false,
    provider_dispatches: 0,
    paid_provider_calls: 0,
    provider_credentials_read: false,
    model_selection: "owner_selection_pending",
    external_owner_evidence: "pending",
    missing_owner_evidence: OPENROUTER_ADAPTER_MISSING_EVIDENCE,
    gate_boundary: "This gate does not read credentials or environment variables, contact OpenRouter, or authorize a reservation. Only the trusted host credential port and accepted owner evidence can enable a live adapter.",
  });
}

async function mockEvidence() {
  const paths = [
    "package.json",
    "Makefile",
    ".github/workflows/api.yml",
    "scripts/openrouter-image-adapter-check.mjs",
    "src/models/openrouter-images.mjs",
    "src/models/image-adapter-core.mjs",
    "src/models/image-routes.mjs",
    "src/models/openai-images.mjs",
    "src/models/index.mjs",
    "src/models/index.d.mts",
    "src/versions/store.mjs",
    "src/runtime/creative-runtime.mjs",
    "src/generation/concepts.mjs",
    "docs/providers/openrouter-images.md",
    "tests/models/openrouter-images.test.mjs",
    "tests/models/openrouter-api-integration.test.mjs",
    "tests/models/openrouter-store.test.mjs",
    "tests/models/public-consumer.mts",
  ];
  const inputs = {};
  for (const relative of paths) inputs[relative] = sha256(await readFile(path.join(repoRoot, relative)));
  return {
    evidence_schema: "creative-openrouter-image-adapter-evidence/1.0",
    target: "CE-03-OR",
    status: "inventory_only",
    evidence_type: "implementation_input_inventory",
    dependency_mode: "mock",
    local_acceptance_only: true,
    actual_provider_calls: 0,
    actual_network_requests: 0,
    provider_credentials_read: false,
    live_acceptance: "pending_external_gates_g1_to_g6",
    runtime: { node: process.versions.node, minimum: "22.23.3", tested_compatibility: "24.15.0" },
    public_subpath: "creative-engine/models",
    implementation: gitEvidence(),
    input_sha256: inputs,
    runner_contract: "This file inventories bounded implementation inputs. Passing tests are determined by the exit status of make check TARGET=openrouter-image-adapter MODE=mock; direct invocation does not claim test success.",
    transport_boundary: "Provider behavior is exercised only by intercepted offline fixtures.",
  };
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

async function writeEvidence(value, output, { stdout = true } = {}) {
  const serialized = JSON.stringify(value, null, 2) + "\n";
  if (output) {
    if (path.isAbsolute(output)) throw new TypeError("Evidence output must be repository-relative.");
    const resolved = path.resolve(repoRoot, output);
    if (!resolved.startsWith(repoRoot + path.sep)) throw new TypeError("Evidence output must stay inside the repository.");
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, serialized, { mode: 0o600 });
  }
  if (stdout) process.stdout.write(serialized);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.mode === "live") {
    await writeEvidence(createOpenRouterAdapterGateReport(), options.output ?? "build/openrouter-image-adapter-live-gate.json");
    process.exitCode = 2;
    return;
  }
  await writeEvidence(await mockEvidence(), options.output ?? "build/openrouter-image-adapter-evidence.json", { stdout: false });
  process.stdout.write("OpenRouter image adapter mock evidence written; intercepted fixtures only, live acceptance remains pending.\n");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
