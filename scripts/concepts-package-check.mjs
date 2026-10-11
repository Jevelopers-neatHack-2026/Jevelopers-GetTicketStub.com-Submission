import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const buildRoot = join(repoRoot, "build/concepts-package-artifacts");
const now = () => new Date().toISOString();
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const argIndex = process.argv.indexOf("--evidence-dir");
const relativeEvidenceDir = argIndex >= 0 ? process.argv[argIndex + 1] :
  join("build/concepts-package-artifacts", `${process.version}-${Date.now()}-${randomBytes(4).toString("hex")}`);
assert.ok(relativeEvidenceDir && !relativeEvidenceDir.startsWith("--"), "--evidence-dir requires a unique path");
const artifactDir = resolve(repoRoot, relativeEvidenceDir);
assert.ok(artifactDir === join(repoRoot, "build") || artifactDir.startsWith(join(repoRoot, "build") + sep),
  "Package evidence must stay under this checkout's build directory.");
const commandsDir = join(artifactDir, "commands");
const consumerDir = join(artifactDir, "consumer");
const commands = [];
const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
  npm_config_offline: "true" };
mkdirSync(buildRoot, { recursive: true });
mkdirSync(artifactDir, { recursive: false });
mkdirSync(commandsDir);
mkdirSync(consumerDir);

function run(label, command, argv, cwd) {
  const startedAt = now();
  const result = spawnSync(command, argv, { cwd, env, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
  const stdout = result.stdout ?? Buffer.alloc(0);
  const stderr = result.stderr ?? Buffer.alloc(0);
  const ordinal = String(commands.length + 1).padStart(2, "0");
  const stdoutPath = join(commandsDir, `${ordinal}-${label}.stdout`);
  const stderrPath = join(commandsDir, `${ordinal}-${label}.stderr`);
  writeFileSync(stdoutPath, stdout, { mode: 0o600 });
  writeFileSync(stderrPath, stderr, { mode: 0o600 });
  const item = { label, command, argv, cwd, node_executable: process.execPath, node_version: process.version,
    started_at: startedAt, completed_at: now(), exit_code: result.status, signal: result.signal ?? null,
    error: result.error ? `${result.error.name}: ${result.error.message}` : null,
    stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr), stdout_path: stdoutPath, stderr_path: stderrPath,
    stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
  commands.push(item);
  assert.equal(item.exit_code, 0, `${label} failed (${item.exit_code ?? item.error}): ${item.stderr}`);
  return item;
}

function replaceOnce(source, before, after, label) {
  assert.equal(source.split(before).length - 1, 1, `Expected one ${label} marker in retained consumer fixture.`);
  return source.replace(before, after);
}

function treeSha256(root) {
  const digest = createHash("sha256");
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (name === "node_modules") continue;
      const path = join(directory, name);
      const key = relative(consumerDir, path).split(sep).join("/");
      const info = statSync(path);
      if (info.isDirectory()) visit(path);
      else {
        digest.update(key).update("\0").update(readFileSync(path)).update("\0");
      }
    }
  }
  visit(root);
  return digest.digest("hex");
}

function copyPublicApiJourneyFixtures() {
  mkdirSync(join(consumerDir, "fixtures"), { recursive: true });
  cpSync(join(repoRoot, "fixtures/api"), join(consumerDir, "fixtures/api"), { recursive: true });
  mkdirSync(join(consumerDir, "fixtures/contracts"), { recursive: true });
  cpSync(join(repoRoot, "fixtures/contracts/creative"), join(consumerDir, "fixtures/contracts/creative"), { recursive: true });
  mkdirSync(join(consumerDir, "fixtures/models"), { recursive: true });
  copyFileSync(join(repoRoot, "fixtures/models/png.mjs"), join(consumerDir, "fixtures/models/png.mjs"));
  mkdirSync(join(consumerDir, "fixtures/planning"), { recursive: true });
  copyFileSync(join(repoRoot, "fixtures/planning/research-packages.mjs"),
    join(consumerDir, "fixtures/planning/research-packages.mjs"));
  const testDir = join(consumerDir, "tests/models");
  mkdirSync(testDir, { recursive: true });
  let integration = readFileSync(join(repoRoot, "tests/models/creative-api-integration.test.mjs"), "utf8");
  for (const [before, after, label] of [
    ['"../../src/api/v1.mjs"', '"creative-engine/api/v1"', "installed API import"],
    ['"../../src/contracts/index.mjs"', '"creative-engine/contracts"', "installed contracts import"],
    ['"../../src/versions/api-ports.mjs"', '"creative-engine/versions"', "installed version ports import"],
    ['"../../src/versions/store.mjs"', '"creative-engine/versions"', "installed version store import"],
    ['"../../src/telemetry/index.mjs"', '"creative-engine/telemetry"', "installed telemetry import"],
  ]) integration = replaceOnce(integration, before, after, label);
  integration = replaceOnce(integration,
    '  assert.equal(context.counters.provider_posts - countersBeforeConcepts.provider_posts, 2,\n' +
    '    "completed replay returns durable siblings without a second dispatch");\n});',
    '  assert.equal(context.counters.provider_posts - countersBeforeConcepts.provider_posts, 2,\n' +
    '    "completed replay returns durable siblings without a second dispatch");\n' +
    '  t.diagnostic("INSTALLED_CONCEPTS_PUBLIC_JOURNEY " + JSON.stringify({\n' +
    '    native_posts: context.counters.provider_posts - countersBeforeConcepts.provider_posts,\n' +
    '    sibling_count: replayed.result.candidates.length,\n' +
    '    parent_version_ids: replayed.result.candidates.map((candidate) => candidate.design_version.parent_version_id),\n' +
    '    replayed: replayed.replayed, candidate_ids: replayed.result.candidates.map((candidate) => candidate.design_version.design_version_id),\n' +
    '  }));\n});', "installed public journey diagnostic");
  integration = replaceOnce(integration,
    '  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: "concept-rights-negative" }).length, 0);\n});',
    '  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: "concept-rights-negative" }).length, 0);\n' +
    '  t.diagnostic("INSTALLED_CONCEPTS_NEGATIVES " + JSON.stringify({ native_posts: context.counters.provider_posts,\n' +
    '    reserves: context.counters.reserves, settlements: context.counters.settlements, held: context.counters.held }));\n});',
    "installed negative journey diagnostic");
  writeFileSync(join(testDir, "creative-api-integration.test.mjs"), integration, { mode: 0o600 });

  const helperDir = join(consumerDir, "tests/versions");
  mkdirSync(helperDir, { recursive: true });
  let helper = readFileSync(join(repoRoot, "tests/versions/helpers.mjs"), "utf8");
  helper = replaceOnce(helper, '"../../src/contracts/index.mjs"', '"creative-engine/contracts"', "installed helper contracts import");
  helper = replaceOnce(helper, '"../../src/versions/store.mjs"', '"creative-engine/versions"', "installed helper store import");
  helper = replaceOnce(helper, 'import { hashArtifactBytes } from "../../src/storage/content-addressed.mjs";',
    'import { createHash } from "node:crypto";\nfunction hashArtifactBytes(bytes) {\n' +
    '  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected artifact bytes.");\n' +
    '  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;\n}',
    "fixture-only artifact hash helper");
  writeFileSync(join(helperDir, "helpers.mjs"), helper, { mode: 0o600 });
}

let summary = { evidence_schema: "creative-concepts-package-installation/1.1", status: "running",
  runtime: process.version, artifact_dir: artifactDir, package_name: "creative-engine",
  public_subpath: "creative-engine/api/v1", provider_dispatches: 0, paid_provider_calls: 0,
  actual_network_requests: 0, provider_credentials_read: false, commands };
try {
  assert.ok(["v22.23.3", "v24.15.0"].includes(process.version),
    `Use pinned Node 22.23.3 or 24.15.0, got ${process.version}`);
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.ok(manifest.files.includes("src/generation"), "The package must ship its concept runtime dependency.");
  const packed = run("npm-pack", "npm", ["pack", "--json", "--pack-destination", artifactDir], repoRoot);
  const packSummary = JSON.parse(packed.stdout);
  assert.equal(packSummary.length, 1);
  const pack = packSummary[0];
  const tarballPath = join(artifactDir, pack.filename);
  const tarballBytes = readFileSync(tarballPath);
  const files = pack.files.map(item => item.path).sort();
  for (const target of ["src/api/v1.mjs", "src/api/v1.d.mts", "src/runtime/creative-runtime.mjs",
    "src/generation/concepts.mjs", "src/generation/concepts.d.mts"]) {
    assert.ok(files.includes(target), `Packed package is missing ${target}`);
  }

  writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify({ name: "concepts-installed-consumer",
    version: "1.0.0", private: true, type: "module" }, null, 2)}\n`);
  copyFileSync(join(repoRoot, "tests/api/concepts-public-consumer.mts"), join(consumerDir, "public-consumer.mts"));
  copyPublicApiJourneyFixtures();
  writeFileSync(join(consumerDir, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
    noEmit: true, strict: true, skipLibCheck: false, module: "NodeNext", moduleResolution: "NodeNext",
    target: "ES2022" }, files: ["public-consumer.mts"] }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(consumerDir, "runtime-consumer.mjs"), `import assert from "node:assert/strict";\n` +
    `import { CREATIVE_API_VERSIONS, createCreativeApi } from "creative-engine/api/v1";\n` +
    `assert.deepEqual(CREATIVE_API_VERSIONS, ["1.0", "1.1"]);\n` +
    `assert.equal(typeof createCreativeApi().invoke, "function");\n` +
    `process.stdout.write(JSON.stringify({ versions: CREATIVE_API_VERSIONS, concepts_runtime_imported: true }) + "\\n");\n`);
  run("offline-package-install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
    "--package-lock=false", "--no-save", tarballPath], consumerDir);
  const installedPackageRoot = join(consumerDir, "node_modules/creative-engine");
  const codecRoot = join(installedPackageRoot, "src/models/codec-runtime");
  run("offline-installed-codec-dependencies", "npm", ["ci", "--offline", "--ignore-scripts", "--prefix", codecRoot], consumerDir);
  const runtime = run("installed-package-import-smoke", process.execPath, ["runtime-consumer.mjs"], consumerDir);
  const runtimeResult = JSON.parse(runtime.stdout.trim());
  assert.deepEqual(runtimeResult, { versions: ["1.0", "1.1"], concepts_runtime_imported: true });

  const installedJourney = run("installed-public-concepts-api-journey", process.execPath,
    ["--test", "--test-concurrency=1", "--test-reporter=tap",
      "--test-name-pattern=actual Creative API v1\\.1 concepts\\.create edits two authorized references and publishes parentless siblings|concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST",
      "tests/models/creative-api-integration.test.mjs"], consumerDir);
  assert.match(installedJourney.stdout, /# tests 2\n# suites 0\n# pass 2\n# fail 0/,
    "The retained installed-package fixture must execute the public two-reference and negative-version journeys.");
  assert.match(installedJourney.stdout, /2 tests? passed|# pass 2/);
  assert.doesNotMatch(installedJourney.stdout, /not ok /);
  const publicJourneyLine = installedJourney.stdout.split("\n").find(line => line.includes("INSTALLED_CONCEPTS_PUBLIC_JOURNEY "));
  const negativeJourneyLine = installedJourney.stdout.split("\n").find(line => line.includes("INSTALLED_CONCEPTS_NEGATIVES "));
  assert.ok(publicJourneyLine && negativeJourneyLine, "The TAP stream must retain measured journey counters.");
  const publicJourney = JSON.parse(publicJourneyLine.slice(publicJourneyLine.indexOf("INSTALLED_CONCEPTS_PUBLIC_JOURNEY ") +
    "INSTALLED_CONCEPTS_PUBLIC_JOURNEY ".length));
  const negativeJourney = JSON.parse(negativeJourneyLine.slice(negativeJourneyLine.indexOf("INSTALLED_CONCEPTS_NEGATIVES ") +
    "INSTALLED_CONCEPTS_NEGATIVES ".length));
  assert.equal(publicJourney.native_posts, 2);
  assert.equal(publicJourney.sibling_count, 2);
  assert.deepEqual(publicJourney.parent_version_ids, [null, null]);
  assert.equal(publicJourney.replayed, true);
  assert.deepEqual(negativeJourney, { native_posts: 0, reserves: 0, settlements: 0, held: 0 });

  const compiler = join(repoRoot, "examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc");
  const compilerVersion = run("typescript-version", process.execPath, [compiler, "--version"], consumerDir);
  assert.equal(compilerVersion.stdout.trim(), "Version 5.9.3");
  const types = run("strict-installed-consumer-types", process.execPath, [compiler, "--project", "tsconfig.json"], consumerDir);
  assert.equal(types.exit_code, 0);
  summary = { ...summary, status: "passed", package_version: manifest.version,
    provider_dispatches: publicJourney.native_posts, paid_provider_calls: 0, actual_network_requests: 0,
    tarball: { path: tarballPath, filename: pack.filename, bytes: tarballBytes.length, sha256: sha256(tarballBytes), files,
      required_generation_files: ["src/generation/concepts.mjs", "src/generation/concepts.d.mts"] },
    installed_consumer: { import_smoke_result: runtimeResult, public_api_journey: {
      test_file: join(consumerDir, "tests/models/creative-api-integration.test.mjs"),
      fixtures: ["two authorized reference assets", "C03 reserve/settle/reconciliation fixture", "intercepted native edits fetch"],
      test_names: ["actual Creative API v1.1 concepts.create edits two authorized references and publishes parentless siblings",
        "concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST"],
      assertions: ["POST /images/edits carries both authorized image[] references", "two immutable parentless versions are publicly listed, compared, restored, and inspected",
        "completed duplicate replay performs no second dispatch", "v1.0 concepts and v1.1 legacy operation negatives dispatch zero times"],
      measured: { ...publicJourney, negatives: negativeJourney }, tap_sha256: sha256(Buffer.from(installedJourney.stdout)),
      test_summary: "2 passed, 0 failed" },
      typescript: compilerVersion.stdout.trim(), typecheck: "strict NodeNext/ES2022 with expected-negative version and authority assertions",
      fixture_tree_sha256: treeSha256(consumerDir) },
    install_mode: "fresh local tarball install; offline; lifecycle scripts disabled; intercepted fixture provider; no credentials or network",
    evidence_retention: "This run's tarball, installed package, copied consumer/type fixture, TAP stream, and every nested command's raw stdout/stderr remain under artifact_dir." };
} catch (error) {
  summary = { ...summary, status: "failed", error: `${error.name}: ${error.message}` };
  process.exitCode = 1;
} finally {
  summary.commands = commands.map(({ stdout, stderr, ...item }) => item);
  summary.completed_at = now();
  writeFileSync(join(artifactDir, "package-check-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
