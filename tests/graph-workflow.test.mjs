import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const source = readFileSync(new URL('../.github/workflows/entire-graph.yml', import.meta.url), 'utf8');
const CHECKOUT = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683';
const UPLOAD = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';

// This dependency-free policy reader deliberately accepts only the workflow's
// simple block YAML subset. It is NOT a general YAML parser. Alternative YAML
// spellings, tags, aliases, flow collections and quoted keys fail closed, so a
// syntax change needs explicit review rather than bypassing a regex check.
function readPolicyYaml(text) {
  assert.ok(!/[\t\r\u0000]/.test(text), 'unsupported whitespace');
  const lines = text.split('\n');
  let cursor = 0;
  const indentation = (line) => line.length - line.trimStart().length;
  const ignorable = (line) => /^\s*(?:#.*)?$/.test(line);
  const skip = () => { while (cursor < lines.length && ignorable(lines[cursor])) cursor++; };
  function scalar(value) {
    assert.ok(value && !/^[\[\]{}&*!>|]/.test(value), 'unsupported scalar or flow YAML');
    if (value.startsWith("'")) {
      assert.match(value, /^'(?:[^']|'')*'$/, 'invalid quoted scalar');
      return value.slice(1, -1).replaceAll("''", "'");
    }
    if (value.startsWith('"')) return JSON.parse(value);
    assert.ok(!/\s+#/.test(value), 'inline scalar comments require review');
    if (value === 'true' || value === 'false') return value === 'true';
    if (/^\d+$/.test(value)) return Number(value);
    return value;
  }
  function entry(object, body, indent) {
    // Comments on immutable action pins are the only permitted inline comments.
    body = body.replace(/(uses: [\w/-]+@[a-f0-9]{40}) # v[\d.]+$/, '$1');
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):(?: (.*))?$/.exec(body);
    assert.ok(match, 'unsupported/quoted mapping key');
    const [, key, value] = match;
    assert.ok(!Object.hasOwn(object, key), 'duplicate mapping key');
    if (value === '|') {
      const block = [];
      while (cursor < lines.length && (ignorable(lines[cursor]) || indentation(lines[cursor]) > indent)) {
        const line = lines[cursor++];
        if (line.trim() === '') { block.push(''); continue; }
        assert.ok(indentation(line) >= indent + 2, 'invalid block indentation');
        block.push(line.slice(indent + 2));
      }
      // YAML clip chomping: one final newline, no empty trailing lines.
      object[key] = block.join('\n').replace(/\n*$/, '\n');
    } else if (value !== undefined) object[key] = scalar(value);
    else {
      skip();
      assert.equal(indentation(lines[cursor] ?? ''), indent + 2, 'missing/invalid nested value');
      object[key] = node(indent + 2);
    }
  }
  function node(indent) {
    skip();
    const sequence = lines[cursor]?.slice(indent).startsWith('- ');
    const result = sequence ? [] : Object.create(null);
    while (cursor < lines.length) {
      skip();
      if (cursor === lines.length || indentation(lines[cursor]) < indent) break;
      assert.equal(indentation(lines[cursor]), indent, 'invalid indentation');
      const body = lines[cursor++].slice(indent);
      if (!sequence) { entry(result, body, indent); continue; }
      assert.ok(body.startsWith('- '), 'mixed sequence/mapping');
      const item = body.slice(2);
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*:/.test(item)) { result.push(scalar(item)); continue; }
      const object = Object.create(null);
      entry(object, item, indent + 2);
      skip();
      while (cursor < lines.length && indentation(lines[cursor]) > indent) {
        assert.equal(indentation(lines[cursor]), indent + 2, 'invalid sequence mapping');
        entry(object, lines[cursor++].slice(indent + 2), indent + 2);
        skip();
      }
      result.push(object);
    }
    return result;
  }
  const result = node(0);
  skip();
  assert.equal(cursor, lines.length, 'unconsumed YAML');
  return result;
}

const keys = (object, allowed) => {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), 'expected mapping');
  assert.deepEqual(Object.keys(object).sort(), [...allowed].sort(), 'unexpected/missing policy keys');
};
const readOnly = (permissions) => {
  keys(permissions, ['contents']);
  assert.equal(permissions.contents, 'read', 'contents must be read-only');
};

// Reviewed shell bodies are locked independently of the YAML envelope. A deny
// regex alone cannot catch shell obfuscation (e.g. git "$operation"). New shell
// code needs review and a deliberate digest update. These bodies download public
// tooling and write only local graph files, run artifacts and the step summary.
const RUN_HASHES = [
  'a5039e61a6dca124de9784da36be04ba47b52fea62a42141d42f2683f5382ebc',
  'ea361369198a7c59d4716a55e4ed212fe7446391ceb64f12fe6800b3cd2851fb',
  '22bbab74255640ae4f397f460cd7d51165ee26feff77e30d22f6eb73c78c808a',
  'dac040890c034b00f747b293be89a56505609bf1f20c47a6c844201a504a092f',
];
const RUN_NAMES = ['Install pinned Entire CLI', 'Install graph plugin', 'Export graph snapshot', 'Write agent instructions'];
function enforcePolicy(text) {
  const workflow = readPolicyYaml(text);
  keys(workflow, ['name', 'on', 'permissions', 'env', 'jobs']);
  assert.equal(workflow.name, 'Entire graph');
  keys(workflow.on, ['push']); // No dispatch, PR, reusable workflow or indirect event family.
  keys(workflow.on.push, ['branches']);
  assert.deepEqual(workflow.on.push.branches, ['main'], 'only main pushes are trusted');
  readOnly(workflow.permissions);
  keys(workflow.env, ['ENTIRE_VERSION', 'ENTIRE_NO_AUTO_UPDATE']);
  assert.equal(workflow.env.ENTIRE_VERSION, 'v0.11.4');
  assert.equal(workflow.env.ENTIRE_NO_AUTO_UPDATE, '1');
  keys(workflow.jobs, ['graph']);
  const job = workflow.jobs.graph;
  keys(job, ['if', 'runs-on', 'timeout-minutes', 'permissions', 'defaults', 'steps']);
  assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 20);
  readOnly(job.permissions);
  keys(job.defaults, ['run']);
  keys(job.defaults.run, ['shell']);
  assert.equal(job.defaults.run.shell, 'bash');
  assert.ok(Array.isArray(job.steps));
  assert.equal(job.steps.length, 7, 'no extra executable steps');
  const [checkout, cli, plugin, snapshot, graphArtifact, instructions, instructionsArtifact] = job.steps;
  keys(checkout, ['uses', 'with']);
  assert.equal(checkout.uses, CHECKOUT, 'checkout must use reviewed immutable commit');
  keys(checkout.with, ['persist-credentials']); // No token, ssh-key, repository or selected ref override.
  assert.equal(checkout.with['persist-credentials'], false, 'checkout must not persist credentials');
  [cli, plugin, snapshot, instructions].forEach((step, i) => {
    keys(step, ['name', 'run']); // No secret env, expressions, continue-on-error, alternate shell or condition.
    assert.equal(step.name, RUN_NAMES[i]);
    assert.ok(step.run.startsWith('set -euo pipefail\n'), 'fail closed on command/pipeline failures');
    assert.ok(!/\$\{\{/.test(step.run), 'no expression interpolation in shell');
    assert.equal(createHash('sha256').update(step.run).digest('hex'), RUN_HASHES[i], 'unreviewed shell body');
  });
  for (const step of [graphArtifact, instructionsArtifact]) {
    keys(step, ['uses', 'with']);
    assert.equal(step.uses, UPLOAD, 'upload must use reviewed immutable commit');
    assert.equal(step.with['if-no-files-found'], 'error', 'missing artifacts must fail');
  }
  keys(graphArtifact.with, ['name', 'path', 'retention-days', 'if-no-files-found']);
  assert.equal(graphArtifact.with.name, 'entire-graph-${{ github.sha }}');
  assert.equal(graphArtifact.with.path, '${{ runner.temp }}/out');
  assert.equal(graphArtifact.with['retention-days'], 90);
  keys(instructionsArtifact.with, ['name', 'path', 'if-no-files-found', 'include-hidden-files']);
  assert.equal(instructionsArtifact.with.name, 'entire-graph-instructions-${{ github.sha }}');
  assert.equal(instructionsArtifact.with.path, '.entire/graph-agent.md\nAGENTS.md\nCLAUDE.md\n');
  assert.equal(instructionsArtifact.with['include-hidden-files'], true);
  return workflow;
}

function replace(text, before, after) {
  assert.ok(text.includes(before), 'mutation target must exist');
  const result = text.replace(before, after);
  assert.notEqual(result, text, 'mutation must change the workflow');
  return result;
}

test('graph workflow accepts only trusted main read-only artifact generation', () => {
  enforcePolicy(source);
});

test('graph workflow excludes the original caller-selected writable publisher', () => {
  // Direct reproduction of DBR-SC-WF-001, in addition to the structural policy:
  // the integrated base dispatched caller-selected workflow content with a
  // contents:write publisher and persisted checkout credentials.
  assert.doesNotMatch(source, /^\s*workflow_dispatch:/m, 'manual refs must not select executable workflow content');
  assert.doesNotMatch(source, /^\s*contents:\s*write\s*$/m, 'graph generation must not grant repository write');
  assert.doesNotMatch(source, /\bgit push\b/, 'graph output must remain a run artifact');
});

test('policy accepts harmless comments and scalar quoting', () => {
  enforcePolicy('# Reviewed policy\n' + replace(source, 'contents: read', "contents: 'read'"));
});

const mutations = [
  ['token expression in workflow name', 'name: Entire graph', 'name: ${{ github.token }}'],
  ['PR event', '  push:', '  pull_request:'],
  ['privileged PR event', '  push:', '  pull_request_target:'],
  ['manual selected-ref event', '  push:', '  workflow_dispatch:'],
  ['workflow_run event', '  push:', '  workflow_run:'],
  ['repository_dispatch event', '  push:', '  repository_dispatch:'],
  ['reusable workflow', '  push:', '  workflow_call:'],
  ['schedule without trust review', '  push:', '  schedule:'],
  ['extra event', 'permissions:\n', '  workflow_dispatch:\n    inputs:\n      ref: main\npermissions:\n'],
  ['flow events', 'on:\n  push:\n    branches:\n      - main', 'on: [push, pull_request]'],
  ['alternate quoted on key', 'on:\n', "'on':\n"],
  ['branch wildcard', '      - main', '      - "*"'],
  ['second branch', '      - main', '      - main\n      - feature'],
  ['tags instead of branches', '    branches:', '    tags:'],
  ['branch exclusion', '    branches:', '    branches-ignore:'],
  ['duplicate trigger', '  push:\n', '  push:\n    branches:\n      - main\n  push:\n'],
  ['root write scope', '  contents: read', '  contents: write'],
  ['quoted root permissions', 'permissions:\n', "'permissions':\n"],
  ['double-quoted permissions', 'permissions:\n', '"permissions":\n'],
  ['flow root permissions', 'permissions:\n  contents: read', 'permissions: {contents: write}'],
  ['write-all', 'permissions:\n  contents: read', 'permissions: write-all'],
  ['absent root permissions', 'permissions:\n  contents: read\n', ''],
  ['duplicate root permissions', 'permissions:\n', 'permissions:\n  contents: read\npermissions:\n'],
  ['extra root scope', '  contents: read', '  contents: read\n  actions: write'],
  ['job write scope', '      contents: read', '      contents: write'],
  ['quoted job permissions', '    permissions:', "    'permissions':"],
  ['flow job permissions', '    permissions:\n      contents: read', '    permissions: {contents: write}'],
  ['duplicate contents', '      contents: read', '      contents: read\n      contents: write'],
  ['job token minting', '      contents: read', '      contents: read\n      id-token: write'],
  ['missing job permissions', '    permissions:\n      contents: read\n', ''],
  ['missing credentials option', '          persist-credentials: false', '          ref: main'],
  ['persisted checkout token', 'persist-credentials: false', 'persist-credentials: true'],
  ['quoted true checkout token', 'persist-credentials: false', "persist-credentials: 'true'"],
  ['checkout selected ref', 'persist-credentials: false', 'persist-credentials: false\n          ref: ${{ github.sha }}'],
  ['checkout supplied token', 'persist-credentials: false', 'persist-credentials: false\n          token: ${{ secrets.PUBLISH_TOKEN }}'],
  ['checkout mutable tag', CHECKOUT, 'actions/checkout@v4'],
  ['checkout short SHA', CHECKOUT, 'actions/checkout@11bd719'],
  ['upload mutable tag', UPLOAD, 'actions/upload-artifact@v4'],
  ['upload different action', UPLOAD, 'example/other-action@' + 'a'.repeat(40)],
  ['different full SHA', CHECKOUT, 'actions/checkout@' + 'a'.repeat(40)],
  ['untrusted ref guard', "github.ref == 'refs/heads/main'", "github.ref != 'refs/heads/main'"],
  ['secret job environment', '    runs-on:', '    env:\n      GH_TOKEN: ${{ secrets.PUBLISH_TOKEN }}\n    runs-on:'],
  ['token expression in shell', '          entire version', '          echo "${{ github.token }}"\n          entire version'],
  ['case/spaced token expression', '          entire version', '          echo "${{ GITHUB[ \'token\' ] }}"\n          entire version'],
  ['secret expression in artifact', 'entire-graph-${{ github.sha }}', 'entire-graph-${{ secrets.PUBLISH_TOKEN }}'],
  ['git push', '          entire version', '          git push origin HEAD\n          entire version'],
  ['obfuscated shell write', '          entire version', '          operation=push\n          git "$operation" origin HEAD\n          entire version'],
  ['GitHub CLI write', '          entire version', '          gh api -X POST repos/example/repo/dispatches\n          entire version'],
  ['extra publisher job', '  graph:', '  publisher:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest\n  graph:'],
  ['continue on failure', '        run: |', '        continue-on-error: true\n        run: |'],
  ['silenced pipeline failure', 'set -euo pipefail', 'set -eu'],
  ['artifact missing-file warning', 'if-no-files-found: error', 'if-no-files-found: warn'],
  ['artifact token override', '          retention-days: 90', '          retention-days: 90\n          github-token: ${{ github.token }}'],
  ['artifact path widened', 'path: ${{ runner.temp }}/out', 'path: .'],
  ['unexpected executable step', '    steps:\n', '    steps:\n      - run: git push\n'],
  ['YAML alias', '  contents: read', '  contents: &permission read'],
  ['YAML merge key', '  contents: read', '  <<: *permission\n  contents: read'],
];
for (const [name, before, after] of mutations) {
  test(`policy rejects ${name}`, () => {
    // First prove the starting fixture is accepted; otherwise negatives could
    // pass accidentally because all workflows are rejected by a broken reader.
    enforcePolicy(source);
    assert.throws(() => enforcePolicy(replace(source, before, after)));
  });
}

test('reviewed shell bodies parse under bash and preserve graph provenance artifacts', () => {
  const workflow = enforcePolicy(source);
  for (const step of workflow.jobs.graph.steps.filter((step) => step.run)) {
    const result = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const snapshot = workflow.jobs.graph.steps[3].run;
  assert.match(snapshot, /entire graph snapshot --repo \. --format compact-ndjson/);
  assert.match(snapshot, /git rev-parse HEAD > "\$out\/commit\.txt"/);
  assert.match(snapshot, /sha256sum graph-snapshot\.ndjson graph-version\.json graph-capabilities\.json commit\.txt > SHA256SUMS/);
});
