import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = new URL("../../.github/workflows/entire-graph.yml", import.meta.url);

function jobBlock(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `workflow must define ${name} job`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-zA-Z0-9_-]+:$/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join("\n");
}

test("pull-request graph job stays read-only and the push job is pinned to trusted main", async () => {
  const source = await readFile(workflow, "utf8");
  const graph = jobBlock(source, "graph");
  const push = jobBlock(source, "push-init-agents");

  assert.match(graph, /permissions:\n      contents: read/);
  assert.doesNotMatch(graph, /contents: write|\bgit push\b/);
  assert.match(graph, /uses: actions\/checkout@v4\n        with:\n          persist-credentials: false/);

  assert.equal(source.match(/^      contents: write$/gm)?.length, 1,
    "only the trusted push job may request contents write");
  assert.match(push, /if: github\.event_name == 'workflow_dispatch' && inputs\.push_branch && github\.repository == 'Jevelopers-neatHack-2026\/event-intelligence' && github\.ref == 'refs\/heads\/main'/);
  assert.match(push, /permissions:\n      contents: write/);
  assert.match(push, /uses: actions\/checkout@v4\n        with:\n          ref: main\n          persist-credentials: false/);
  assert.equal(source.match(/\$\{\{ github\.token \}\}/g)?.length, 1,
    "the write token must be scoped to one step");
  assert.match(push, /- name: Push init-agents output for review\n        if: steps\.stage\.outputs\.changed == 'true'\n        env:\n          GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(push, /push origin "HEAD:refs\/heads\/\$branch"/);
});
