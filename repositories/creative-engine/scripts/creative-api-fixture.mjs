import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { canonicalHash } from "creative-engine/contracts";
import { hash } from "../fixtures/models/creative-api-fixture.mjs";
import { CREATIVE_API_SCENARIOS, runCreativeApiScenario } from "../fixtures/models/creative-api-scenarios.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWN_FILES = ["fixtures/models/creative-api-fixture.mjs", "fixtures/models/creative-api-scenarios.mjs",
  "scripts/creative-api-fixture.mjs", "tests/models/creative-api-fixture-consumer.test.mjs"];

function git(...args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Fixture source pin failed: git ${args.join(" ")}`);
  return result.stdout.trimEnd();
}

async function sourcePins() {
  const paths = new Set([...git("ls-files", "-z", "--", "src", "fixtures", "scripts", "tests/models",
    "package.json", "package-lock.json", "Makefile").split("\0").filter(Boolean), ...OWN_FILES]);
  const inputs = [];
  for (const relative of [...paths].sort()) {
    const filename = path.join(repoRoot, relative);
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Fixture source input is not a regular file: ${relative}`);
    const bytes = await readFile(filename);
    inputs.push({ path: relative, sha256: hash(bytes), bytes: bytes.length });
  }
  const codec = JSON.parse(await readFile(path.join(repoRoot, "src/models/codec-runtime/package.json"), "utf8"));
  return {
    repository: "https://github.com/Jevelopers-neatHack-2026/creative-engine",
    commit_sha: git("rev-parse", "HEAD"), tree_sha: git("rev-parse", "HEAD^{tree}"),
    working_tree_status: git("status", "--porcelain=v1").split("\n").filter(Boolean),
    input_manifest_sha256: canonicalHash(inputs), inputs,
    runtime: { node: process.versions.node, executable_sha256: hash(await readFile(process.execPath)),
      sqlite: process.versions.sqlite, platform: process.platform, architecture: process.arch,
      decoder_package: codec.name, decoder_version: codec.version, decoder_dependencies: codec.dependencies },
    owner_review: "not asserted by this fixture command",
  };
}

function parseArgs(argv) {
  const options = { scenario: "success", output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (!["--scenario", "--out"].includes(flag) || seen.has(flag) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new TypeError("Use --scenario <name|all> --out <fresh-directory>; this command is offline/mock only.");
    }
    seen.add(flag);
    if (flag === "--scenario") options.scenario = argv[++index];
    else options.output = path.resolve(argv[++index]);
  }
  if (!options.output || (options.scenario !== "all" && !CREATIVE_API_SCENARIOS.includes(options.scenario))) {
    throw new TypeError(`A fresh --out directory and a supported scenario are required: ${CREATIVE_API_SCENARIOS.join(", ")}, all.`);
  }
  return options;
}

async function exclusiveWrite(filename, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + "\n");
  await writeFile(filename, bytes, { flag: "wx", mode: 0o600 });
  return { sha256: hash(bytes), bytes: bytes.length };
}

export async function runFixtureCommand(argv) {
  const options = parseArgs(argv);
  const source = await sourcePins();
  // Never reuse, overwrite or remove an existing output path, including a symlink.
  // The caller creates/chooses the parent; mkdir is deliberately non-recursive.
  await mkdir(options.output, { recursive: false, mode: 0o700 });
  const manifest = [];
  const retain = async (relative, value) => {
    const identity = await exclusiveWrite(path.join(options.output, relative), value);
    manifest.push({ path: relative, ...identity });
    return identity;
  };
  try {
    await retain("source-inputs.json", source);
    const scenarios = options.scenario === "all" ? CREATIVE_API_SCENARIOS : [options.scenario];
    const results = [];
    for (const scenario of scenarios) {
      await mkdir(path.join(options.output, scenario), { mode: 0o700 });
      const startedAt = new Date().toISOString();
      const { packet, files } = await runCreativeApiScenario({ scenario });
      for (const [filename, bytes] of files) {
        if (path.basename(filename) !== filename) throw new Error("Fixture emitted an unsafe output name.");
        await retain(`${scenario}/${filename}`, Buffer.from(bytes));
      }
      packet.execution = { started_at: startedAt, finished_at: new Date().toISOString(),
        source_commit: source.commit_sha, source_tree: source.tree_sha,
        input_manifest_sha256: source.input_manifest_sha256, runtime: source.runtime,
        invocation: [process.execPath, "scripts/creative-api-fixture.mjs", ...argv] };
      const identity = await retain(`${scenario}/packet.json`, packet);
      results.push({ scenario, fixture_outcome: "passed", expected_api_outcome: packet.expected_api_outcome,
        packet: `${scenario}/packet.json`, ...identity });
    }
    const after = await sourcePins();
    if (after.commit_sha !== source.commit_sha || after.tree_sha !== source.tree_sha ||
        after.input_manifest_sha256 !== source.input_manifest_sha256) {
      throw new Error("Creative fixture source changed during execution; the packet is not qualified.");
    }
    await retain("index.json", { evidence_schema: "creative-api-offline-fixture-index/1.0",
      execution_mode: "mock", input_provenance: "synthetic", external_acceptance: false, results });
    const manifestIdentity = await exclusiveWrite(path.join(options.output, "manifest.json"), {
      evidence_schema: "creative-api-offline-fixture-files/1.0", files: manifest });
    return { output: options.output, scenarios: results.length, fixture_outcome: "passed",
      manifest_sha256: manifestIdentity.sha256, execution_mode: "mock", external_acceptance: false };
  } catch (error) {
    // Preserve partial outputs and an explicit failure record; never relabel a failed command.
    await exclusiveWrite(path.join(options.output, "failure.json"), { fixture_outcome: "failed",
      execution_mode: "mock", external_acceptance: false, error: { name: error.name, message: error.message },
      ...(error.fixture_diagnostic ? { diagnostic: error.fixture_diagnostic } : {}), completed_files: manifest });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify(await runFixtureCommand(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stderr.write(`Creative API fixture command failed: ${error.message}\n`); process.exitCode = 1; }
}
