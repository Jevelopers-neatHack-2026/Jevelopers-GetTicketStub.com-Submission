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
  copyFileSync(join(repoRoot, "fixtures/models/creative-api-fixture.mjs"), join(consumerDir, "fixtures/models/creative-api-fixture.mjs"));
  copyFileSync(join(repoRoot, "fixtures/models/valid-16x16.jpg"), join(consumerDir, "fixtures/models/valid-16x16.jpg"));
  copyFileSync(join(repoRoot, "fixtures/models/valid-16x16.webp"), join(consumerDir, "fixtures/models/valid-16x16.webp"));
  mkdirSync(join(consumerDir, "fixtures/planning"), { recursive: true });
  copyFileSync(join(repoRoot, "fixtures/planning/research-packages.mjs"),
    join(consumerDir, "fixtures/planning/research-packages.mjs"));
  const testDir = join(consumerDir, "tests/models");
  mkdirSync(testDir, { recursive: true });
  let integration = readFileSync(join(repoRoot, "tests/models/creative-api-integration.test.mjs"), "utf8");
  for (const [before, after, label] of [
    ['"../../src/contracts/index.mjs"', '"creative-engine/contracts"', "installed contracts import"],
    ['"../../src/contracts/composition-authority.mjs"', '"creative-engine/contracts/composition-authority"', "installed composition contract import"],
    ['"../../src/contracts/approval-handoff.mjs"', '"creative-engine/contracts/approval-handoff"', "installed approval handoff import"],
    ['"../../src/versions/store.mjs"', '"creative-engine/versions"', "installed version store import"],
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

let summary = { evidence_schema: "creative-concepts-package-installation/1.2", status: "running",
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
  copyFileSync(join(repoRoot, "tests/api/concepts-public-consumer.mts"), join(consumerDir, "concepts-public-consumer.mts"));
  copyFileSync(join(repoRoot, "tests/api/composition-public-consumer.mts"), join(consumerDir, "composition-public-consumer.mts"));
  copyPublicApiJourneyFixtures();
  writeFileSync(join(consumerDir, "tsconfig.json"), `${JSON.stringify({ compilerOptions: {
    noEmit: true, strict: true, skipLibCheck: false, module: "NodeNext", moduleResolution: "NodeNext",
    noUncheckedIndexedAccess: true, target: "ES2022" },
    files: ["concepts-public-consumer.mts", "composition-public-consumer.mts"] }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(consumerDir, "runtime-consumer.mjs"), `import assert from "node:assert/strict";\n` +
    `import { CREATIVE_API_VERSIONS, createCreativeApi } from "creative-engine/api/v1";\n` +
    `import { snapshotCompositionBytesRecord } from "creative-engine/contracts/composition-authority";\n` +
    `assert.deepEqual(CREATIVE_API_VERSIONS, ["1.0", "1.1", "1.2", "1.3"]);\n` +
    `assert.equal(typeof createCreativeApi().invoke, "function");\n` +
    `const hostile = new Uint8Array([1,2,3]); let byteLengthReads = 0; let iteratorReads = 0;\n` +
    `Object.defineProperty(hostile, "byteLength", { configurable: true, get() { byteLengthReads++; hostile[0]=99; return 1; } });\n` +
    `Object.defineProperty(hostile, Symbol.iterator, { configurable: true, get() { iteratorReads++; hostile[0]=88; return function*(){yield 77;}; } });\n` +
    `const copied = snapshotCompositionBytesRecord({preview_bytes:hostile,mime_type:"image/png"});\n` +
    `assert.deepEqual([...copied.bytes], [1,2,3]); assert.equal(byteLengthReads,0); assert.equal(iteratorReads,0);\n` +
    `process.stdout.write(JSON.stringify({ versions: CREATIVE_API_VERSIONS, concepts_runtime_imported: true,\n` +
    `  composition_runtime_imported:true, exact_hostile_byte_snapshot:true }) + "\\n");\n`);
  run("offline-package-install", "npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund",
    "--package-lock=false", "--no-save", tarballPath], consumerDir);
  const installedPackageRoot = join(consumerDir, "node_modules/creative-engine");
  const codecRoot = join(installedPackageRoot, "src/models/codec-runtime");
  run("offline-installed-codec-dependencies", "npm", ["ci", "--offline", "--ignore-scripts", "--prefix", codecRoot], consumerDir);
  const runtime = run("installed-package-import-smoke", process.execPath, ["runtime-consumer.mjs"], consumerDir);
  const runtimeResult = JSON.parse(runtime.stdout.trim());
  assert.deepEqual(runtimeResult, { versions: ["1.0", "1.1", "1.2", "1.3"], concepts_runtime_imported: true,
    composition_runtime_imported: true, exact_hostile_byte_snapshot: true });

  const installedJourneyTitles = [
    "actual Creative API v1.1 concepts.create edits two authorized references and publishes parentless siblings",
    "concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST",
    "a settled per-slot request conflict preserves the other immutable ordinal across replay and reopen",
    "concept publication rejects a forged slot ordinal before either generic sibling becomes visible",
    "completed concepts replay validates its retained brief after a legitimate brief revision",
    "durable native authorization, quota, policy, permission, and malformed-request hard stops prevent more concept spend",
    "API 1.2 composition.get remains null until explicit create publishes exact owner bytes",
    "API 1.3 history exposes identity only and fresh revalidation restores current service after expiry and same-design restore",
    "composition create/get validate exact decoded PNG, JPEG, and WebP preview metadata",
    "composition.create rejects preview bytes that are not the declared decoded image",
    "composition completed replay rejects hash-consistent corrupt preview bytes without rerunning effects",
    "composition.update rejects a preview provider result whose bytes do not decode to its metadata",
    "composition.get rejects a locally expired rights proof after an awaited asset read",
    "composition.get runs a synchronous local fence after the final awaited current read",
    "composition.get preserves final storage integrity errors separately from ordinary unavailability",
    "composition publication rechecks queued owner revocation after awaited persistence and before commit",
    "composition.update applies a typed plan, publishes a child preview once, and replays exact durable bytes",
    "composition.update rolls back when rights are revoked in the final awaited publication gap",
    "public cancel recovers a pending composition.update in its brief scope",
    "composition.update resumes an immutable staged preview after lease recovery without repeating the preview effect",
  ];
  const installedJourneyPattern = installedJourneyTitles
    .map((title) => title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const installedJourney = run("installed-public-composition-and-concepts-api-journey", process.execPath,
    ["--test", "--test-concurrency=1", "--test-reporter=tap", `--test-name-pattern=${installedJourneyPattern}`,
      "tests/models/creative-api-integration.test.mjs"], consumerDir);
  assert.match(installedJourney.stdout, /^# fail 0$/m, "The installed API and composition journeys must pass.");
  assert.match(installedJourney.stdout, /^# skipped 0$/m, "The installed API and composition journeys must not skip cases.");
  assert.match(installedJourney.stdout, /^# cancelled 0$/m, "The installed API and composition journeys must finish all cases.");
  for (const title of installedJourneyTitles) {
    assert.ok(installedJourney.stdout.includes(`# Subtest: ${title}`), `Installed TAP is missing ${title}`);
  }
  const installedTestCounts = {
    tests: Number(installedJourney.stdout.match(/^# tests (\d+)$/m)?.[1] ?? 0),
    passed: Number(installedJourney.stdout.match(/^# pass (\d+)$/m)?.[1] ?? 0),
  };
  assert.ok(installedTestCounts.tests > 19 && installedTestCounts.passed === installedTestCounts.tests,
    "The installed package must execute the concepts and composition journeys, not merely resolve imports.");
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
        "concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST",
        "a settled per-slot request conflict preserves the other immutable ordinal across replay and reopen",
        "concept publication rejects a forged slot ordinal before either generic sibling becomes visible",
        "completed concepts replay validates its retained brief after a legitimate brief revision",
        "durable native authorization, quota, policy, permission, and malformed-request hard stops prevent more concept spend"],
      assertions: ["POST /images/edits carries both authorized image[] references", "two immutable parentless versions are publicly listed, compared, restored, and inspected",
        "completed duplicate replay performs no second dispatch", "v1.0 concepts and v1.1 legacy operation negatives dispatch zero times",
        "a settled per-slot failure preserves the other ordered candidate across replay and reopen",
        "forged ordinal publication cannot expose either generic sibling",
        "completed replay fails closed against missing or hash-tampered retained brief history",
        "auth, permission, quota, moderation, and malformed-request hard stops block fresh sibling spend and replay"],
      measured: { ...publicJourney, negatives: negativeJourney }, tap_sha256: sha256(Buffer.from(installedJourney.stdout)),
      selected_journey_count: installedJourneyTitles.length, test_summary: `${installedTestCounts.tests} TAP tests passed, 0 failed/skipped/cancelled`,
      composition_journey_count: 14 },
      typescript: compilerVersion.stdout.trim(), typecheck: "strict NodeNext/ES2022/noUncheckedIndexedAccess against installed package with expected-negative version, plan, and async-fence assertions",
      fixture_tree_sha256: treeSha256(consumerDir) },
    install_mode: "fresh local tarball install; offline; lifecycle scripts disabled; intercepted fixture provider; no credentials or network",
    evidence_retention: "This run's tarball, installed package, copied consumers/type fixtures and image fixtures, TAP stream, and every nested command's raw stdout/stderr remain under artifact_dir." };
} catch (error) {
  summary = { ...summary, status: "failed", error: `${error.name}: ${error.message}` };
  process.exitCode = 1;
} finally {
  summary.commands = commands.map(({ stdout, stderr, ...item }) => item);
  summary.completed_at = now();
  writeFileSync(join(artifactDir, "package-check-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
