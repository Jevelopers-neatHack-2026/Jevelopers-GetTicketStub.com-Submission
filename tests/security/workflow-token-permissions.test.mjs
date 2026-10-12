import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = new URL("../../.github/workflows/entire-graph.yml", import.meta.url);

function topLevelBlock(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${name}:`);
  assert.notEqual(start, -1, `workflow must define ${name}`);
  const end = lines.findIndex((line, index) => index > start && /^[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

function checkoutBlocks(source) {
  const lines = source.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => /^      - uses: actions\/checkout@/.test(line) ? [index] : []);
  return starts.map((start) => {
    const end = lines.findIndex((line, index) => index > start && (/^      - /.test(line) || /^  [A-Za-z0-9_-]+:$/.test(line)));
    return lines.slice(start, end === -1 ? lines.length : end).join("\n");
  });
}

test("workflow runs only on trusted main pushes, never on PR or selected dispatch refs", async () => {
  const source = await readFile(workflow, "utf8");
  const triggers = topLevelBlock(source, "on");

  assert.match(triggers, /^  push:\n    branches: \[main\]$/m);
  assert.doesNotMatch(triggers, /^\s*(?:pull_request|pull_request_target|workflow_dispatch):/m,
    "PR and manual-dispatch refs use mutable workflow YAML and must not execute here");
  assert.doesNotMatch(source, /github\.event\.pull_request|refs\/pull\//,
    "the workflow must not check out or otherwise use an untrusted PR revision");
});

test("every job stays read-only and exposes no repository write token", async () => {
  const source = await readFile(workflow, "utf8");
  const permissions = topLevelBlock(source, "permissions");
  const jobs = topLevelBlock(source, "jobs");

  assert.match(permissions, /^permissions:\n  contents: read$/m);
  assert.deepEqual([...jobs.matchAll(/^  ([A-Za-z0-9_-]+):$/gm)].map((match) => match[1]), ["graph"]);
  assert.deepEqual(jobs.match(/^\s+permissions:\s*$/gm), ["    permissions:"]);
  assert.match(jobs, /^      contents: read$/m);
  assert.doesNotMatch(source, /\bwrite(?:-all)?\b/i,
    "no permission may grant write access, including quoted or flow-style YAML values");
  assert.doesNotMatch(source, /\bgit push\b/);
  assert.doesNotMatch(source, /\b(?:GITHUB_TOKEN|github\.token)\b|\$\{\{\s*secrets\./i,
    "no repository token or secret may be passed to a step or shell");
});

test("checkout never persists credentials or selects an untrusted revision", async () => {
  const source = await readFile(workflow, "utf8");
  const checkouts = checkoutBlocks(source);

  assert.ok(checkouts.length > 0, "workflow must check out the main-branch event revision");
  for (const checkout of checkouts) {
    assert.match(checkout, /^        with:\n          persist-credentials: false$/m);
    assert.doesNotMatch(checkout, /^\s+ref:/m,
      "the main-push event revision is the only allowed checkout target");
  }
  assert.doesNotMatch(source, /^\s+persist-credentials:\s*true\s*$/m);
});
