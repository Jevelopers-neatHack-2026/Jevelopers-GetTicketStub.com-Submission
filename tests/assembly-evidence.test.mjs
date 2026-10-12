import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, verifyManifest, safeRegularFile, FIXTURE_SUITES } from "../scripts/assembly-evidence.mjs";

const REAL_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(REAL_ROOT, "scripts", "assembly-evidence.mjs");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

// A tiny committed repo shaped like the real inputs, so tamper cases never touch the working checkout.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "assembly-evidence-"));
  const put = (rel, text) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text); };
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@example.invalid");
  git(root, "config", "user.name", "t");
  put(".gitignore", "/out/\n");
  put("package.json", JSON.stringify({ engines: { node: ">=22.23.3 <23", npm: ">=11.16.0 <12" }, packageManager: "npm@11.16.0" }));
  put("package-lock.json", "{\"lock\":1}\n");
  put("integration/repository-map.json", JSON.stringify({
    integration_root: "REPO-03",
    repositories: [{ id: "REPO-03", name: "app", planned_package_dependencies: ["agent-harness", "event-intelligence", "shared-contracts"] }],
  }));
  const harness = "module.exports = 1;\n";
  put("src/server/vendor/agent-harness/src/a.js", harness);
  put("src/server/vendor/agent-harness/MANIFEST.json", JSON.stringify({
    repository: "https://example.invalid/agent-harness", commit: "a".repeat(40), files: { "src/a.js": sha(harness) },
  }));
  for (const suite of FIXTURE_SUITES) {
    put(`${suite}/index.json`, `{"suite":"${suite}"}\n`);
    put(`${suite}/scenarios/one.json`, "{}\n");
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });
const withRepo = (fn) => () => { const root = makeRepo(); try { return fn(root); } finally { cleanup(root); } };

test("clean build records real identities, labels, and leaves unpinned components pending", withRepo((root) => {
  const manifest = buildManifest(root);
  assert.equal(manifest.app.sha, git(root, "rev-parse", "HEAD").trim());
  assert.equal(manifest.app.reproducible, true);
  assert.equal(manifest.lockfile.sha256, sha("{\"lock\":1}\n"));
  assert.equal(manifest.mode, "snapshot-tooling");
  assert.equal(manifest.acceptance.status, "not_accepted");
  assert.deepEqual(manifest.executed, []);
  assert.equal(manifest.toolchain.declared.packageManager, "npm@11.16.0");
  assert.equal(manifest.toolchain.runtime.node, process.versions.node);
  assert.equal(manifest.vendored[0].status, "installed-vendored");
  const status = Object.fromEntries(manifest.components.required.map((c) => [c.name, c]));
  assert.equal(status["agent-harness"].status, "installed-vendored");
  assert.equal(status["agent-harness"].commit, "a".repeat(40));
  for (const name of ["event-intelligence", "shared-contracts"]) {
    assert.equal(status[name].status, "pending");
    assert.equal(status[name].commit, undefined);
  }
  assert.equal(manifest.fixtures["fixtures/approval"].fileCount, 2);
  assert.deepEqual(verifyManifest(root, manifest), []);
}));

test("dirty tree is refused, or recorded as non-reproducible and rejected by verify", withRepo((root) => {
  writeFileSync(join(root, "stray.txt"), "x");
  assert.throws(() => buildManifest(root), /dirty/);
  const manifest = buildManifest(root, { allowDirty: true });
  assert.equal(manifest.app.dirty, true);
  assert.equal(manifest.app.reproducible, false);
  assert.deepEqual(manifest.app.dirtyPaths, ["stray.txt"]);
  assert.ok(verifyManifest(root, manifest).some((p) => /dirty/.test(p)));
  assert.equal(verifyManifest(root, manifest, { allowDirty: true }).length, 0);
}));

test("tampered manifest content fails the digest even when fields stay well-formed", withRepo((root) => {
  const manifest = buildManifest(root);
  const edited = structuredClone(manifest);
  edited.components.required.find((c) => c.name === "event-intelligence").status = "installed-vendored";
  edited.components.required.find((c) => c.name === "event-intelligence").commit = "b".repeat(40);
  const problems = verifyManifest(root, edited);
  assert.ok(problems.some((p) => /manifestDigest/.test(p)));
  assert.ok(problems.some((p) => /component pin table/.test(p)));
}));

test("falsely accepted, executed or mislabelled manifests fail even with a recomputed digest", withRepo((root) => {
  const manifest = buildManifest(root);
  const reseal = (mutate) => {
    const copy = structuredClone(manifest);
    mutate(copy);
    delete copy.manifestDigest;
    // Reuse the tool's own digest by round-tripping through buildManifest's canonical form.
    copy.manifestDigest = digestFor(copy);
    return verifyManifest(root, copy);
  };
  assert.ok(reseal((m) => { m.acceptance.status = "accepted"; }).some((p) => /not_accepted/.test(p)));
  assert.ok(reseal((m) => { m.executed = [{ command: "npm test", exit: 0 }]; }).some((p) => /executed/.test(p)));
  assert.ok(reseal((m) => { m.mode = "release"; }).some((p) => /mode label/.test(p)));
  assert.ok(reseal((m) => { m.components.required[0].status = "pinned"; }).some((p) => /unknown status|pin table/.test(p)));
  assert.ok(reseal((m) => { m.components.required.find((c) => c.status === "pending").commit = "c".repeat(40); }).some((p) => /pending component/.test(p)));
}));

function digestFor(manifest) {
  const { manifestDigest, ...body } = manifest;
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v);
  return sha(canonical(body));
}

test("lockfile, fixture and vendored drift after the manifest was built are detected", withRepo((root) => {
  const manifest = buildManifest(root);
  writeFileSync(join(root, "package-lock.json"), "{\"lock\":2}\n");
  assert.ok(verifyManifest(root, manifest, { allowDirty: true }).some((p) => /package-lock/.test(p)));
  git(root, "checkout", "--", "package-lock.json");

  writeFileSync(join(root, "fixtures/approval/index.json"), "{\"changed\":true}\n");
  assert.ok(verifyManifest(root, manifest, { allowDirty: true }).some((p) => /fixture hash differs: fixtures\/approval\/index.json/.test(p)));
  git(root, "checkout", "--", "fixtures");

  writeFileSync(join(root, "src/server/vendor/agent-harness/src/a.js"), "module.exports = 2;\n");
  assert.throws(() => buildManifest(root, { allowDirty: true }), /drifted from MANIFEST/);
  assert.ok(verifyManifest(root, manifest, { allowDirty: true }).some((p) => /vendored/.test(p)));
}));

test("added, removed or unlisted tracked fixtures are detected", withRepo((root) => {
  const manifest = buildManifest(root);
  writeFileSync(join(root, "fixtures/context/extra.json"), "{}\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "more");
  const problems = verifyManifest(root, manifest);
  assert.ok(problems.some((p) => /tracked fixture missing from manifest: fixtures\/context\/extra.json/.test(p)));
  assert.ok(problems.some((p) => /not this checkout's HEAD/.test(p)));
}));

test("missing required inputs fail the build instead of producing a partial manifest", () => {
  for (const [rel, pattern] of [
    ["package-lock.json", /package-lock\.json/],
    ["integration/repository-map.json", /repository-map/],
    ["src/server/vendor/agent-harness/MANIFEST.json", /MANIFEST/],
    ["fixtures/order-authorization", /no tracked files/],
  ]) {
    const root = makeRepo();
    try {
      git(root, "rm", "-rq", rel);
      git(root, "commit", "-q", "-m", "rm");
      assert.throws(() => buildManifest(root), pattern, rel);
    } finally { cleanup(root); }
  }
});

test("a vendored MANIFEST path traversal or symlink is refused", withRepo((root) => {
  const manifestPath = join(root, "src/server/vendor/agent-harness/MANIFEST.json");
  const original = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(join(root, "outside.txt"), "o");
  for (const bad of ["../../../../../outside.txt", "/etc/hosts", "src/../src/a.js", "src\\a.js"]) {
    writeFileSync(manifestPath, JSON.stringify({ ...original, files: { [bad]: sha("o") } }));
    assert.throws(() => buildManifest(root, { allowDirty: true }), /unsafe path|escapes/, bad);
  }
  const link = join(root, "src/server/vendor/agent-harness/src/link.js");
  symlinkSync(join(root, "outside.txt"), link);
  writeFileSync(manifestPath, JSON.stringify({ ...original, files: { "src/link.js": sha("o") } }));
  assert.throws(() => buildManifest(root, { allowDirty: true }), /symlink refused/);
}));

test("a tracked symlink inside an allowlisted fixture suite is refused, not followed", withRepo((root) => {
  symlinkSync("/etc/hosts", join(root, "fixtures/context/leak.json"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "link");
  assert.throws(() => buildManifest(root), /symlink refused/);
  assert.throws(() => safeRegularFile(root, "../x", "fixtures"), /unsafe path/);
}));

test("CLI: writes only to ignored or external paths and verify exits non-zero on tamper", withRepo((root) => {
  // The CLI resolves its own repo root, so exercise it against a copy of the script inside the temp repo.
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/assembly-evidence.mjs"), readFileSync(CLI));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "script");
  const run = (...args) => {
    try { return { code: 0, out: execFileSync("node", [join(root, "scripts/assembly-evidence.mjs"), ...args], { encoding: "utf8", stdio: "pipe" }) }; }
    catch (error) { return { code: error.status, out: `${error.stdout}${error.stderr}` }; }
  };
  assert.equal(run("build").code, 0);
  assert.equal(run("verify").code, 0);
  const refused = run("build", "--out", "docs/manifest.json");
  assert.equal(refused.code, 1);
  assert.match(refused.out, /non-ignored path/);
  assert.equal(run("build", "--out", "package.json").code, 1);
  const external = join(root, "..", `external-${process.pid}.json`);
  try {
    assert.equal(run("build", "--out", external).code, 0);
    assert.equal(run("verify", external).code, 0);
    const text = readFileSync(external, "utf8").replace("not_accepted", "accepted");
    writeFileSync(external, text);
    const bad = run("verify", external);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /FAIL/);
    assert.equal(run("verify", join(root, "missing.json")).code, 1);
  } finally { rmSync(external, { force: true }); }
}));

test("the real checkout's inputs build a manifest whose pending pins stay pending", () => {
  const manifest = buildManifest(REAL_ROOT, { allowDirty: true });
  const pending = manifest.components.required.filter((c) => c.status === "pending").map((c) => c.name);
  assert.ok(pending.includes("event-intelligence") && pending.includes("creative-engine"));
  assert.equal(manifest.components.required.find((c) => c.name === "agent-harness").status, "installed-vendored");
  assert.equal(manifest.acceptance.status, "not_accepted");
});
