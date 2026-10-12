#!/usr/bin/env node
// GT-10B assembly-evidence manifest: an offline, reproducible SNAPSHOT of what this checkout actually contains
// (app git SHA, lockfile hash, declared vs runtime toolchain, vendored modules, tracked fixture identities) and
// which required component pins are still pending. It is tooling output, not integration, build, release or
// acceptance evidence: it records no command results and never reports a pending component as pinned.
//
//   node scripts/assembly-evidence.mjs build  [--out <file>] [--allow-dirty]
//   node scripts/assembly-evidence.mjs verify [<manifest>] [--allow-dirty]
//
// The default output (out/assembly-evidence/manifest.json) is git-ignored, so the app SHA is never committed into
// the app itself. No network, no provider calls, no .env or data reads; only tracked fixtures/vendor files are hashed.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "ticketstub.assembly-evidence/1";
export const MODE = "snapshot-tooling";
export const FIXTURE_SUITES = ["fixtures/approval", "fixtures/context", "fixtures/order-authorization"];
const VENDOR_DIR = "src/server/vendor";
const DEFAULT_OUT = "out/assembly-evidence/manifest.json";
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

// A repo-relative path must be plain, stay inside `base`, and be a regular file reached without any symlink.
export function safeRegularFile(root, rel, base = "") {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || rel.includes("\\") || isAbsolute(rel)) {
    throw new Error(`unsafe path: ${JSON.stringify(rel)}`);
  }
  if (rel.split("/").some((part) => part === ".." || part === "." || part === "")) throw new Error(`unsafe path: ${rel}`);
  const full = resolve(root, base, rel);
  const baseFull = resolve(root, base);
  if (full !== baseFull && !full.startsWith(baseFull + sep)) throw new Error(`path escapes ${base || "repo"}: ${rel}`);
  let current = baseFull;
  for (const part of relative(baseFull, full).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink refused: ${relative(root, current)}`);
  }
  if (!lstatSync(full).isFile()) throw new Error(`not a regular file: ${rel}`);
  if (realpathSync(full) !== join(realpathSync(root), base, rel)) throw new Error(`path resolves elsewhere: ${rel}`);
  return full;
}

const hashFile = (root, rel, base) => sha256(readFileSync(safeRegularFile(root, rel, base)));

function requireFile(root, rel) {
  try { return hashFile(root, rel, ""); }
  catch (error) { throw new Error(`required input missing or unsafe: ${rel} (${error.message})`); }
}

function appState(root) {
  const sha = git(root, "rev-parse", "HEAD").trim();
  if (!HEX40.test(sha)) throw new Error("could not read app git SHA");
  const dirtyPaths = git(root, "status", "--porcelain", "-z", "--untracked-files=all")
    .split("\0").filter(Boolean).map((entry) => entry.slice(3)).sort();
  const branch = git(root, "rev-parse", "--abbrev-ref", "HEAD").trim();
  return { sha, branch, dirty: dirtyPaths.length > 0, dirtyPaths };
}

function toolchain(root) {
  const pkg = JSON.parse(readFileSync(safeRegularFile(root, "package.json"), "utf8"));
  const npmVersion = execFileSync("npm", ["--version"], { cwd: root, encoding: "utf8" }).trim();
  const declared = { nodeRange: pkg.engines?.node ?? null, npmRange: pkg.engines?.npm ?? null, packageManager: pkg.packageManager ?? null };
  const pinnedNpm = /^npm@(\d+\.\d+\.\d+)$/.exec(declared.packageManager ?? "")?.[1] ?? null;
  const runtime = { node: process.versions.node, npm: npmVersion };
  return {
    declared, runtime,
    // Declared and runtime are recorded separately; a mismatch is visible, never papered over.
    runtimeMatchesPackageManager: pinnedNpm !== null && pinnedNpm === npmVersion,
  };
}

function vendored(root) {
  const out = [];
  const vendorRoot = safeDir(root, VENDOR_DIR);
  for (const name of readdirSync(vendorRoot).sort()) {
    const base = `${VENDOR_DIR}/${name}`;
    if (lstatSync(join(root, base)).isSymbolicLink() || !lstatSync(join(root, base)).isDirectory()) throw new Error(`vendor entry is not a plain directory: ${base}`);
    const manifest = JSON.parse(readFileSync(safeRegularFile(root, "MANIFEST.json", base), "utf8"));
    if (!HEX40.test(manifest.commit ?? "")) throw new Error(`${base}/MANIFEST.json has no 40-hex commit`);
    const files = {};
    for (const [rel, declared] of Object.entries(manifest.files ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const actual = hashFile(root, rel, base);
      if (actual !== declared) throw new Error(`vendored file drifted from MANIFEST.json: ${base}/${rel}`);
      files[rel] = actual;
    }
    if (!Object.keys(files).length) throw new Error(`${base}/MANIFEST.json lists no files`);
    out.push({
      name, status: "installed-vendored", repository: manifest.repository ?? null, commit: manifest.commit,
      manifestSha256: hashFile(root, "MANIFEST.json", base), files,
    });
  }
  if (!out.length) throw new Error(`no vendored modules under ${VENDOR_DIR}`);
  return out;
}

function safeDir(root, rel) {
  const full = resolve(root, rel);
  if (lstatSync(full).isSymbolicLink() || realpathSync(full) !== join(realpathSync(root), rel)) throw new Error(`directory unsafe: ${rel}`);
  return full;
}

function fixtures(root) {
  const suites = {};
  for (const suite of FIXTURE_SUITES) {
    const tracked = git(root, "ls-files", "-z", "--", suite).split("\0").filter(Boolean).sort();
    if (!tracked.length) throw new Error(`required fixture suite has no tracked files: ${suite}`);
    const files = {};
    for (const rel of tracked) files[rel] = hashFile(root, rel, "");
    suites[suite] = { fileCount: tracked.length, digest: digestOf(files), files };
  }
  return suites;
}

// Required component pins come from the planning inventory's composition root; the inventory itself is never a pin.
function components(root, vendoredModules) {
  const inventoryHash = requireFile(root, "integration/repository-map.json");
  const map = JSON.parse(readFileSync(join(root, "integration/repository-map.json"), "utf8"));
  const rootRepo = map.repositories.find((repo) => repo.id === map.integration_root || repo.name === map.integration_root);
  if (!rootRepo) throw new Error("repository map has no integration root");
  const byName = new Map(vendoredModules.map((entry) => [entry.name, entry]));
  return {
    plannedInventorySha256: inventoryHash,
    note: "planned_inventory is not a tested dependency pin",
    required: rootRepo.planned_package_dependencies.map((name) => {
      const entry = byName.get(name);
      return entry
        ? { name, status: "installed-vendored", commit: entry.commit, source: `${VENDOR_DIR}/${name}/MANIFEST.json` }
        : { name, status: "pending", reason: "no installed or vendored revision in this checkout; planned inventory only" };
    }),
  };
}

function digestOf(value) { return sha256(canonical(value)); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildManifest(root, { allowDirty = false } = {}) {
  const app = appState(root);
  if (app.dirty && !allowDirty) {
    throw new Error(`working tree is dirty (${app.dirtyPaths.length} paths); commit first or pass --allow-dirty for a non-reproducible snapshot`);
  }
  const vendoredModules = vendored(root);
  const body = {
    schema: SCHEMA,
    mode: MODE,
    app: { ...app, reproducible: !app.dirty },
    lockfile: { path: "package-lock.json", sha256: requireFile(root, "package-lock.json") },
    toolchain: toolchain(root),
    vendored: vendoredModules,
    components: components(root, vendoredModules),
    fixtures: fixtures(root),
    executed: [],
    acceptance: {
      status: "not_accepted",
      statement: "Snapshot of checkout identities only. No lint, typecheck, build, integration suite, journey, provider or release check was executed or implied; pending pins mean GT-10B.1 is unmet.",
    },
  };
  return { ...body, manifestDigest: digestOf(body) };
}

// Returns a list of problems (empty = consistent with this checkout). Never throws on bad manifest content.
export function verifyManifest(root, manifest, { allowDirty = false } = {}) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return ["manifest is not an object"];
  const { manifestDigest, ...body } = manifest;
  if (manifest.schema !== SCHEMA) fail(`unsupported schema: ${manifest.schema}`);
  if (manifest.mode !== MODE) fail(`unexpected mode label: ${manifest.mode}`);
  if (!HEX64.test(manifestDigest ?? "") || manifestDigest !== digestOf(body)) fail("manifestDigest does not match manifest content (tampered or edited)");
  if (manifest.acceptance?.status !== "not_accepted") fail("acceptance.status must be not_accepted for a snapshot manifest");
  if (!Array.isArray(manifest.executed) || manifest.executed.length) fail("snapshot manifest must not carry executed results");
  if (manifest.app?.dirty || manifest.app?.reproducible === false) {
    if (!allowDirty) fail("manifest was produced from a dirty tree (not reproducible)");
  }
  try {
    const app = appState(root);
    if (manifest.app?.sha !== app.sha) fail(`app SHA ${manifest.app?.sha} is not this checkout's HEAD ${app.sha}`);
    if (app.dirty && !allowDirty) fail("checkout is dirty");
  } catch (error) { fail(`cannot read git state: ${error.message}`); }

  const attempt = (label, fn) => { try { return fn(); } catch (error) { fail(`${label}: ${error.message}`); return null; } };
  attempt("lockfile", () => {
    if (manifest.lockfile?.sha256 !== hashFile(root, "package-lock.json", "")) fail("package-lock.json hash differs");
  });
  attempt("vendored", () => {
    const current = vendored(root);
    if (canonical(current) !== canonical(manifest.vendored)) fail("vendored module identities differ from checkout");
    for (const entry of manifest.vendored ?? []) if (entry.status !== "installed-vendored") fail(`vendored ${entry.name}: bad status ${entry.status}`);
  });
  attempt("fixtures", () => {
    const current = fixtures(root);
    if (canonical(Object.keys(current)) !== canonical(Object.keys(manifest.fixtures ?? {}).sort())) fail("fixture suite set differs from allowlist");
    for (const [suite, entry] of Object.entries(current)) {
      const recorded = manifest.fixtures?.[suite];
      if (!recorded) continue;
      const names = new Set([...Object.keys(entry.files), ...Object.keys(recorded.files ?? {})]);
      for (const name of [...names].sort()) {
        if (!(name in entry.files)) fail(`fixture listed but not tracked: ${name}`);
        else if (!(name in (recorded.files ?? {}))) fail(`tracked fixture missing from manifest: ${name}`);
        else if (entry.files[name] !== recorded.files[name]) fail(`fixture hash differs: ${name}`);
      }
      if (recorded.digest !== entry.digest) fail(`fixture suite digest differs: ${suite}`);
    }
  });
  attempt("components", () => {
    const currentComponents = components(root, vendored(root));
    if (canonical(currentComponents) !== canonical(manifest.components)) fail("component pin table differs from checkout");
    for (const component of manifest.components?.required ?? []) {
      if (component.status === "pending" && (component.commit || component.sha256)) fail(`pending component ${component.name} carries a pin`);
      if (component.status !== "pending" && !HEX40.test(component.commit ?? "")) fail(`component ${component.name} claims ${component.status} without a 40-hex commit`);
      if (!["pending", "installed-vendored"].includes(component.status)) fail(`component ${component.name}: unknown status ${component.status}`);
    }
  });
  return problems;
}

function parseArgs(argv) {
  const args = { positional: [], allowDirty: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--allow-dirty") args.allowDirty = true;
    else if (argv[i] === "--out") { args.out = argv[i + 1]; i += 1; }
    else if (argv[i].startsWith("--")) throw new Error(`unknown option: ${argv[i]}`);
    else args.positional.push(argv[i]);
  }
  return args;
}

// Default/explicit output must not land on a tracked path or inside an un-ignored part of the repo.
function checkOutputPath(root, out) {
  const full = resolve(root, out);
  const rel = relative(root, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return full; // explicit user-chosen path outside the repo
  const tracked = git(root, "ls-files", "--", rel).trim();
  if (tracked) throw new Error(`refusing to overwrite tracked file: ${rel}`);
  try { execFileSync("git", ["check-ignore", "-q", "--", rel], { cwd: root }); }
  catch { throw new Error(`refusing to write inside the repo to a non-ignored path: ${rel} (the app SHA must not be committed)`); }
  return full;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const [command, ...rest] = process.argv.slice(2);
  try {
    const args = parseArgs(rest);
    if (command === "build") {
      const target = checkOutputPath(root, args.out ?? DEFAULT_OUT);
      const manifest = buildManifest(root, { allowDirty: args.allowDirty });
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
      const pending = manifest.components.required.filter((c) => c.status === "pending").map((c) => c.name);
      console.log(`wrote ${target}\napp ${manifest.app.sha} dirty=${manifest.app.dirty} mode=${MODE} acceptance=not_accepted\npending pins: ${pending.join(", ") || "none"}`);
    } else if (command === "verify") {
      const file = resolve(root, args.positional[0] ?? DEFAULT_OUT);
      let manifest;
      try { manifest = JSON.parse(readFileSync(file, "utf8")); } catch (error) { throw new Error(`cannot read manifest ${file}: ${error.message}`); }
      const problems = verifyManifest(root, manifest, { allowDirty: args.allowDirty });
      if (problems.length) { for (const p of problems) console.error(`FAIL ${p}`); process.exit(1); }
      console.log(`manifest consistent with checkout (${MODE}; not an acceptance result)`);
    } else {
      console.error("usage: node scripts/assembly-evidence.mjs build [--out file] [--allow-dirty] | verify [manifest] [--allow-dirty]");
      process.exit(2);
    }
  } catch (error) { console.error(`error: ${error.message}`); process.exit(1); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
