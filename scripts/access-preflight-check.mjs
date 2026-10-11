import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ACCESS_CELL_DEFINITIONS,
  createAccessPreflightReport,
  createOpenRouterImagesAdapter,
  runAccessPreflight,
} from "creative-engine/preflight";
import { createMockAccessFixture } from "../fixtures/preflight/access-ports.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Each image cell is satisfied by EITHER the direct OpenAI target or the OpenRouter target, never both and never a
// mix across cells. The alternatives are grouped into one `one_of:a|b` requirement so the gate does not read as
// demanding both providers; each alternative still needs independently verified permission and quota evidence.
const evidenceAlternatives = Object.freeze({
  "one_of:openai_generation_account_permission_and_quota|openrouter_generation_account_permission_and_quota": Object.freeze([
    "openai_generation_account_permission_and_quota", "openrouter_generation_account_permission_and_quota"]),
  "one_of:openai_edit_account_permission_and_quota|openrouter_edit_account_permission_and_quota": Object.freeze([
    "openai_edit_account_permission_and_quota", "openrouter_edit_account_permission_and_quota"]),
});
const [generationAlternatives, editAlternatives] = Object.keys(evidenceAlternatives);
const missingEvidence = Object.freeze({
  image_generation: [
    generationAlternatives,
    "external_grant_and_finance_reservation",
  ],
  image_edit: [
    editAlternatives,
    "external_grant_and_finance_reservation",
  ],
  harness_jev: [
    "accepted_harness_jev_adapter_and_trace",
    "external_grant_and_finance_reservation",
  ],
  vision_observer: [
    "owner_selected_vision_target_and_capability",
    "external_grant_and_finance_reservation",
  ],
  generative_classifier_baseline: [
    "owner_selected_baseline_target_and_capability",
    "external_grant_and_finance_reservation",
  ],
  planning: [
    "owner_selected_planning_target_and_capability",
    "external_grant_and_finance_reservation",
  ],
  neatlogs_ingestion: ["accepted_neatlogs_ingestion_protocol_and_receipt"],
  neatlogs_readback: ["accepted_neatlogs_readback_protocol_and_receipt"],
});

const reasonForCell = Object.freeze({
  image_generation: "live_adapter_unavailable",
  image_edit: "live_adapter_unavailable",
  harness_jev: "adapter_unavailable",
  vision_observer: "pin_unresolved",
  generative_classifier_baseline: "pin_unresolved",
  planning: "pin_unresolved",
  neatlogs_ingestion: "metering_operation_unpublished",
  neatlogs_readback: "metering_operation_unpublished",
});

const actionForCell = Object.freeze({
  image_generation: "Creative and fulfillment must provide independently verified account permission, quota, exact target (direct OpenAI Images or OpenRouter Images), and an authorized Finance reservation.",
  image_edit: "Creative and fulfillment must provide independent edit permission, quota, exact target (direct OpenAI Images edit or OpenRouter reference-guided edit), and an authorized Finance reservation.",
  harness_jev: "Agent and research must publish the accepted harness DecisionPort adapter and prove authorized trace delivery.",
  vision_observer: "Product and frontend must select the observer target and provide independently verified operation permission, quota, and budget authority.",
  generative_classifier_baseline: "Product and frontend must select the baseline target and provide independently verified operation permission, quota, and budget authority.",
  planning: "Creative and fulfillment must select the planning target and provide independently verified operation permission, quota, and budget authority.",
  neatlogs_ingestion: "Finance and reliability must publish and accept the sanitized ingestion operation and its receipt semantics.",
  neatlogs_readback: "Finance and reliability must publish and accept separate sanitized readback semantics bound to the ingested event.",
});

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function safeGitState() {
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  const status = spawnSync("git", ["status", "--porcelain=v1"], { cwd: repoRoot, encoding: "utf8" });
  return {
    commit_sha: head.status === 0 ? head.stdout.trim() : null,
    working_tree_clean: status.status === 0 && status.stdout.trim() === "",
  };
}

export function createAccessPreflightGateReport() {
  const cells = ACCESS_CELL_DEFINITIONS.map((definition) => ({
    cell_id: definition.cell_id,
    owner_role: definition.owner_role,
    acceptance_ids: [...definition.acceptance_ids],
    status: "blocked",
    verified: false,
    reason_code: reasonForCell[definition.cell_id],
    owner_action: actionForCell[definition.cell_id],
    missing_evidence: [...missingEvidence[definition.cell_id]],
    financial_hold: "none",
  }));
  const required = [...new Set(cells.flatMap((cell) => cell.missing_evidence))].sort();
  return {
    evidence_schema: "creative-access-preflight-gate/1.0",
    target: "CE-A01",
    mode: "live",
    status: "blocked",
    acceptance_allowed: false,
    required_cell_count: ACCESS_CELL_DEFINITIONS.length,
    verified_cell_count: 0,
    provider_dispatches: 0,
    paid_provider_calls: 0,
    provider_credentials_read: false,
    external_owner_evidence: "pending",
    cells,
    missing_owner_evidence: required,
    evidence_alternatives: Object.fromEntries(Object.entries(evidenceAlternatives).map(([group, members]) => [group, [...members]])),
    evidence_alternatives_rule: "any_one_member_satisfies_the_group",
    gate_boundary: "No trusted live host composition is installed. User-supplied JSON cannot authenticate provider access, capability, authorization, or Finance reservation.",
  };
}

const SYNTHETIC_TOKEN = "synthetic-token-not-a-credential";
const KEY_URL = "https://openrouter.ai/api/v1/key";

/**
 * Drive the real OpenRouter metadata adapter against an intercepted fetch and a synthetic credential port. Nothing
 * leaves the process: the fetch implementation answers from memory, so `requests` records what would have been sent.
 * The adapter's observation is relabeled `mock` (a live-labeled observation is refused in a mock run), and the runner
 * still discards its permission and quota.
 */
function realOpenRouterMockAdapter(fixture) {
  const requests = [];
  const catalogUrl = `https://openrouter.ai/api/v1/images/models/${fixture.target.model}/endpoints`;
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), method: init?.method, credentialed: init?.headers?.authorization !== undefined });
    if (url === KEY_URL) return Response.json({ data: { label: "synthetic" } });
    if (url === catalogUrl) {
      return Response.json({ data: { endpoints: [{ provider_tag: fixture.target.configuration.provider_tag, supported_parameters: {}, pricing: {} }] } });
    }
    return new Response("{}", { status: 404 });
  };
  const credentialPort = {
    evidence_mode: "live",
    async resolveCredential(input) {
      return {
        decision: "resolved", evidence_mode: "live",
        binding: { service: "openrouter", account_ref: input.account_ref, project_ref: input.project_ref,
          target_binding_sha256: digest(Buffer.from(JSON.stringify(input.target_binding), "utf8")) },
        token: SYNTHETIC_TOKEN,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        evidence: { ref: "test:evidence:credential", sha256: digest(Buffer.from("credential")), pinned_revision: "test:revision:credential",
          independent_review: { ref: "test:review:credential", sha256: digest(Buffer.from("review:credential")) } },
      };
    },
  };
  const real = createOpenRouterImagesAdapter({ credentialPort, fetchImpl });
  const adapter = { ...fixture.adapter, evidence_mode: "mock",
    async inspect(input) { return { ...(await real.inspect(input)), evidence_mode: "mock" }; } };
  return { adapter, requests };
}

async function createMockEvidence() {
  const runId = "test:access-preflight-ci";
  const scenarios = [];
  // Generation and edit are separate cells for each provider target; each scenario selects exactly one cell.
  for (const [provider, cellId] of [["openai", "image_generation"], ["openai", "image_edit"],
    ["openrouter", "image_generation"], ["openrouter", "image_edit"]]) {
    // The real adapter stamps observations with the current time, so the fixture clock must not be earlier.
    const fixture = createMockAccessFixture({ cellId, runId, provider,
      ...(provider === "openrouter" ? { now: new Date(Date.now() + 5000).toISOString() } : {}) });
    const real = provider === "openrouter" ? realOpenRouterMockAdapter(fixture) : undefined;
    const report = await runAccessPreflight(real ? { ...fixture.args, adapter: real.adapter } : fixture.args);
    if (report.acceptance_allowed !== false || report.mode !== "mock" || report.required_cell_count !== ACCESS_CELL_DEFINITIONS.length) {
      throw new Error("mock access report failed its fixed-denominator assertions");
    }
    const result = report.cells.find((cell) => cell.cell_id === cellId);
    if (result?.status !== "simulated" || result.verified !== false || fixture.calls.dispatch !== 1) {
      throw new Error("the synthetic Images fixture did not produce its expected simulated result");
    }
    if (real && (real.requests.length !== 2 || real.requests.some((request) => request.method !== "GET"))) {
      throw new Error("the real OpenRouter adapter did not make exactly its two intercepted reads");
    }
    scenarios.push({ report, fixture, provider, cellId, intercepted_requests: real?.requests.length ?? 0 });
  }

  const results = ACCESS_CELL_DEFINITIONS.map((definition) => {
    const candidates = scenarios.map(({ report }) => report.cells.find((cell) => cell.cell_id === definition.cell_id)).filter(Boolean);
    return candidates.find((cell) => cell.status === "simulated") ?? candidates[0];
  });
  // The aggregate report keeps one row per cell (fixed eight-cell denominator); the per-target simulated result of
  // each image cell, for both providers, is listed separately so neither provider's evidence is hidden.
  const imageCellTargets = {};
  for (const { provider, cellId, report: scenarioReport } of scenarios) {
    const row = scenarioReport.cells.find((cell) => cell.cell_id === cellId);
    imageCellTargets[cellId] ??= {};
    imageCellTargets[cellId][provider] = { status: row.status, verified: row.verified, reason_code: row.reason_code,
      configuration_sha256: row.configuration_sha256 };
  }
  const report = createAccessPreflightReport({
    run_id: runId,
    generated_at: new Date().toISOString(),
    mode: "mock",
    results,
  });
  if (report.cells.length !== ACCESS_CELL_DEFINITIONS.length || report.acceptance_allowed !== false) {
    throw new Error("mock access evidence did not preserve every required cell");
  }

  const [accessSource, imagesSource, openRouterSource, fixtureSource] = await Promise.all([
    readFile(path.join(repoRoot, "src/preflight/access.mjs")),
    readFile(path.join(repoRoot, "src/preflight/openai-images.mjs")),
    readFile(path.join(repoRoot, "src/preflight/openrouter-images.mjs")),
    readFile(path.join(repoRoot, "fixtures/preflight/access-ports.mjs")),
  ]);
  return {
    evidence_schema: "creative-access-preflight-evidence/1.0",
    target: "CE-A01",
    status: report.status,
    mode: "mock",
    acceptance_allowed: report.acceptance_allowed,
    required_cell_count: report.required_cell_count,
    verified_cell_count: report.verified_cell_count,
    paid_provider_calls: 0,
    provider_credentials_read: false,
    test_fixture_only: {
      synthetic_authorities: true,
      mock_adapter_dispatches: scenarios.reduce((total, { fixture }) => total + fixture.calls.dispatch, 0),
      actual_network_requests: 0,
      intercepted_openrouter_adapter_requests: scenarios.reduce((total, { intercepted_requests }) => total + intercepted_requests, 0),
      openrouter_inspection: "real createOpenRouterImagesAdapter with an in-memory fetchImpl and a synthetic credential port",
      scenarios: scenarios.map(({ provider, cellId, report: scenarioReport }) => ({
        provider, cell_id: cellId, status: scenarioReport.cells.find((cell) => cell.cell_id === cellId).status,
      })),
      image_cell_targets: imageCellTargets,
    },
    runtime: {
      node: process.versions.node,
      supported_minimum: "22.23.3",
      development_compatibility: "24.15.0",
    },
    public_subpath: "creative-engine/preflight",
    implementation: safeGitState(),
    input_sha256: {
      "src/preflight/access.mjs": digest(accessSource),
      "src/preflight/openai-images.mjs": digest(imagesSource),
      "src/preflight/openrouter-images.mjs": digest(openRouterSource),
      "fixtures/preflight/access-ports.mjs": digest(fixtureSource),
    },
    report,
    external_acceptance: "pending_owner_access_finance_harness_and_trace_evidence",
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
    await writeEvidence(createAccessPreflightGateReport(), options.output ?? "build/access-preflight-live-gate.json");
    process.exitCode = 2;
    return;
  }

  const evidence = await createMockEvidence();
  const output = options.output ?? "build/access-preflight-evidence.json";
  await writeEvidence(evidence, output, { stdout: false });
  process.stdout.write(`Access preflight evidence written: ${path.relative(repoRoot, path.resolve(repoRoot, output))} (8 cells, 4 synthetic adapter dispatches, acceptance pending).\n`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
