import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateCompletion } from "../../tools/verify.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function runVerifier(args, env = {}) {
  return spawnSync(process.execPath, [path.join(ROOT, "tools/verify.mjs"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function summaryFrom(output) {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith("VERIFY_SUMMARY_JSON="));
  assert.ok(line, output);
  return JSON.parse(line.slice("VERIFY_SUMMARY_JSON=".length));
}

test("completion gate requires a nonempty all-pass run with no skipped or unreported cases", () => {
  const pass = { success: true, counts: { passed: 2, failed: 0, skipped: 0, todo: 0, cancelled: 0 } };
  assert.deepEqual(evaluateCompletion(pass, 2), { complete: true, terminal: 2, counts: pass.counts });
  assert.equal(evaluateCompletion(pass, 0).complete, false);
  assert.equal(evaluateCompletion({ ...pass, counts: { ...pass.counts, skipped: 1 } }, 3).complete, false);
  assert.equal(evaluateCompletion(pass, 3).complete, false);
  assert.equal(evaluateCompletion(undefined, 2).complete, false);
});

test("unimplemented reserved case fails when it collects zero test files", () => {
  const result = runVerifier(["--case=evals", "--mode=mock"]);
  const summary = summaryFrom(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(summary.test_files, 0);
  assert.equal(summary.expected_cases, 0);
  assert.equal(summary.status, "failed");
});

test("live mode remains blocked even when a config-shaped file is present", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ei-verify-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "release.json");
  await writeFile(configPath, JSON.stringify({
    release_manifest: "manifest-reference",
    budget_authorization: "budget-reference",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  }));
  const result = runVerifier(["--case=safe-retrieval", "--mode=live"], { EVENT_INTELLIGENCE_LIVE_CONFIG: configPath });
  const summary = summaryFrom(result.stdout);
  assert.equal(result.status, 1);
  assert.equal(summary.status, "blocked");
  assert.equal(summary.release_config_shape_present, true);
  assert.equal(summary.provider_activity, "none");
  assert.match(summary.reason, /not authenticated authorization/);
});

test("prototype property names are not valid case selectors", () => {
  const result = runVerifier(["--case=constructor", "--mode=mock"]);
  assert.equal(result.status, 1);
  assert.equal(summaryFrom(result.stdout).reason, "unknown case or mode");
});
