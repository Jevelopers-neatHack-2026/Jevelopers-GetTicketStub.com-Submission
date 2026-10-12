import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import test from "node:test";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { createCompositionEditPlan } from "../../src/contracts/approval-handoff.mjs";
import { hashCompositionLayerManifest } from "../../src/contracts/approval-handoff.mjs";
import { applyCompositionPlan, canonicalHash, canonicalSerialize, createCompositionProductionEnvelope,
  createCompositionRevision, compositionStateHash } from "../../src/contracts/index.mjs";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore, VersionStoreError } from "../../src/versions/store.mjs";
import { createSqliteTelemetryOutbox, createTelemetryEvidence, createUsageObservation, USAGE_PROFILE } from "../../src/telemetry/index.mjs";
import { fixtureAttempt } from "../../fixtures/metering/attempt.mjs";
import { makePng } from "../../fixtures/models/png.mjs";
import { createBrief, createWrite, DEFAULT_SCOPE } from "./helpers.mjs";
import { scenario } from "../contracts/approval/helpers.mjs";

const NOW = Date.parse("2026-10-11T12:30:00.000Z");
const ACTOR = "composition-test-actor";
const PINNED_SCHEMA10_COMMIT = "dbbd10deabbac76930c6a7c9350bdae9c1a28258";
const PINNED_SCHEMA10_TREE = "57bb6836680f363d587cb576d6ba51e15038bc2d";
const PINNED_SCHEMA12_SOURCE = { commit: "7cba89a123a19a13e9dd17ed656785dede6b0052",
  tree: "39d8a8cf86bd6971210182f6954cfcd520e2415f", archive: "schema-12-7cba89a.tar.gz",
  archiveBytes: 952681, archiveSha256: "9363769822c7fb6d6b18c879e6f78a2b8384ab98ec795cdddff74e115f28b525",
  tarBytes: 5632000, tarSha256: "44433d4fb388df512bd294d26a81c110f0c704254e0df07fcf59a2c2b32ea4aa", leaves: 309 };
const HISTORICAL_CONCEPT_SOURCES = [
  { schemaVersion: "0.1.0", commit: "d986040244b2d0ae350184cc44b8baad9f5871a0",
    tree: "4662fd1c0a09cf4a2cef5277a08148564db83448", archive: "schema-0.1.0-d986040.tar.gz",
    archiveBytes: 621228, archiveSha256: "1beeaa414177919a58085b121b4d8bcf59ae5a82ff8628e0f440d21dce825208",
    tarBytes: 3645440, tarSha256: "286682bcb8b29220f4159d51aaf7ee77aae27eaa566024a9f9a6332126610c6d", leaves: 256 },
  { schemaVersion: "0.2.0", commit: "27a1e6239d7dbc139497befce65024cbfeafbc2c",
    tree: "6072ed0dab66331f517c5691c635b0b6fc111e89", archive: "schema-0.2.0-27a1e62.tar.gz",
    archiveBytes: 803219, archiveSha256: "f8ee555147b22d641b66c18373d0b947a60554b221831b811e99c3c277938e97",
    tarBytes: 4915200, tarSha256: "b106393ced0cb0883eb1221590056a2d1bc9b88e8e0d9bd060da5c50cb8f75d3", leaves: 285 },
];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function bytesHash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function verifyPinnedHistoricalArchive(compressed, historical) {
  if (!(compressed instanceof Uint8Array)) {
    assert.fail(`pinned schema-${historical.schemaVersion} source archive is missing`);
  }
  assert.equal(compressed.byteLength, historical.archiveBytes,
    `the schema-${historical.schemaVersion} compressed source length matches its custody pin`);
  assert.equal(createHash("sha256").update(compressed).digest("hex"), historical.archiveSha256,
    `the schema-${historical.schemaVersion} compressed source matches its custody hash`);

  let archive;
  try { archive = gunzipSync(compressed); }
  catch { assert.fail(`pinned schema-${historical.schemaVersion} source archive is not valid gzip`); }
  assert.equal(archive.byteLength, historical.tarBytes,
    `the schema-${historical.schemaVersion} original Git archive tar length matches its custody pin`);
  assert.equal(createHash("sha256").update(archive).digest("hex"), historical.tarSha256,
    `the schema-${historical.schemaVersion} original Git archive tar matches its custody hash`);
  return archive;
}

async function unpackPinnedHistoricalConceptSource(historical, destination) {
  const archiveRoot = join(REPO_ROOT, "fixtures/versions/historical-concept-producers");
  let manifest;
  try { manifest = JSON.parse(await readFile(join(archiveRoot, "manifest.json"), "utf8")); }
  catch { assert.fail("historical concept producer custody manifest is missing or invalid JSON"); }
  assert.equal(manifest.schema, "creative-engine-historical-concept-producer-custody/v1");
  assert.equal(manifest.source_method,
    "full tracked tree from immutable historical Git commit via git archive --format=tar; compressed with gzip mtime=0");
  assert.equal(manifest.sources?.length, HISTORICAL_CONCEPT_SOURCES.length,
    "the custody manifest names exactly the two historical producer trees");
  const entry = manifest.sources.find((source) => source.schema_version === historical.schemaVersion);
  assert.ok(entry, `the custody manifest contains schema-${historical.schemaVersion}`);
  assert.deepEqual({ commit: entry.commit, tree: entry.tree, archive: entry.archive,
    archive_bytes: entry.archive_bytes, archive_sha256: entry.archive_sha256,
    git_archive_tar_bytes: entry.git_archive_tar_bytes, git_archive_tar_sha256: entry.git_archive_tar_sha256,
    tracked_leaf_count: entry.tracked_leaf_count }, {
    commit: historical.commit, tree: historical.tree, archive: historical.archive,
    archive_bytes: historical.archiveBytes, archive_sha256: historical.archiveSha256,
    git_archive_tar_bytes: historical.tarBytes, git_archive_tar_sha256: historical.tarSha256,
    tracked_leaf_count: historical.leaves,
  }, `the schema-${historical.schemaVersion} manifest row matches independent test pins`);
  const archivePath = join(archiveRoot, historical.archive);
  let compressed;
  try { compressed = await readFile(archivePath); }
  catch { assert.fail(`pinned schema-${historical.schemaVersion} source archive is missing: ${historical.archive}`); }
  const archive = verifyPinnedHistoricalArchive(compressed, historical);
  const names = execFileSync("tar", ["-tf", "-"], { cwd: REPO_ROOT, input: archive, encoding: "utf8" })
    .split("\n").filter(Boolean);
  assert.ok(names.length >= historical.leaves && new Set(names).size === names.length,
    `the schema-${historical.schemaVersion} archive has unique members for its pinned tracked leaf count`);
  assert.ok(names.every((name) => !name.startsWith("/") && !name.split("/").includes("..")),
    `the schema-${historical.schemaVersion} archive has no absolute or parent-traversal paths`);
  const verbose = execFileSync("tar", ["-tvf", "-"], { cwd: REPO_ROOT, input: archive, encoding: "utf8" });
  assert.ok(verbose.split("\n").filter(Boolean).every((line) => /^[-d]/.test(line)),
    `the schema-${historical.schemaVersion} archive contains only regular files and directories`);

  await mkdir(destination, { recursive: true });
  execFileSync("tar", ["-xf", "-", "-C", destination], { input: archive, maxBuffer: 16 * 1024 * 1024 });
  execFileSync("git", ["init", "--quiet"], { cwd: destination });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: destination });
  execFileSync("git", ["config", "core.filemode", "true"], { cwd: destination });
  execFileSync("git", ["config", "core.safecrlf", "false"], { cwd: destination });
  execFileSync("git", ["add", "--all", "--force"], { cwd: destination });
  const reconstructedTree = execFileSync("git", ["write-tree"], { cwd: destination, encoding: "utf8" }).trim();
  assert.equal(reconstructedTree, historical.tree,
    `the extracted schema-${historical.schemaVersion} tree is the exact pinned historical Git tree`);
  const trackedLeaves = execFileSync("git", ["ls-files", "-z"], { cwd: destination })
    .toString("utf8").split("\0").filter(Boolean);
  assert.equal(trackedLeaves.length, historical.leaves,
    `the schema-${historical.schemaVersion} reconstructed tree has the pinned tracked leaf count`);
  return destination;
}

async function unpackPinnedSchema12Producer(destination) {
  const archiveRoot = join(REPO_ROOT, "fixtures/versions/schema12-composition-producer");
  let manifest;
  try { manifest = JSON.parse(await readFile(join(archiveRoot, "manifest.json"), "utf8")); }
  catch { assert.fail("historical schema-12 composition producer manifest is missing or invalid JSON"); }
  assert.equal(manifest.schema, "creative-engine-historical-composition-producer-custody/v1");
  assert.equal(manifest.source_method,
    "full tracked tree from immutable historical Git commit via git archive --format=tar; compressed with gzip -n");
  assert.deepEqual(manifest.producer, { storage_user_version: 12, commit: PINNED_SCHEMA12_SOURCE.commit,
    tree: PINNED_SCHEMA12_SOURCE.tree, tracked_leaf_count: PINNED_SCHEMA12_SOURCE.leaves,
    archive: PINNED_SCHEMA12_SOURCE.archive, archive_bytes: PINNED_SCHEMA12_SOURCE.archiveBytes,
    archive_sha256: PINNED_SCHEMA12_SOURCE.archiveSha256, git_archive_tar_bytes: PINNED_SCHEMA12_SOURCE.tarBytes,
    git_archive_tar_sha256: PINNED_SCHEMA12_SOURCE.tarSha256 });
  let compressed;
  try { compressed = await readFile(join(archiveRoot, PINNED_SCHEMA12_SOURCE.archive)); }
  catch { assert.fail(`pinned schema-12 composition producer archive is missing: ${PINNED_SCHEMA12_SOURCE.archive}`); }
  const archive = verifyPinnedSchema12Archive(compressed);
  const temporaryArchive = join(dirname(destination), "schema12-verified-source.tar");
  let temporaryArchiveCreated = false;
  try {
    await writeFile(temporaryArchive, archive, { flag: "wx" });
    temporaryArchiveCreated = true;
    const writtenArchive = await readFile(temporaryArchive);
    assert.equal(writtenArchive.byteLength, PINNED_SCHEMA12_SOURCE.tarBytes,
      "the temporary schema-12 tar file retains the pinned archive length before tar reads it");
    assert.equal(createHash("sha256").update(writtenArchive).digest("hex"), PINNED_SCHEMA12_SOURCE.tarSha256,
      "the temporary schema-12 tar file retains the pinned archive bytes before tar reads it");
    const names = execFileSync("tar", ["-tf", temporaryArchive], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n").filter(Boolean);
    assert.ok(names.length >= PINNED_SCHEMA12_SOURCE.leaves);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((name) => !name.startsWith("/") && !name.split("/").includes("..")));
    const verbose = execFileSync("tar", ["-tvf", temporaryArchive], { cwd: REPO_ROOT, encoding: "utf8" });
    assert.ok(verbose.split("\n").filter(Boolean).every((line) => /^[-d]/.test(line)));
    await mkdir(destination, { recursive: true });
    execFileSync("tar", ["-xf", temporaryArchive, "-C", destination], { maxBuffer: 16 * 1024 * 1024 });
  } finally {
    if (temporaryArchiveCreated) await rm(temporaryArchive, { force: true });
  }
  assert.equal(existsSync(temporaryArchive), false,
    "the temporary archive outside the reconstructed Git source tree is removed deterministically");
  execFileSync("git", ["init", "--quiet"], { cwd: destination });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: destination });
  execFileSync("git", ["config", "core.filemode", "true"], { cwd: destination });
  execFileSync("git", ["config", "core.safecrlf", "false"], { cwd: destination });
  execFileSync("git", ["add", "--all", "--force"], { cwd: destination });
  const reconstructedTree = execFileSync("git", ["write-tree"], { cwd: destination, encoding: "utf8" }).trim();
  assert.equal(reconstructedTree, PINNED_SCHEMA12_SOURCE.tree,
    "the archived schema-12 producer source reconstructs its pinned complete Git tree");
  assert.equal(execFileSync("git", ["ls-files", "-z"], { cwd: destination }).toString("utf8").split("\0").filter(Boolean).length,
    PINNED_SCHEMA12_SOURCE.leaves);
  return destination;
}

function verifyPinnedSchema12Archive(compressed) {
  if (!(compressed instanceof Uint8Array)) assert.fail("pinned schema-12 composition producer archive is missing");
  assert.equal(compressed.byteLength, PINNED_SCHEMA12_SOURCE.archiveBytes,
    "the compressed historical schema-12 archive length matches its custody pin");
  assert.equal(createHash("sha256").update(compressed).digest("hex"), PINNED_SCHEMA12_SOURCE.archiveSha256,
    "the compressed historical schema-12 archive matches its custody hash");
  let archive;
  try { archive = gunzipSync(compressed); }
  catch { assert.fail("historical schema-12 composition producer archive is not valid gzip"); }
  assert.equal(archive.byteLength, PINNED_SCHEMA12_SOURCE.tarBytes,
    "the original Git archive tar length matches its custody pin");
  assert.equal(createHash("sha256").update(archive).digest("hex"), PINNED_SCHEMA12_SOURCE.tarSha256,
    "the original Git archive tar matches its custody hash");
  return archive;
}

test("historical concept producer archive custody rejects missing and modified bytes", () => {
  for (const historical of HISTORICAL_CONCEPT_SOURCES) {
    assert.throws(() => verifyPinnedHistoricalArchive(null, historical), /archive is missing/);
    const original = readFileSync(join(REPO_ROOT, "fixtures/versions/historical-concept-producers", historical.archive));
    const changed = Buffer.from(original);
    changed[changed.length - 1] ^= 1;
    assert.throws(() => verifyPinnedHistoricalArchive(changed, historical), /custody hash/,
      `schema-${historical.schemaVersion} rejects a byte-modified archive before extraction`);
  }
});

test("pinned schema-12 producer archive reconstructs its tree and rejects byte tampering", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "schema12-source-custody-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await unpackPinnedSchema12Producer(join(root, "producer-source"));
  const original = readFileSync(join(REPO_ROOT, "fixtures/versions/schema12-composition-producer",
    PINNED_SCHEMA12_SOURCE.archive));
  assert.throws(() => verifyPinnedSchema12Archive(null), /archive is missing/);
  const changed = Buffer.from(original);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => verifyPinnedSchema12Archive(changed), /custody hash/,
    "schema-12 producer custody rejects a byte-modified archive before extracting or importing its source");
});

test("pinned schema-12 producer archive preserves an existing temporary tar sibling", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "schema12-source-custody-collision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temporaryArchive = join(root, "schema12-verified-source.tar");
  const sentinel = Buffer.from("pre-existing sibling must survive exclusive-create collision\n");
  await writeFile(temporaryArchive, sentinel, { flag: "wx" });
  await assert.rejects(unpackPinnedSchema12Producer(join(root, "producer-source")), (error) => error?.code === "EEXIST",
    "an exclusive temporary archive collision fails without claiming ownership of the sibling");
  assert.deepEqual(await readFile(temporaryArchive), sentinel,
    "cleanup leaves a pre-existing sibling untouched when exclusive creation fails");
  assert.equal(existsSync(join(root, "producer-source")), false,
    "a failed exclusive creation does not begin extracting the historical source");
});

function migrationRows(database, table) {
  const quoted = `"${String(table).replaceAll('"', '""')}"`;
  return database.prepare(`SELECT * FROM ${quoted}`).all().map((raw) => Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [key,
      value instanceof Uint8Array ? { base64: Buffer.from(value).toString("base64") } : value]))
  ).sort((left, right) => canonicalSerialize(left).localeCompare(canonicalSerialize(right)));
}

function migrationSchema(database) {
  return database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE type IN ('index','trigger') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
    ORDER BY type,name`).all().map((row) => ({ ...row }));
}

function migrationSql(database) {
  return database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all().map((row) => ({ ...row }));
}

function migrationState(database) {
  const tables = database.prepare(`SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
  return { user_version: database.prepare("PRAGMA user_version").get().user_version,
    schema: migrationSql(database), tables: Object.fromEntries(tables.map((table) => [table, migrationRows(database, table)])) };
}

function migrationSchemaHash(schema) {
  return `sha256:${createHash("sha256").update(canonicalSerialize(schema)).digest("hex")}`;
}

async function migrationArtifactInventory(root) {
  const inventory = [];
  const walk = async (directory, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        inventory.push({ path: relative, symlink: await readlink(absolute) });
      } else if (entry.isDirectory()) await walk(absolute, relative);
      else {
        const bytes = await readFile(absolute);
        inventory.push({ path: relative, bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex") });
      }
    }
  };
  await walk(root);
  return inventory;
}

async function retainMigrationArtifact(label, root, producer) {
  const evidenceRoot = process.env.COMPOSITION_AUTHORITY_EVIDENCE_DIR;
  if (!evidenceRoot) return;
  await mkdir(evidenceRoot, { recursive: true });
  const destination = join(evidenceRoot, label);
  await mkdir(destination, { recursive: false });
  const sourceInventory = await migrationArtifactInventory(root);
  const copiedRoot = join(destination, "producer-root");
  await cp(root, copiedRoot, { recursive: true, force: false });
  const copiedInventory = await migrationArtifactInventory(copiedRoot);
  assert.deepEqual(copiedInventory, sourceInventory, "retained migration sources, SQLite, and object files are byte exact");
  const producerStdout = Buffer.from(producer.stdout ?? "");
  const producerStderr = Buffer.from(producer.stderr ?? "");
  await writeFile(join(destination, "producer.stdout.raw"), producerStdout);
  await writeFile(join(destination, "producer.stderr.raw"), producerStderr);
  await writeFile(join(destination, "artifact-inventory.json"), `${JSON.stringify(sourceInventory, null, 2)}\n`);
  if (producer.migrationState) {
    await writeFile(join(destination, "migration-state.json"), `${JSON.stringify(producer.migrationState, null, 2)}\n`);
  }
  await writeFile(join(destination, "receipt.json"), `${JSON.stringify({
    label,
    created_at_utc: new Date().toISOString(),
    node: process.version,
    node_exec_path: process.execPath,
    producer_status: producer.status,
    producer_signal: producer.signal,
    producer_stdout_sha256: createHash("sha256").update(producerStdout).digest("hex"),
    producer_stderr_sha256: createHash("sha256").update(producerStderr).digest("hex"),
    source_commit: Object.hasOwn(producer, "sourceCommit") ? producer.sourceCommit : PINNED_SCHEMA10_COMMIT,
    source_tree: Object.hasOwn(producer, "sourceTree") ? producer.sourceTree : PINNED_SCHEMA10_TREE,
    source_inventory_count: sourceInventory.length,
    source_inventory_sha256: createHash("sha256").update(canonicalSerialize(sourceInventory)).digest("hex"),
    copied_inventory_matches: true,
  }, null, 2)}\n`);
}

async function retainCompositionArtifact(label, root, details = {}) {
  const evidenceRoot = process.env.COMPOSITION_AUTHORITY_EVIDENCE_DIR;
  if (!evidenceRoot) return;
  await mkdir(evidenceRoot, { recursive: true });
  const destination = join(evidenceRoot, label);
  await mkdir(destination, { recursive: false });
  const sourceInventory = await migrationArtifactInventory(root);
  const copiedRoot = join(destination, "store-root");
  await cp(root, copiedRoot, { recursive: true, force: false });
  const copiedInventory = await migrationArtifactInventory(copiedRoot);
  assert.deepEqual(copiedInventory, sourceInventory, "retained composition database, WAL, and object bytes are exact");
  const workerStdout = Buffer.from(details.worker?.stdout ?? "");
  const workerStderr = Buffer.from(details.worker?.stderr ?? "");
  await writeFile(join(destination, "worker.stdout.raw"), workerStdout);
  await writeFile(join(destination, "worker.stderr.raw"), workerStderr);
  await writeFile(join(destination, "artifact-inventory.json"), `${JSON.stringify(sourceInventory, null, 2)}\n`);
  await writeFile(join(destination, "receipt.json"), `${JSON.stringify({
    label,
    created_at_utc: new Date().toISOString(),
    node: process.version,
    node_exec_path: process.execPath,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
    worker_status: details.worker?.status ?? null,
    worker_signal: details.worker?.signal ?? null,
    worker_stdout_sha256: createHash("sha256").update(workerStdout).digest("hex"),
    worker_stderr_sha256: createHash("sha256").update(workerStderr).digest("hex"),
    worker_input_sha256: details.workerInputSha256 ?? null,
    action_id: details.actionId ?? null,
    request_hash: details.requestHash ?? null,
    parent_revision_id: details.parentRevisionId ?? null,
    parent_revision_sha256: details.parentRevisionSha256 ?? null,
    child_revision_id: details.childRevisionId ?? null,
    child_revision_sha256: details.childRevisionSha256 ?? null,
    result_sha256: details.resultSha256 ?? null,
    source_inventory_count: sourceInventory.length,
    source_inventory_sha256: createHash("sha256").update(canonicalSerialize(sourceInventory)).digest("hex"),
    copied_inventory_matches: true,
  }, null, 2)}\n`);
}

function revisionInput({ scope, brief, design, previewBytes, revisionId, parent = null, geometry: geometryOverride,
  compositionId = "composition:fixture-v1" }) {
  const authority = scenario({ artworkBytes: Buffer.from("durable exact artwork bytes") });
  const binding = structuredClone(authority.binding);
  const artwork = structuredClone(authority.artifact);
  const layer_manifest = structuredClone(authority.layer_manifest);
  const rawArtworkHash = design.artifact.content_hash.slice(7);
  binding.tenant_id = scope.tenant_id;
  binding.project_id = scope.project_id;
  binding.brief = { brief_id: scope.brief_id, sha256: canonicalHash(brief).slice(7) };
  binding.facts = { revision_id: "facts:fixture-v1", sha256: canonicalHash(brief.facts).slice(7) };
  binding.design_version = { design_version_id: design.design_version_id, artwork_sha256: rawArtworkHash };
  binding.composition = { composition_id: compositionId, revision_id: revisionId, sha256: "0".repeat(64) };
  binding.preview_sha256 = bytesHash(previewBytes).slice(7);
  artwork.artifact_id = design.artifact.artifact_id;
  artwork.sha256 = rawArtworkHash;
  artwork.mime_type = design.artifact.media_type;
  layer_manifest[0] = { ...layer_manifest[0], artifact_id: artwork.artifact_id, sha256: artwork.sha256 };
  binding.composition.sha256 = hashCompositionLayerManifest({ binding, artifact: artwork, layer_manifest, trustedScope: scope });

  const selected = { design_version_id: design.design_version_id, design_version_sha256: design.design_hash,
    artwork_sha256: design.artifact.content_hash,
    parent_version_id: design.parent_version_id ?? null,
    parent_design_hash: null };
  const packageRef = brief.research_package_ref;
  const checked_at = NOW - 1_000;
  const expires_at = NOW + 60_000;
  const dependencies = {
    brief_hash: canonicalHash(brief), facts_revision_id: binding.facts.revision_id,
    facts_sha256: `sha256:${binding.facts.sha256}`, package_id: packageRef.package_id,
    package_sha256: packageRef.content_hash, design_version_id: selected.design_version_id,
    design_version_sha256: selected.design_version_sha256, artwork_sha256: selected.artwork_sha256,
    parent_version_id: selected.parent_version_id, parent_design_hash: selected.parent_design_hash,
    selection_revision: 1,
    asset_rights: binding.assets.flatMap((asset) => {
      const actions = ["display", "reproduce", ...(layer_manifest.some((layer) =>
        layer.kind === "approved_asset" && layer.asset_id === asset.asset_id) ? ["modify"] : [])].sort();
      return actions.map((action) => ({ asset_id: asset.asset_id, action,
        source_ref: brief.source_identity[0].source_id, content_hash: `sha256:${asset.sha256}`,
        package_id: packageRef.package_id, package_hash: packageRef.content_hash,
        permission_ref: asset.permission_ref, intended_use: asset.intended_use,
        evidence_ref: `rights:${asset.asset_id}:${action}`, checked_at, expires_at }));
    }).sort((left, right) => left.asset_id.localeCompare(right.asset_id) || left.action.localeCompare(right.action)),
    edit_policy: null,
    authority_proof: { proof_ref: "authority:fixture-v1", state_sha256: `sha256:${"0".repeat(64)}`,
      checked_at, expires_at },
  };
  const policyBody = {
    contract: "CreativeCompositionEditPolicy", schema_version: "1.0", policy_ref: "edit-policy:fixture-v1",
    policy_version: "fixture-policy-v1", brief_hash: dependencies.brief_hash,
    facts_revision_id: dependencies.facts_revision_id, facts_sha256: dependencies.facts_sha256,
    package_id: dependencies.package_id, package_sha256: dependencies.package_sha256,
    design_version_id: dependencies.design_version_id, design_version_sha256: dependencies.design_version_sha256,
    artwork_sha256: dependencies.artwork_sha256, selection_revision: dependencies.selection_revision,
    locked_layer_ids: [], factual_text_layers: [], checked_at, expires_at,
  };
  dependencies.edit_policy = { ...policyBody, policy_sha256: canonicalHash(policyBody) };
  const geometry = geometryOverride ?? [
    { layer_id: "test:art-layer", layout: { x_milli: 0, y_milli: 0 }, text_size: null },
    { layer_id: "test:name-layer", layout: null, text_size: { value: "24.50", unit: "pt" } },
    { layer_id: "test:logo-layer", layout: { x_milli: 870, y_milli: 40, width_milli: 90 }, text_size: null },
  ];
  const raw = {
    tenant_id: scope.tenant_id, project_id: scope.project_id, brief_id: scope.brief_id,
    composition_id: binding.composition.composition_id, revision_id: revisionId,
    parent_revision_id: parent?.revision_id ?? null, parent_revision_sha256: parent?.revision_sha256 ?? null,
    binding, artwork, layer_manifest, geometry, dependencies,
    preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
      preview_id: `preview:${revisionId}`, preview_sha256: bytesHash(previewBytes),
      byte_length: previewBytes.byteLength, mime_type: "image/png", width_px: 16, height_px: 16,
      proof_ref: `preview-proof:${revisionId}`,
      state_sha256: `sha256:${"0".repeat(64)}`, checked_at, expires_at },
  };
  const stateHash = compositionStateHash(raw);
  dependencies.authority_proof.state_sha256 = stateHash;
  raw.preview.state_sha256 = stateHash;
  return createCompositionRevision(raw, { trustedScope: scope, previewBytes, nowMs: NOW }).revision;
}

function publicationFence({ brief, design, actionId, jobId, revision, expectedCurrent = null }) {
  return {
    brief_id: brief.brief_id,
    brief_hash: canonicalHash(brief),
    design_version_id: design.design_version_id,
    design_hash: design.design_hash,
    expected_current_design_version_id: design.design_version_id,
    expected_current_design_hash: design.design_hash,
    composition: {
      composition_id: revision.composition_id,
      action_id: actionId,
      job_id: jobId,
      target_revision_id: revision.revision_id,
      target_revision_sha256: revision.revision_sha256,
      expected_current_revision_id: expectedCurrent?.revision_id ?? null,
      expected_current_revision_sha256: expectedCurrent?.revision_sha256 ?? null,
    },
  };
}

function compositionApiRequest(actionId, operation, payload) {
  return { contract: "CreativeApiRequest", schema_version: "1.2", event_id: `event:${actionId}`,
    request_id: `request:${actionId}`, tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id,
    correlation_id: `correlation:${actionId}`, producer: "composition-publication-crash-test",
    occurred_at: new Date(NOW).toISOString(), ingested_at: new Date(NOW).toISOString(), environment: "test",
    billing_mode: "simulated", source_refs: [], operation, action_id: actionId,
    payload: { brief_id: DEFAULT_SCOPE.brief_id, design_version_id: "composition-hard-exit-design", ...payload } };
}

function compositionRequestHash(request) {
  return canonicalHash({ contract: request.contract, schema_version: request.schema_version,
    tenant_id: request.tenant_id, project_id: request.project_id, operation: request.operation,
    environment: request.environment, billing_mode: request.billing_mode, source_refs: request.source_refs,
    payload: request.payload, action_id: request.action_id });
}

function compositionResult(revision, previewBytes) {
  return { status: "saved", composition: createCompositionProductionEnvelope(revision),
    revision_sha256: revision.revision_sha256, selection_revision: revision.dependencies.selection_revision,
    preview_access: { contract: "CreativeCompositionPreviewAccess", schema_version: "1.1",
      preview_id: revision.preview.preview_id, sha256: revision.preview.preview_sha256,
      byte_length: previewBytes.byteLength, mime_type: revision.preview.mime_type,
      width_px: revision.preview.width_px, height_px: revision.preview.height_px,
      bytes_base64: Buffer.from(previewBytes).toString("base64") } };
}

function childCompositionRevision(current, previewBytes, plan, scope) {
  const applied = applyCompositionPlan(current, plan, scope);
  const binding = structuredClone(current.binding);
  binding.composition.revision_id = applied.revision_id;
  binding.composition.sha256 = hashCompositionLayerManifest({ binding, artifact: current.artwork,
    layer_manifest: applied.layer_manifest, trustedScope: scope });
  binding.preview_sha256 = bytesHash(previewBytes).slice(7);
  const dependencies = structuredClone(current.dependencies);
  dependencies.authority_proof.state_sha256 = `sha256:${"0".repeat(64)}`;
  const checkedAt = NOW;
  const preview = { ...current.preview, preview_id: `preview:${applied.revision_id}`,
    preview_sha256: bytesHash(previewBytes), byte_length: previewBytes.byteLength,
    proof_ref: `preview-proof:${applied.revision_id}`, state_sha256: `sha256:${"0".repeat(64)}` };
  const raw = { tenant_id: current.tenant_id, project_id: current.project_id, brief_id: current.brief_id,
    composition_id: current.composition_id, revision_id: applied.revision_id, parent_revision_id: current.revision_id,
    parent_revision_sha256: current.revision_sha256, binding, artwork: current.artwork,
    layer_manifest: applied.layer_manifest, geometry: applied.geometry, dependencies, preview };
  const stateHash = compositionStateHash(raw);
  dependencies.authority_proof.state_sha256 = stateHash;
  preview.state_sha256 = stateHash;
  return createCompositionRevision(raw, { trustedScope: scope, previewBytes, nowMs: checkedAt }).revision;
}

test("reconstructed schema-10 composition-only reset preserves CE11 queues while rebuilding v11-v13 composition tables", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-v10-migration-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store?.close(); } catch {} await rm(root, { recursive: true, force: true }); });

  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const saved = await store.saveDesignVersion(createWrite({ id: "v10-migration-selected-design" }));
  const design = saved.design_version;
  const artifactBytes = await store.getArtifactBytes({ scope, brief_id: scope.brief_id,
    design_version_id: design.design_version_id });
  const ports = createCreativeVersionApiPorts({ store, idFactory: (() => {
    let value = 0;
    return () => `v10-migration-port-${++value}`;
  })() });
  const reconciledAction = "a-v10-reconciled-attribution";
  const heldAction = "z-v10-pending-attribution";
  let heldJob;

  const stageAttribution = async (action_id) => {
    const operation = "generate";
    const request_hash = canonicalHash({ action_id, operation });
    const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id, request_hash, operation });
    assert.equal(started.kind, "started");
    const billable_attempt_id = `billable:${action_id}`;
    const transport_attempt_id = `transport:${action_id}`;
    const reservation_ref = `reservation:${action_id}`;
    const authorized = await ports.jobs.authorizeDispatch({ scope, actor_id: ACTOR, job_id: started.job_id,
      lease_token: started.lease_token, action_id, operation, billable_attempt_id, reservation_ref,
      provider_name: "openai", provider_model: "fixture-model-v10", transport_attempt_id,
      context_fence: { brief_id: scope.brief_id, brief_hash: canonicalHash(brief),
        expected_current_design_version_id: design.design_version_id,
        expected_current_design_hash: design.design_hash } });
    assert.equal(authorized.status, "authorized");
    const provider_request_id = `provider-request:${action_id}`;
    const provider_request_ref = `provider-request-${createHash("sha256").update(provider_request_id).digest("hex")}`;
    const staged = await ports.jobs.stagePrivateProviderAttribution({ scope, actor_id: ACTOR, job_id: started.job_id,
      action_id, request_hash, operation, provider: "openai", model: "fixture-model-v10", reservation_ref,
      billable_attempt_id, transport_attempt_id, dispatch_intent_ref: authorized.dispatch_intent_ref,
      target_binding_sha256: `sha256:${"c".repeat(64)}`, provider_request_id, provider_request_ref,
      usage: { completeness: "unknown", missing_fields: ["usage.profile_mapping_pending"], transport_attempt_id,
        provider_request_id: provider_request_ref, input_tokens: 12, output_tokens: 8, total_tokens: 20 } });
    assert.equal(staged.status, "staged");
    if (action_id === heldAction) heldJob = started;
    return { action_id, job_id: started.job_id, staged };
  };

  await stageAttribution(reconciledAction);
  assert.deepEqual(await ports.jobs.reconcilePrivateProviderAttributions({ scope: { tenant_id: scope.tenant_id,
    project_id: scope.project_id }, limit: 1 }), { reconciled: 1, remaining: 0 });
  await stageAttribution(heldAction);

  const telemetryScope = { tenant_id: scope.tenant_id, project_id: scope.project_id,
    budget_scope_id: "budget:v10-migration" };
  const attempt = fixtureAttempt({ ...telemetryScope, logical_operation_id: "logical:v10-migration",
    billable_attempt_id: "billable:v10-usage-observation", operation_kind: "image_generation",
    budget: { scope_id: telemetryScope.budget_scope_id, policy_version: "fixture-policy-v1" },
    provider: { name: "openai", model: "fixture-model-v10", endpoint: "test:/image", sdk: { name: "fixture", version: "1" } } });
  const outbox = createSqliteTelemetryOutbox({ database: store.db, clock: () => NOW,
    idFactory: () => "usage-observation:v10-migration" });
  const event = createTelemetryEvidence({ eventId: "event:v10-migration", type: "attempt_intent", attempt,
    trustedScope: telemetryScope, modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
    occurredAt: new Date(NOW).toISOString() });
  assert.deepEqual(await outbox.append(event), { status: "recorded", event_id: event.event_id });
  const observation = createUsageObservation({ attempt, trustedScope: telemetryScope,
    profile: USAGE_PROFILE.NORMALIZED, sourceObservationId: "source-observation:v10-migration",
    providerRequestId: "provider-request:v10-migration", transportAttemptId: "transport:v10-migration",
    usage: { input_tokens: 3, output_tokens: 2 } });
  const queuedObservation = await outbox.enqueueUsageObservation({ attempt, trustedScope: telemetryScope, observation });
  assert.equal(queuedObservation.status, "recorded");

  const preservedTables = ["creative_briefs", "creative_jobs", "creation_actions", "design_versions",
    "version_evidence", "version_selections", "creative_dispatch_intents",
    "private_provider_attributions", "private_provider_usage_attributions",
    "private_provider_attribution_pending", "private_provider_attribution_reconciliations",
    "creative_telemetry_evidence_outbox_v1", "creative_telemetry_observations_v1"];
  const before = Object.fromEntries(preservedTables.map((table) => [table, migrationRows(store.db, table)]));
  assert.ok(before.private_provider_attributions.length > 0);
  assert.ok(before.private_provider_usage_attributions.length > 0);
  assert.ok(before.private_provider_attribution_pending.length > 0);
  assert.ok(before.private_provider_attribution_reconciliations.length > 0);
  assert.ok(before.creative_telemetry_evidence_outbox_v1.some((row) => row.status === "pending"));
  assert.ok(before.creative_telemetry_observations_v1.some((row) => row.status === "pending"));
  assert.equal(before.creative_jobs.find((row) => row.job_id === heldJob.job_id)?.status, "running");
  const originalSelection = store.getSelection({ scope, brief_id: scope.brief_id });
  assert.equal(originalSelection.design_version_id, design.design_version_id);
  assert.equal(originalSelection.design_hash, design.design_hash);
  assert.equal(originalSelection.revision, 1);

  store.db.exec(`BEGIN IMMEDIATE;
    DROP TABLE creative_composition_action_leases_v1;
    DROP TABLE creative_composition_current_v1;
    DROP TABLE creative_composition_actions_v1;
    DROP TABLE creative_composition_revisions_v1;
    PRAGMA user_version=10;
    COMMIT;`);
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 10);
  store.close();

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.deepEqual(Object.fromEntries(preservedTables.map((table) => [table, migrationRows(store.db, table)])), before);
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(store.getSelection({ scope, brief_id: scope.brief_id }).design_hash, design.design_hash);
  assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope, brief_id: scope.brief_id,
    design_version_id: design.design_version_id })), Buffer.from(artifactBytes));
  const reopenedPorts = createCreativeVersionApiPorts({ store });
  const reopenedHeldJob = await reopenedPorts.jobs.get({ scope, job_id: heldJob.job_id });
  assert.equal(reopenedHeldJob.status, "running", "the fixture job stays running alongside its unreconciled private attribution record");
  assert.equal(reopenedHeldJob.action_id, heldAction);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_actions_v1").get().count, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_current_v1").get().count, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_action_leases_v1").get().count, 0);
  assert.ok(store.db.prepare("PRAGMA index_list(creative_composition_current_v1)").all()
    .some((index) => index.name === "creative_composition_one_current_per_design_v1" && index.unique === 1));

  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.deepEqual(Object.fromEntries(preservedTables.map((table) => [table, migrationRows(store.db, table)])), before,
    "second reopen preserves the same historical rows, unreconciled private attribution, and queued evidence");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("a final-v13 migration failure rolls genuine populated v4 and v6 databases back exactly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-earliest-migration-rollback-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    { fixture: "base4-populated-v4", version: 4,
      sourceCommit: "4e28839ea8baeb4112a4f12340ef2fe84f5c8efe" },
    { fixture: "base6-populated-v6", version: 6,
      sourceCommit: "5ab7f0ede215e62f6ddb5ef3472a2dc8e55cbc74" },
  ];
  for (const sample of cases) await t.test(`schema ${sample.version}`, async (subtest) => {
    const fixtureRoot = join(REPO_ROOT, "fixtures/versions", sample.fixture);
    const sourceInventory = await migrationArtifactInventory(fixtureRoot);
    const manifest = JSON.parse(await readFile(join(fixtureRoot, "manifest.json"), "utf8"));
    assert.equal(manifest.storage_user_version, sample.version);
    const caseRoot = join(root, `schema-${sample.version}`);
    const databasePath = join(caseRoot, "creative.sqlite");
    const objectRoot = join(caseRoot, "objects");
    await mkdir(caseRoot, { recursive: true });
    await cp(join(fixtureRoot, "creative.sqlite"), databasePath);
    await cp(join(fixtureRoot, "objects"), objectRoot, { recursive: true });

    const setup = new DatabaseSync(databasePath);
    assert.equal(setup.prepare("PRAGMA user_version").get().user_version, sample.version,
      "the rollback input is a populated checked-in database from the named historical producer");
    const oldRows = setup.prepare("SELECT COUNT(*) AS count FROM creative_jobs").get().count;
    assert.ok(oldRows >= 3, "the historical input contains completed job rows");
    setup.exec(`CREATE TABLE creative_composition_action_leases_v12 (sentinel TEXT NOT NULL);
      INSERT INTO creative_composition_action_leases_v12 VALUES ('intentional-final-v13-collision');`);
    const before = migrationState(setup);
    assert.equal(before.user_version, sample.version);
    setup.close();
    const objectsBefore = await migrationArtifactInventory(objectRoot);
    const producer = { status: 0, signal: null, sourceCommit: sample.sourceCommit, sourceTree: null,
      stdout: `${JSON.stringify({ fixture: sample.fixture, user_version: before.user_version,
        schema_sha256: migrationSchemaHash(before.schema), tables: Object.keys(before.tables),
        rows_sha256: createHash("sha256").update(canonicalSerialize(before.tables)).digest("hex") })}\n`,
      stderr: "", migrationState: before };
    await retainMigrationArtifact(`schema${sample.version}-v13-final-collision-before`, caseRoot, producer);

    assert.throws(() => new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW }),
      (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "storage_version",
      "the deliberate schema-13 table collision aborts the complete historical upgrade");
    const afterDb = new DatabaseSync(databasePath);
    const after = migrationState(afterDb);
    assert.deepEqual(after, before,
      "rollback restores every sqlite_master entry, row, BLOB, sentinel, and the original user_version exactly");
    assert.deepEqual(afterDb.prepare("PRAGMA foreign_key_check").all(), [],
      "the exact restored historical database has no foreign-key violations");
    afterDb.close();
    assert.deepEqual(await migrationArtifactInventory(objectRoot), objectsBefore,
      "the failed migration does not alter artwork object paths or bytes");
    await retainMigrationArtifact(`schema${sample.version}-v13-final-collision-after`, caseRoot,
      { ...producer, migrationState: after,
        stdout: `${JSON.stringify({ fixture: sample.fixture, user_version: after.user_version,
          schema_sha256: migrationSchemaHash(after.schema),
          rows_sha256: createHash("sha256").update(canonicalSerialize(after.tables)).digest("hex") })}\n` });
    assert.deepEqual(await migrationArtifactInventory(fixtureRoot), sourceInventory,
      "the checked-in historical source and object bytes remain unchanged");
  });
});

test("schema-14 is rejected without rewriting the future database", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-migration-atomicity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const futurePath = join(root, "future.sqlite");
  const future = new DatabaseSync(futurePath);
  future.exec("PRAGMA user_version=14");
  future.close();
  assert.throws(() => new CreativeVersionStore({ databasePath: futurePath,
    objectRoot: join(root, "future-objects"), now: () => NOW }),
  (error) => error instanceof VersionStoreError && error.code === "unsupported_version");
  const futureAfter = new DatabaseSync(futurePath);
  assert.equal(futureAfter.prepare("PRAGMA user_version").get().user_version, 14,
    "opening a future schema is rejected without rewriting its version");
  futureAfter.close();
});

test("pinned schema-10 producer plus a synthetic OpenRouter extension preserves history through v13 and replays its recovered intent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-pinned-v10-"));
  const baselineRoot = join(root, "pinned-schema10-source");
  const databasePath = join(root, "schema10.sqlite");
  const objectRoot = join(root, "schema10-objects");
  let store;
  t.after(async () => { try { store?.close(); } catch {} await rm(root, { recursive: true, force: true }); });

  const tree = execFileSync("git", ["rev-parse", `${PINNED_SCHEMA10_COMMIT}^{tree}`],
    { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  assert.equal(tree, PINNED_SCHEMA10_TREE, "the producer source is the exact pinned pre-composition tree");
  const archive = execFileSync("git", ["archive", "--format=tar", PINNED_SCHEMA10_COMMIT],
    { cwd: REPO_ROOT, maxBuffer: 128 * 1024 * 1024 });
  await mkdir(baselineRoot, { recursive: true });
  execFileSync("tar", ["-xf", "-", "-C", baselineRoot], { input: archive, maxBuffer: 16 * 1024 * 1024 });
  const repositoryNodeModules = join(REPO_ROOT, "node_modules");
  const codecNodeModules = join(REPO_ROOT, "src/models/codec-runtime/node_modules");
  assert.ok(existsSync(codecNodeModules), "the pinned schema-10 image decoder dependencies are installed before the migration test");
  // The root package has no third-party dependencies, so `npm ci` correctly
  // leaves no root node_modules directory. Link it only when a future pinned
  // root package actually installs dependencies; keep the separately locked
  // codec runtime available to the baseline producer in either case.
  if (existsSync(repositoryNodeModules)) await symlink(repositoryNodeModules, join(baselineRoot, "node_modules"), "dir");
  await symlink(codecNodeModules, join(baselineRoot, "src/models/codec-runtime/node_modules"), "dir");
  const historicalConceptRoots = new Map();
  for (const historical of HISTORICAL_CONCEPT_SOURCES) {
    const historicalRoot = join(root, `concept-schema-${historical.schemaVersion}`);
    await unpackPinnedHistoricalConceptSource(historical, historicalRoot);
    await symlink(codecNodeModules, join(historicalRoot, "src/models/codec-runtime/node_modules"), "dir");
    historicalConceptRoots.set(historical.schemaVersion, historicalRoot);
  }
  const producer = join(REPO_ROOT, "fixtures/versions/base10-populated-v10-producer.mjs");
  const produced = spawnSync(process.execPath, [producer, baselineRoot, databasePath, objectRoot,
    ...HISTORICAL_CONCEPT_SOURCES.map(({ schemaVersion }) => historicalConceptRoots.get(schemaVersion))], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(produced.error, undefined, produced.error?.message);
  assert.equal(produced.signal, null, produced.stderr);
  assert.equal(produced.status, 86, `the schema-10 producer must leave its committed action intent at a real process cut: ${produced.stderr}`);
  assert.ok(produced.stdout.includes("PINNED_SCHEMA10_COMMIT_INTENT_DURABLE\n"));
  const replayInputLine = produced.stdout.split("\n").find((line) => line.startsWith("PINNED_SCHEMA10_REPLAY_INPUT "));
  assert.ok(replayInputLine, "the producer retains the exact input needed for idempotent post-migration replay");
  const serializedReplayInput = JSON.parse(replayInputLine.slice("PINNED_SCHEMA10_REPLAY_INPUT ".length));
  const replayInput = { ...serializedReplayInput,
    artifact_bytes: Uint8Array.from(Buffer.from(serializedReplayInput.artifact_bytes_base64, "base64")) };
  delete replayInput.artifact_bytes_base64;

  const baseline = new DatabaseSync(databasePath);
  assert.equal(baseline.prepare("PRAGMA user_version").get().user_version, 10,
    "the database is emitted by the actual pinned schema-10 store, before current code opens it");
  const genuineV10SchemaBeforeExtension = migrationSql(baseline);
  const genuineV10PrivateRowsBeforeExtension = Object.fromEntries(
    ["private_provider_attributions", "private_provider_usage_attributions"]
      .map((table) => [table, migrationRows(baseline, table)]));
  const genuineV10ObjectsBeforeExtension = await migrationArtifactInventory(objectRoot);
  // The pinned historical producer correctly contains OpenAI-only rows. Add a
  // separately labeled, schema-10-shaped OpenRouter extension record so this
  // exact migration also proves the later provider CHECK widening preserves
  // every attribution row while the composition tables advance through v13.
  // The extension uses an otherwise valid sibling dispatch and turns off only
  // SQLite CHECK enforcement for the two legacy provider columns; the old
  // schema and user_version remain byte-for-byte unchanged until migration.
  const sourceUsage = baseline.prepare(`SELECT * FROM private_provider_usage_attributions
    ORDER BY captured_at,transport_attempt_id LIMIT 1`).get();
  assert.ok(sourceUsage, "the pinned source has a populated direct-provider usage observation");
  const sourceProvider = baseline.prepare(`SELECT * FROM private_provider_attributions
    WHERE job_id=? AND transport_attempt_id=?`).get(sourceUsage.job_id, sourceUsage.transport_attempt_id);
  const sourceDispatch = baseline.prepare(`SELECT * FROM creative_dispatch_intents
    WHERE tenant_id=? AND project_id=? AND job_id=? AND transport_attempt_id=?`).get(
    sourceUsage.tenant_id, sourceUsage.project_id, sourceUsage.job_id, sourceUsage.transport_attempt_id);
  assert.ok(sourceProvider && sourceDispatch, "the pinned private usage record has its source provider and dispatch rows");
  const extension = {
    transport_attempt_id: "schema10-openrouter-extension-transport",
    billable_attempt_id: "schema10-openrouter-extension-billable",
    reservation_ref: "schema10-openrouter-extension-reservation",
    dispatch_intent_ref: "schema10-openrouter-extension-dispatch",
    provider_model: "synthetic-lab/schema10-openrouter-migration-fixture",
    provider_request_id: "fixture-only:schema10-openrouter-request",
  };
  extension.provider_request_ref = `provider-request-${createHash("sha256")
    .update(extension.provider_request_id, "utf8").digest("hex")}`;
  const extensionDispatch = { ...sourceDispatch, transport_attempt_id: extension.transport_attempt_id,
    billable_attempt_id: extension.billable_attempt_id, reservation_ref: extension.reservation_ref,
    dispatch_intent_ref: extension.dispatch_intent_ref, provider_model: extension.provider_model,
    provider_name: "openrouter", authorized_at: "2026-10-11T12:31:00.000Z" };
  const extensionProvider = { ...sourceProvider, transport_attempt_id: extension.transport_attempt_id,
    billable_attempt_id: extension.billable_attempt_id, reservation_ref: extension.reservation_ref,
    dispatch_intent_ref: extension.dispatch_intent_ref, provider_model: extension.provider_model,
    provider_request_id: extension.provider_request_id, provider_request_ref: extension.provider_request_ref,
    provider_name: "openrouter",
    captured_at: "2026-10-11T12:31:00.000Z" };
  const extensionUsagePayload = JSON.parse(sourceUsage.usage_json);
  extensionUsagePayload.transport_attempt_id = extension.transport_attempt_id;
  if (extensionUsagePayload.provider_request_id !== undefined) {
    extensionUsagePayload.provider_request_id = extension.provider_request_ref;
  }
  const extensionUsage = { ...sourceUsage, transport_attempt_id: extension.transport_attempt_id,
    billable_attempt_id: extension.billable_attempt_id, reservation_ref: extension.reservation_ref,
    dispatch_intent_ref: extension.dispatch_intent_ref, provider_model: extension.provider_model,
    provider_name: "openrouter",
    usage_json: canonicalSerialize(extensionUsagePayload), usage_sha256: canonicalHash(extensionUsagePayload),
    captured_at: "2026-10-11T12:31:00.000Z" };
  const insertRecord = (table, row) => {
    const columns = Object.keys(row);
    baseline.prepare(`INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(",")})
      VALUES(${columns.map(() => "?").join(",")})`).run(...columns.map((column) => row[column]));
  };
  baseline.exec("PRAGMA foreign_keys=ON; PRAGMA ignore_check_constraints=ON; BEGIN IMMEDIATE;");
  insertRecord("creative_dispatch_intents", extensionDispatch);
  insertRecord("private_provider_attributions", extensionProvider);
  insertRecord("private_provider_usage_attributions", extensionUsage);
  baseline.exec("PRAGMA ignore_check_constraints=OFF; COMMIT;");
  assert.equal(baseline.prepare(`SELECT provider_name FROM private_provider_attributions
    WHERE transport_attempt_id=?`).get(extension.transport_attempt_id).provider_name, "openrouter");
  assert.equal(baseline.prepare(`SELECT provider_name FROM private_provider_usage_attributions
    WHERE transport_attempt_id=?`).get(extension.transport_attempt_id).provider_name, "openrouter");
  assert.equal(baseline.prepare("PRAGMA user_version").get().user_version, 10,
    "the test-only OpenRouter extension does not change the pinned producer's storage version");
  assert.deepEqual(migrationSql(baseline), genuineV10SchemaBeforeExtension,
    "the extension adds fixture rows without rewriting the producer's original schema or triggers");
  for (const [table, sourceRows] of Object.entries(genuineV10PrivateRowsBeforeExtension)) {
    assert.deepEqual(migrationRows(baseline, table).filter((row) => row.transport_attempt_id !== extension.transport_attempt_id),
      sourceRows, `${table} keeps every genuine pinned producer row unchanged beside the synthetic OpenRouter extension`);
  }
  assert.deepEqual(await migrationArtifactInventory(objectRoot), genuineV10ObjectsBeforeExtension,
    "the test-only attribution extension does not alter the genuine producer's artwork object bytes");
  const compositionTablesBefore = baseline.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name LIKE 'creative_composition_%' ORDER BY name`).all();
  assert.deepEqual(compositionTablesBefore, []);
  const legacyTables = baseline.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
  assert.ok(legacyTables.includes("creative_concept_batches_v1"));
  assert.ok(legacyTables.includes("creative_inspection_sessions_v1"));
  const before = Object.fromEntries(legacyTables.map((table) => [table, migrationRows(baseline, table)]));
  const versionsBefore = before.creative_concept_batches_v1.map((row) => JSON.parse(row.batch_json).schema_version).sort();
  assert.deepEqual(versionsBefore, ["0.1.0", "0.2.0", "0.3.0"]);
  assert.equal(before.creative_concept_events_v1.length, 3, "the three old proposal versions have durable event history");
  assert.ok(before.creation_actions.some((row) => row.state === "commit_intent"),
    "the process cut left a real baseline commit intent in the schema-10 database");
  assert.ok(before.creation_actions.some((row) => row.state === "committed"),
    "the same baseline database also includes committed historical A/B/C versions");
  assert.ok(before.design_versions.length >= 3, "the source database contains a branch, not only a root version");
  assert.ok(before.private_provider_attributions.length > 0);
  assert.ok(before.private_provider_usage_attributions.length > 0);
  assert.ok(before.private_provider_attribution_pending.length > 0);
  assert.ok(before.private_provider_attribution_reconciliations.length > 0);
  assert.ok(before.creative_telemetry_evidence_outbox_v1.some((row) => row.status === "pending"));
  assert.ok(before.creative_telemetry_observations_v1.some((row) => row.status === "pending"));
  assert.equal(before.creative_inspection_sessions_v1.length, 1);
  assert.equal(before.creative_inspection_sessions_v1[0].status, "active");
  assert.deepEqual(before.creative_inspection_stages_v1.map((row) => row.status).sort(), ["completed", "dispatching"]);
  assert.equal(before.creative_invalidation_events.length, 2,
    "the pinned producer wrote both invalidation events through its shared CE02 connection");
  assert.equal(before.creative_invalidation_fences.length, 2,
    "both asset permission invalidations left durable fences");
  assert.equal(before.creative_approval_staleness_outbox.length, 2,
    "the paired invalidations retain independent application acknowledgment states");
  assert.deepEqual(before.creative_approval_staleness_outbox.map((row) => row.status).sort(), ["acknowledged", "pending"]);
  assert.equal(before.creative_producer_acknowledgments.length, 1,
    "only the invalidation with acknowledged approval staleness has a producer acknowledgment");
  assert.deepEqual(before.creative_invalidation_fences.map(({ event_id, kind, target_id, target_hash }) =>
    ({ event_id, kind, target_id, target_hash })).sort((left, right) => left.event_id.localeCompare(right.event_id)), [
    { event_id: "schema10-asset-revocation-acknowledged", kind: "asset", target_id: "schema10-asset-acknowledged",
      target_hash: bytesHash(Buffer.from("schema10-asset-revocation-acknowledged:revoked-by-fixture")) },
    { event_id: "schema10-asset-revocation-pending", kind: "asset", target_id: "schema10-asset-pending",
      target_hash: bytesHash(Buffer.from("schema10-asset-revocation-pending:revoked-by-fixture")) },
  ]);
  const pendingCommitIntent = before.creation_actions.find((row) => row.action_id === "schema10-existing-commit-intent-action");
  assert.equal(pendingCommitIntent?.state, "commit_intent");
  const legacySchemaBefore = migrationSchema(baseline);
  const legacySchemaHashBefore = migrationSchemaHash(legacySchemaBefore);
  assert.deepEqual(baseline.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(baseline.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy, 0,
    "the completed pinned producer state is checkpointed before byte-exact backup");
  baseline.close();
  await retainMigrationArtifact("schema10-producer-cut", root, produced);

  const rollbackRoot = join(root, "schema10-rollback");
  const rollbackDatabasePath = join(rollbackRoot, "schema10.sqlite");
  const rollbackObjectRoot = join(rollbackRoot, "schema10-objects");
  await mkdir(rollbackRoot, { recursive: true });
  await cp(databasePath, rollbackDatabasePath);
  await cp(objectRoot, rollbackObjectRoot, { recursive: true });
  const rollbackSetup = new DatabaseSync(rollbackDatabasePath);
  assert.equal(rollbackSetup.prepare("PRAGMA user_version").get().user_version, 10,
    "the rollback input is copied from the same genuine pinned schema-10 producer database");
  rollbackSetup.exec(`CREATE TABLE creative_composition_revisions_v1 (sentinel TEXT NOT NULL);
    INSERT INTO creative_composition_revisions_v1 VALUES ('migration-collision');`);
  const rollbackTablesBefore = rollbackSetup.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
  const rollbackRowsBefore = Object.fromEntries(rollbackTablesBefore.map((table) =>
    [table, migrationRows(rollbackSetup, table)]));
  const rollbackSqlBefore = migrationSql(rollbackSetup);
  const rollbackSqlHashBefore = migrationSchemaHash(rollbackSqlBefore);
  rollbackSetup.close();
  const rollbackObjectsBefore = await migrationArtifactInventory(rollbackObjectRoot);
  await retainMigrationArtifact("schema10-rollback-input", rollbackRoot, produced);
  assert.throws(() => new CreativeVersionStore({ databasePath: rollbackDatabasePath,
    objectRoot: rollbackObjectRoot, now: () => NOW }),
  (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "storage_version",
  "a DDL collision forces the v11 migration to abort against the real populated source");
  const rollbackAfter = new DatabaseSync(rollbackDatabasePath);
  assert.equal(rollbackAfter.prepare("PRAGMA user_version").get().user_version, 10,
    "the failed migration leaves the genuine source at schema 10");
  const rollbackTablesAfter = rollbackAfter.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
  assert.deepEqual(rollbackTablesAfter, rollbackTablesBefore,
    "the failed migration creates no composition tables around the intentional collision");
  assert.deepEqual(Object.fromEntries(rollbackTablesAfter.map((table) =>
    [table, migrationRows(rollbackAfter, table)])), rollbackRowsBefore,
  "the failed migration restores every exact row from the genuine pinned source");
  const rollbackSqlAfter = migrationSql(rollbackAfter);
  assert.deepEqual(rollbackSqlAfter, rollbackSqlBefore,
    "all table, trigger, index and view SQL is unchanged after rollback");
  assert.equal(migrationSchemaHash(rollbackSqlAfter), rollbackSqlHashBefore,
    "the full pre-existing sqlite_master SQL inventory has the same canonical hash after rollback");
  assert.deepEqual(rollbackAfter.prepare("PRAGMA foreign_key_check").all(), []);
  rollbackAfter.close();
  const rollbackObjectsAfter = await migrationArtifactInventory(rollbackObjectRoot);
  assert.deepEqual(rollbackObjectsAfter, rollbackObjectsBefore,
    "failed migration cannot alter the producer's copied artwork object bytes");
  await retainMigrationArtifact("schema10-rollback-after", rollbackRoot, produced);

  // Fail at the final (v13) action/lease rebuild, after the old v11/v12
  // migrations have begun. This proves the combined 10→13 migration has one
  // rollback boundary and never leaves the real producer at intermediate 12.
  const finalRollbackRoot = join(root, "schema10-v13-rollback");
  const finalRollbackDatabase = join(finalRollbackRoot, "schema10.sqlite");
  const finalRollbackObjects = join(finalRollbackRoot, "schema10-objects");
  await mkdir(finalRollbackRoot, { recursive: true });
  await cp(databasePath, finalRollbackDatabase);
  await cp(objectRoot, finalRollbackObjects, { recursive: true });
  const finalRollbackSetup = new DatabaseSync(finalRollbackDatabase);
  assert.equal(finalRollbackSetup.prepare("PRAGMA user_version").get().user_version, 10,
    "the final-stage failure also starts from the exact pinned schema-10 producer database");
  finalRollbackSetup.exec(`CREATE TABLE creative_composition_action_leases_v12 (sentinel TEXT NOT NULL);
    INSERT INTO creative_composition_action_leases_v12 VALUES ('intentional-final-v13-collision');`);
  const finalRollbackBefore = migrationState(finalRollbackSetup);
  assert.equal(finalRollbackBefore.user_version, 10);
  assert.deepEqual(finalRollbackSetup.prepare("PRAGMA foreign_key_check").all(), []);
  finalRollbackSetup.close();
  const finalRollbackObjectsBefore = await migrationArtifactInventory(finalRollbackObjects);
  await retainMigrationArtifact("schema10-v13-final-stage-rollback-before", finalRollbackRoot,
    { ...produced, migrationState: finalRollbackBefore });
  let finalStageMigrationError;
  try { new CreativeVersionStore({ databasePath: finalRollbackDatabase,
    objectRoot: finalRollbackObjects, now: () => NOW }); }
  catch (error) { finalStageMigrationError = error; }
  assert.ok(finalStageMigrationError, "a final schema-13 rebuild collision aborts the complete genuine schema-10 upgrade");
  assert.ok(finalStageMigrationError instanceof VersionStoreError,
    `the final-stage migration reports a sanitized version-store error: ${finalStageMigrationError?.code}/${finalStageMigrationError?.field}`);
  assert.equal(finalStageMigrationError.code, "unavailable",
    "the constructor exposes the migration abort through its closed storage error set");
  assert.equal(finalStageMigrationError.field, "storage_version");
  const finalRollbackAfterDb = new DatabaseSync(finalRollbackDatabase);
  const finalRollbackAfter = migrationState(finalRollbackAfterDb);
  assert.deepEqual(finalRollbackAfter, finalRollbackBefore,
    "a final-stage schema-13 error preserves complete original schema-10 sqlite_master and every row");
  assert.deepEqual(finalRollbackAfterDb.prepare("PRAGMA foreign_key_check").all(), []);
  finalRollbackAfterDb.close();
  assert.deepEqual(await migrationArtifactInventory(finalRollbackObjects), finalRollbackObjectsBefore,
    "final-stage v10 rollback does not alter any retained source artwork bytes");
  await retainMigrationArtifact("schema10-v13-final-stage-rollback-after", finalRollbackRoot,
    { ...produced, migrationState: finalRollbackAfter });

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  const afterMigration = Object.fromEntries(legacyTables.map((table) => [table, migrationRows(store.db, table)]));
  assert.deepEqual(afterMigration, before,
    "v10→v13 migration creates composition tables without rewriting any populated schema-10 row");
  const legacySchemaAfter = migrationSchema(store.db).filter((entry) => !entry.name.startsWith("creative_composition_"));
  assert.deepEqual(legacySchemaAfter, legacySchemaBefore,
    "v10→v13 migration preserves every old trigger and index definition exactly");
  assert.equal(migrationSchemaHash(legacySchemaAfter), legacySchemaHashBefore,
    "the old trigger and index inventory retains its exact canonical hash");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    const sql = store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
    assert.ok(sql?.includes("CHECK(provider_name IN ('openai','openrouter'))"),
      `${table} receives the explicit widened provider CHECK inside the schema-10→13 transaction`);
    assert.equal(store.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE provider_name='openrouter'`).get().n, 1,
      `${table} retains the schema-10 extension row through the full upgrade`);
  }
  assert.deepEqual(store.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'creative_composition_%' ORDER BY name`)
    .all().map((row) => row.name), ["creative_composition_action_leases_v1", "creative_composition_actions_v1",
      "creative_composition_current_v1", "creative_composition_revisions_v1"]);
  const selected = store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id });
  assert.equal(selected.design_version_id, "schema10-history-A");
  assert.equal(selected.revision, 1);
  assert.equal(selected.design_hash, store.getDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "schema10-history-A" }).design_hash);
  const branchIds = new Set(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    limit: 20 }).items.map((item) => item.design_version_id));
  for (const id of ["schema10-history-A", "schema10-history-B", "schema10-history-C"]) assert.ok(branchIds.has(id));
  for (const [id, exactBytes] of [["schema10-history-A", "schema10 artifact A exact bytes"],
    ["schema10-history-B", "schema10 artifact B exact bytes"], ["schema10-history-C", "schema10 artifact C exact bytes"]]) {
    assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
      design_version_id: id })), Buffer.from(exactBytes));
  }
  assert.deepEqual({ ...store.db.prepare(`SELECT status FROM creative_jobs WHERE action_id='schema10-pending-attribution'`).get() },
    { status: "running" }, "the old in-flight job state survives migration without claiming external settlement");
  assert.equal(store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get("schema10-existing-commit-intent-action").state, "commit_intent");
  for (const schemaVersion of ["0.1.0", "0.2.0", "0.3.0"]) {
    const row = store.db.prepare("SELECT batch_json FROM creative_concept_batches_v1 WHERE action_id=?")
      .get(`schema10-concept-${schemaVersion.replaceAll(".", "-")}`);
    assert.equal(JSON.parse(row.batch_json).schema_version, schemaVersion);
  }
  const inspection = store.db.prepare(`SELECT s.status,COUNT(st.stage) AS stage_count FROM creative_inspection_sessions_v1 AS s
    LEFT JOIN creative_inspection_stages_v1 AS st ON st.tenant_id=s.tenant_id AND st.project_id=s.project_id
      AND st.action_id=s.action_id WHERE s.action_id='schema10-inspection-action' GROUP BY s.status`).get();
  assert.deepEqual({ ...inspection }, { status: "active", stage_count: 2 });
  assert.throws(() => store.db.prepare(`DELETE FROM creative_invalidation_fences
    WHERE event_id='schema10-asset-revocation-pending'`).run(), /invalidation fences are monotonic/,
  "the retained schema-10 fence still rejects deletion after upgrade");
  const historicalEventId = store.db.prepare("SELECT event_id FROM creative_concept_events_v1 ORDER BY event_id LIMIT 1").get().event_id;
  assert.throws(() => store.db.prepare("UPDATE creative_concept_events_v1 SET event_json='{}' WHERE event_id=?")
    .run(historicalEventId), /concept events are immutable/,
  "the retained schema-10 concept event still rejects mutation after upgrade");

  const recovered = await store.recover();
  assert.equal(recovered.committed, 1, "recovery finalizes the pinned producer's old commit intent after migration");
  assert.equal(store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get("schema10-existing-commit-intent-action").state, "committed");
  const recoveredVersion = store.getDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "schema10-existing-commit-intent" });
  assert.ok(recoveredVersion);
  assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: DEFAULT_SCOPE,
    brief_id: DEFAULT_SCOPE.brief_id, design_version_id: "schema10-existing-commit-intent" })),
  Buffer.from(replayInput.artifact_bytes));
  const replayed = await store.saveDesignVersion(replayInput);
  assert.equal(replayed.status, "saved");
  assert.equal(replayed.replayed, true, "the exact pinned schema-10 request replays after migration and recovery");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.equal(store.getDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "schema10-existing-commit-intent" }).design_hash, recoveredVersion.design_hash);
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  store.close();
  store = null;
  await retainMigrationArtifact("schema13-migrated-recovered", root, produced);
});

test("immutable schema-12 producer migrates its populated composition action and exact replay through v13", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-pinned-v12-"));
  const producerRoot = join(root, "schema12-pinned-source");
  const databasePath = join(root, "schema12.sqlite");
  const objectRoot = join(root, "schema12-objects");
  const rollbackRoot = join(root, "schema12-rollback");
  const rollbackDatabasePath = join(rollbackRoot, "schema12.sqlite");
  const rollbackObjectRoot = join(rollbackRoot, "schema12-objects");
  let historicalStore;
  let store;
  t.after(async () => { try { historicalStore?.close(); } catch {} try { store?.close(); } catch {}
    await rm(root, { recursive: true, force: true }); });

  await unpackPinnedSchema12Producer(producerRoot);
  await cp(join(REPO_ROOT, "fixtures/versions/schema12-composition-producer"), join(root, "producer-archive"),
    { recursive: true, force: false });
  const { CreativeVersionStore: HistoricalCreativeVersionStore } = await import(
    pathToFileURL(join(producerRoot, "src/versions/store.mjs")).href);
  const { createCreativeVersionApiPorts: createHistoricalPorts } = await import(
    pathToFileURL(join(producerRoot, "src/versions/api-ports.mjs")).href);
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  historicalStore = new HistoricalCreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(historicalStore.db.prepare("PRAGMA user_version").get().user_version, 12,
    "the archived producer constructor emits storage schema 12 before the v13 opener is used");
  historicalStore.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await historicalStore.saveDesignVersion(createWrite({ scope, id: "composition-hard-exit-design" }))).design_version;
  const actionId = "schema12-public-composition-action";
  const request = compositionApiRequest(actionId, "composition.create", {});
  const requestHash = compositionRequestHash(request);
  const oldPorts = createHistoricalPorts({ store: historicalStore, idFactory: () => "schema12-producer-id" });
  const started = await oldPorts.jobs.begin({ scope, actor_id: ACTOR, action_id: actionId,
    request_hash: requestHash, operation: "composition.create" });
  const selection = historicalStore.getSelection({ scope, brief_id: scope.brief_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  const revision = revisionInput({ scope, brief, design, previewBytes, revisionId: "schema12-composition-revision" });
  const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0", operation: "composition.create",
    composition_id: revision.composition_id, candidate_revision_id: revision.revision_id,
    source_revision_id: null, source_revision_sha256: null, plan: null };
  const begun = await oldPorts.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, operation: "composition.create", request_hash: requestHash,
    intent, expected_current: null, expected_design_version_id: design.design_version_id,
    expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
  assert.equal(begun.status, "pending");
  const staged = await oldPorts.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash, revision, preview_bytes: previewBytes });
  assert.equal(staged.status, "staged");
  const result = compositionResult(revision, previewBytes);
  const published = await oldPorts.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, operation: "composition.create", request_hash: requestHash,
    result, publication_fence: publicationFence({ brief, design, actionId, jobId: started.job_id, revision }) },
  (transaction) => oldPorts.storage.commitCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
    action_id: actionId, request_hash: requestHash, revision_sha256: revision.revision_sha256 }, transaction));
  assert.equal(published.status, "completed");
  assert.equal(published.result.revision_sha256, revision.revision_sha256);
  assert.equal(historicalStore.db.prepare("SELECT status FROM creative_composition_actions_v1 WHERE action_id=?")
    .get(actionId).status, "published");
  assert.equal(historicalStore.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionId).status,
    "completed");
  const before = migrationState(historicalStore.db);
  assert.equal(before.user_version, 12);
  const beforeAction = before.tables.creative_composition_actions_v1.find((row) => row.action_id === actionId);
  const beforeLease = before.tables.creative_composition_action_leases_v1.find((row) => row.action_id === actionId);
  assert.ok(beforeAction?.result_json && beforeAction.candidate_revision_json && beforeAction.preview_bytes?.base64,
    "schema 12 contains published result JSON, immutable candidate JSON, and exact preview bytes");
  assert.ok(beforeLease?.lease_hash, "schema 12 contains the exact action lease identity");
  assert.deepEqual(historicalStore.db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(historicalStore.db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get().busy, 0);
  historicalStore.close();
  historicalStore = null;
  const producerReceipt = { status: 0, signal: null, sourceCommit: PINNED_SCHEMA12_SOURCE.commit,
    sourceTree: PINNED_SCHEMA12_SOURCE.tree, stdout: `${JSON.stringify({ user_version: before.user_version,
      action_id: actionId, revision_id: revision.revision_id, revision_sha256: revision.revision_sha256,
      request_hash: requestHash, preview_sha256: revision.preview.preview_sha256,
      tables_sha256: createHash("sha256").update(canonicalSerialize(before.tables)).digest("hex") })}\n`, stderr: "",
    migrationState: before };
  await retainMigrationArtifact("schema12-producer-before-v13", root, producerReceipt);

  // Start from the genuine populated producer image and inject one named DDL
  // collision so the final v13 migration stage fails inside its transaction.
  await mkdir(rollbackRoot, { recursive: true });
  await cp(databasePath, rollbackDatabasePath);
  await cp(objectRoot, rollbackObjectRoot, { recursive: true });
  const rollbackSetup = new DatabaseSync(rollbackDatabasePath);
  rollbackSetup.exec(`CREATE TABLE creative_composition_action_leases_v12 (sentinel TEXT NOT NULL);
    INSERT INTO creative_composition_action_leases_v12 VALUES ('intentional-v13-migration-collision');`);
  const rollbackBefore = migrationState(rollbackSetup);
  assert.equal(rollbackBefore.user_version, 12);
  const rollbackObjectsBefore = await migrationArtifactInventory(rollbackObjectRoot);
  rollbackSetup.close();
  await retainMigrationArtifact("schema12-v13-collision-before", rollbackRoot,
    { ...producerReceipt, migrationState: rollbackBefore });
  assert.throws(() => new CreativeVersionStore({ databasePath: rollbackDatabasePath,
    objectRoot: rollbackObjectRoot, now: () => NOW }),
  (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "storage_version");
  const rollbackAfterDb = new DatabaseSync(rollbackDatabasePath);
  const rollbackAfter = migrationState(rollbackAfterDb);
  assert.deepEqual(rollbackAfter, rollbackBefore,
    "the failed schema-13 action/lease rebuild restores every v12 sqlite_master entry, row, blob, and user_version");
  assert.deepEqual(rollbackAfterDb.prepare("PRAGMA foreign_key_check").all(), []);
  rollbackAfterDb.close();
  assert.deepEqual(await migrationArtifactInventory(rollbackObjectRoot), rollbackObjectsBefore,
    "the failed final migration stage leaves the producer's object bytes unchanged");
  await retainMigrationArtifact("schema12-v13-collision-after", rollbackRoot,
    { ...producerReceipt, migrationState: rollbackAfter });

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  const after = migrationState(store.db);
  assert.equal(after.user_version, 13);
  assert.deepEqual(Object.keys(after.tables).sort(), Object.keys(before.tables).sort());
  for (const table of Object.keys(before.tables)) {
    assert.deepEqual(after.tables[table], before.tables[table], `schema 12→13 preserves every ${table} row exactly`);
  }
  const afterAction = after.tables.creative_composition_actions_v1.find((row) => row.action_id === actionId);
  const afterLease = after.tables.creative_composition_action_leases_v1.find((row) => row.action_id === actionId);
  assert.equal(afterAction.result_json, beforeAction.result_json);
  assert.equal(afterAction.candidate_revision_json, beforeAction.candidate_revision_json);
  assert.deepEqual(afterAction.preview_bytes, beforeAction.preview_bytes);
  assert.equal(afterLease.lease_hash, beforeLease.lease_hash);
  const actionSchema = after.schema.find((row) => row.type === "table" && row.name === "creative_composition_actions_v1");
  const leaseSchema = after.schema.find((row) => row.type === "table" && row.name === "creative_composition_action_leases_v1");
  assert.match(actionSchema.sql, /composition\.revalidate/);
  assert.match(leaseSchema.sql, /FOREIGN KEY/);
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  const upgradedCurrent = store.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(upgradedCurrent.revision.revision_sha256, revision.revision_sha256);
  assert.deepEqual(upgradedCurrent.preview_bytes, previewBytes);
  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.deepEqual(store.getCompositionAction({ scope, action_id: actionId }).preview_bytes, previewBytes);
  const currentAdapter = createCreativeVersionApiPorts({ store, idFactory: () => "schema12-reopen-id" });
  const replayApi = createCreativeApi({ ports: currentAdapter.ports, now: () => NOW,
    idFactory: () => "schema12-replay-id" });
  const replay = await replayApi.invoke({ actor_id: ACTOR, tenant_id: scope.tenant_id, project_id: scope.project_id,
    expires_at: new Date(NOW + 60_000).toISOString(), permissions: ["creative.edit"],
    budget_scope_id: "budget:schema12-replay", budget_policy_version: "fixture-policy-v1" }, request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.revision_sha256, revision.revision_sha256);
  assert.deepEqual(Buffer.from(replay.result.preview_access.bytes_base64, "base64"), Buffer.from(previewBytes));
  await retainMigrationArtifact("schema13-migrated-schema12-composition", root,
    { ...producerReceipt, migrationState: after, stdout: `${JSON.stringify({ user_version: after.user_version,
      action_id: actionId, revision_id: revision.revision_id, revision_sha256: revision.revision_sha256,
      replayed: replay.replayed, result_sha256: replay.result.revision_sha256 })}\n` });
  store.close();
  store = null;
});

test("composition action stages and reopens exact bytes, then publishes two revisions through current-pointer fences", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-authority-store-"));
  let store = new CreativeVersionStore({ databasePath: join(root, "creative.sqlite"), objectRoot: join(root, "objects"), now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const savedDesign = await store.saveDesignVersion(createWrite({ id: "composition-source-design" }));
  const design = savedDesign.design_version;
  const requestHash1 = canonicalHash({ action: "composition-create", brief_id: scope.brief_id });
  let nextPortId = 0;
  let ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-port-${++nextPortId}` });
  const started1 = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: "composition-create",
    request_hash: requestHash1, operation: "composition.create" });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const revision1Bytes = Uint8Array.from(Buffer.from("preview revision one"));
  const revision1 = revisionInput({ scope, brief, design, previewBytes: revision1Bytes, revisionId: "composition-revision-1" });
  const intent1 = { contract: "CreativeCompositionActionIntent", schema_version: "1.0", operation: "composition.create",
    composition_id: revision1.composition_id, candidate_revision_id: revision1.revision_id,
    source_revision_id: null, source_revision_sha256: null, plan: null };
  const begin1 = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started1.job_id,
    lease_token: started1.lease_token, action_id: "composition-create", operation: "composition.create",
    request_hash: requestHash1, intent: intent1, expected_current: null,
    expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
    expected_selection_revision: selection.revision });
  assert.equal(begin1.status, "pending");
  const stage1 = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started1.job_id,
    lease_token: started1.lease_token, action_id: "composition-create", request_hash: requestHash1,
    revision: revision1, preview_bytes: revision1Bytes });
  assert.equal(stage1.status, "staged");

  store.close();
  store = new CreativeVersionStore({ databasePath: join(root, "creative.sqlite"), objectRoot: join(root, "objects"), now: () => NOW });
  ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-port-${++nextPortId}` });
  const stagedAfterReopen = await ports.storage.getCompositionAction({ scope, action_id: "composition-create" });
  assert.equal(stagedAfterReopen.status, "staged");
  assert.deepEqual(stagedAfterReopen.preview_bytes, revision1Bytes);
  assert.equal(stagedAfterReopen.revision.created_at, new Date(NOW).toISOString());
  assert.equal(stagedAfterReopen.revision.revision_sha256, revision1.revision_sha256);

  const result1 = { status: "saved", composition: createCompositionProductionEnvelope(revision1),
    revision_sha256: revision1.revision_sha256, selection_revision: selection.revision };
  const published1 = await ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: started1.job_id,
    lease_token: started1.lease_token, action_id: "composition-create", operation: "composition.create",
    result: result1, publication_fence: publicationFence({ brief, design, actionId: "composition-create",
      jobId: started1.job_id, revision: revision1 }) }, (transaction) => ports.storage.commitCompositionRevision({
    scope, actor_id: ACTOR, action_id: "composition-create", job_id: started1.job_id,
    request_hash: requestHash1, revision_sha256: revision1.revision_sha256,
  }, transaction));
  assert.equal(published1.status, "completed");
  assert.equal(published1.result.status, "saved");
  const current1 = await ports.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(current1.revision.created_at, new Date(NOW).toISOString());
  assert.equal(current1.revision.revision_sha256, revision1.revision_sha256);
  assert.deepEqual(current1.preview_bytes, revision1Bytes);

  const requestHash2 = canonicalHash({ action: "composition-update", base: revision1.revision_sha256 });
  const started2 = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: "composition-update",
    request_hash: requestHash2, operation: "composition.update" });
  const revision2Bytes = Uint8Array.from(Buffer.from("preview revision two"));
  const geometry2 = structuredClone(revision1.geometry);
  geometry2[1].text_size = { value: "25.00", unit: "pt" };
  const revision2 = revisionInput({ scope, brief, design, previewBytes: revision2Bytes,
    revisionId: "composition-revision-2", parent: revision1, geometry: geometry2 });
  const intent2 = { contract: "CreativeCompositionActionIntent", schema_version: "1.0", operation: "composition.update",
    composition_id: revision2.composition_id, candidate_revision_id: revision2.revision_id,
    source_revision_id: revision1.revision_id, source_revision_sha256: revision1.revision_sha256,
    plan: { schema_version: "0.2.0", operations: [{ layer_id: "test:name-layer", kind: "set_text_size",
      size: { value: "25.00", unit: "pt" } }] } };
  const begin2 = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started2.job_id,
    lease_token: started2.lease_token, action_id: "composition-update", operation: "composition.update",
    request_hash: requestHash2, intent: intent2,
    expected_current: { revision_id: revision1.revision_id, revision_sha256: revision1.revision_sha256 },
    expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
    expected_selection_revision: selection.revision });
  assert.equal(begin2.status, "pending");
  const stage2 = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started2.job_id,
    lease_token: started2.lease_token, action_id: "composition-update", request_hash: requestHash2,
    revision: revision2, preview_bytes: revision2Bytes });
  assert.equal(stage2.status, "staged");
  const result2 = { status: "saved", composition: createCompositionProductionEnvelope(revision2),
    revision_sha256: revision2.revision_sha256, selection_revision: selection.revision };
  const published2 = await ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: started2.job_id,
    lease_token: started2.lease_token, action_id: "composition-update", operation: "composition.update",
    result: result2, publication_fence: publicationFence({ brief, design, actionId: "composition-update",
      jobId: started2.job_id, revision: revision2, expectedCurrent: revision1 }) }, (transaction) => ports.storage.commitCompositionRevision({
    scope, actor_id: ACTOR, action_id: "composition-update", job_id: started2.job_id,
    request_hash: requestHash2, revision_sha256: revision2.revision_sha256,
  }, transaction));
  assert.equal(published2.status, "completed");
  assert.equal(published2.result.composition.revision.revision_id, revision2.revision_id);
  const history = await ports.storage.listCompositionRevisions({ scope, composition_id: revision2.composition_id, limit: 10 });
  assert.deepEqual(history.items.map((item) => item.revision_id), [revision1.revision_id, revision2.revision_id],
    "equal-clock history uses a deterministic revision-ID tie-break");
  const current2 = await ports.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(current2.revision.revision_sha256, revision2.revision_sha256);
  assert.deepEqual(current2.preview_bytes, revision2Bytes);
  const historical1 = await ports.storage.getCompositionRevision({ scope,
    composition_id: revision1.composition_id, revision_id: revision1.revision_id });
  assert.equal(canonicalSerialize(historical1.revision), canonicalSerialize(revision1));
  assert.deepEqual(historical1.preview_bytes, revision1Bytes);

  const guardHash = canonicalHash({ action: "borrowed-publication-sentinel" });
  const guardJob = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: "composition-borrowed-guard",
    request_hash: guardHash, operation: "composition.create" });
  store.db.exec(`CREATE TABLE composition_borrowed_sentinels (
    id TEXT PRIMARY KEY, marker TEXT NOT NULL
  ) STRICT`);
  let publicationCallbacks = 0;
  const rejectedPublication = () => ports.jobs.completeIfActive({ scope, actor_id: ACTOR,
    job_id: guardJob.job_id, lease_token: guardJob.lease_token, action_id: "composition-borrowed-guard",
    operation: "composition.create", result: result1,
    publication_fence: publicationFence({ brief, design, actionId: "composition-borrowed-guard",
      jobId: guardJob.job_id, revision: revision1 }) }, async () => { publicationCallbacks += 1; });
  for (const transaction of [
    { open: "BEGIN IMMEDIATE", rollback: "ROLLBACK", id: "begin" },
    { open: "SAVEPOINT composition_caller", rollback: "ROLLBACK TO composition_caller; RELEASE composition_caller", id: "savepoint" },
  ]) {
    store.db.exec(transaction.open);
    store.db.prepare("INSERT INTO composition_borrowed_sentinels VALUES(?,?)").run(transaction.id, "caller-owned");
    await assert.rejects(rejectedPublication(), (error) => error instanceof VersionStoreError &&
      error.code === "unavailable" && error.field === "job_publication.transaction");
    await assert.rejects(ports.jobs.begin({ scope, actor_id: ACTOR,
      action_id: `composition-borrowed-begin-${transaction.id}`, request_hash: guardHash,
      operation: "composition.create" }), (error) => error instanceof VersionStoreError &&
        error.code === "unavailable" && error.field === "job.begin.transaction");
    await assert.rejects(ports.jobs.failIfActive({ scope, actor_id: ACTOR, job_id: guardJob.job_id,
      lease_token: guardJob.lease_token, error: { code: "unavailable", reason: "test" } }),
      (error) => error instanceof VersionStoreError && error.code === "unavailable" &&
        error.field === "job.failure.transaction");
    await assert.rejects(ports.jobs.cancel({ scope, actor_id: ACTOR,
      action_id: `composition-borrowed-cancel-${transaction.id}`, target_action_id: "composition-borrowed-guard",
      request_hash: guardHash, job_id: guardJob.job_id }), (error) => error instanceof VersionStoreError &&
        error.code === "unavailable" && error.field === "job.cancel.transaction");
    assert.equal(store.db.isTransaction, true, "rejected publication and job admission leave caller transaction open");
    assert.deepEqual(store.db.prepare("SELECT id,marker FROM composition_borrowed_sentinels ORDER BY id").all()
      .map((row) => ({ ...row })), [{ id: transaction.id, marker: "caller-owned" }]);
    assert.equal(publicationCallbacks, 0, "borrowed BEGIN/SAVEPOINT cannot reach the publication callback");
    store.db.exec(transaction.rollback);
    assert.equal(store.db.isTransaction, false);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM composition_borrowed_sentinels").get().count, 0,
      "caller rollback removes only its sentinel");
  }
  assert.equal((await ports.jobs.get({ scope, job_id: guardJob.job_id })).status, "running",
    "borrowed transaction rejection leaves the job unchanged");
});

test("two SQLite connections cannot publish distinct current composition IDs for one selected design", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-current-design-identity-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  const storeA = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  let storeB;
  t.after(async () => { try { storeA.close(); } catch {} try { storeB?.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  storeA.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await storeA.saveDesignVersion(createWrite({ id: "composition-current-identity-design" }))).design_version;
  storeB = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  let portId = 0;
  const portsA = createCreativeVersionApiPorts({ store: storeA, idFactory: () => `composition-identity-a-${++portId}` });
  const portsB = createCreativeVersionApiPorts({ store: storeB, idFactory: () => `composition-identity-b-${++portId}` });
  const selection = storeA.getSelection({ scope, brief_id: scope.brief_id });
  const actions = [
    { ports: portsA, action_id: "composition-identity-action-a", composition_id: "composition:identity-a",
      revision_id: "composition:identity-revision-a", preview_bytes: Uint8Array.from(Buffer.from("preview a")) },
    { ports: portsB, action_id: "composition-identity-action-b", composition_id: "composition:identity-b",
      revision_id: "composition:identity-revision-b", preview_bytes: Uint8Array.from(Buffer.from("preview b")) },
  ];
  for (const item of actions) {
    item.request_hash = canonicalHash({ action_id: item.action_id, design_version_id: design.design_version_id });
    item.started = await item.ports.jobs.begin({ scope, actor_id: ACTOR, action_id: item.action_id,
      request_hash: item.request_hash, operation: "composition.create" });
    item.revision = revisionInput({ scope, brief, design, previewBytes: item.preview_bytes,
      revisionId: item.revision_id, compositionId: item.composition_id });
    item.intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0", operation: "composition.create",
      composition_id: item.composition_id, candidate_revision_id: item.revision_id,
      source_revision_id: null, source_revision_sha256: null, plan: null };
    const begun = await item.ports.storage.beginCompositionAction({ scope, actor_id: ACTOR,
      job_id: item.started.job_id, lease_token: item.started.lease_token, action_id: item.action_id,
      operation: "composition.create", request_hash: item.request_hash, intent: item.intent,
      expected_current: null, expected_design_version_id: design.design_version_id,
      expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
    assert.equal(begun.status, "pending");
    const staged = await item.ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR,
      job_id: item.started.job_id, lease_token: item.started.lease_token, action_id: item.action_id,
      request_hash: item.request_hash, revision: item.revision, preview_bytes: item.preview_bytes });
    assert.equal(staged.status, "staged");
  }
  async function publish(item) {
    const result = { status: "saved", composition: createCompositionProductionEnvelope(item.revision),
      revision_sha256: item.revision.revision_sha256, selection_revision: selection.revision };
    return item.ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: item.started.job_id,
      lease_token: item.started.lease_token, action_id: item.action_id, operation: "composition.create", result,
      publication_fence: publicationFence({ brief, design, actionId: item.action_id, jobId: item.started.job_id,
        revision: item.revision }) }, (transaction) => item.ports.storage.commitCompositionRevision({ scope,
      actor_id: ACTOR, job_id: item.started.job_id, action_id: item.action_id,
      request_hash: item.request_hash, revision_sha256: item.revision.revision_sha256 }, transaction));
  }
  const first = await publish(actions[0]);
  assert.equal(first.status, "completed");
  const second = await publish(actions[1]);
  assert.equal(second.status, "stale_context",
    "the second staged composition is rejected by a same-transaction selected-design identity CAS");
  const currentA = await portsA.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  const currentB = await portsB.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(currentA.revision.revision_sha256, actions[0].revision.revision_sha256);
  assert.equal(currentB.revision.revision_sha256, actions[0].revision.revision_sha256);
  assert.equal(storeA.db.prepare(`SELECT COUNT(*) AS count FROM creative_composition_current_v1
    WHERE tenant_id=? AND project_id=? AND brief_id=? AND design_version_id=?`)
    .get(scope.tenant_id, scope.project_id, scope.brief_id, design.design_version_id).count, 1);
  assert.equal((await portsB.storage.getCompositionAction({ scope, action_id: actions[1].action_id })).status, "staged",
    "stale publication preserves its immutable staged candidate for truthful recovery");
});

test("two SQLite connections race distinct children from one composition parent and only one CAS publishes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-same-parent-cas-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let storeA = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  let storeB;
  t.after(async () => { try { storeA.close(); } catch {} try { storeB?.close(); } catch {}
    await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  storeA.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await storeA.saveDesignVersion(createWrite({ id: "composition-same-parent-design" }))).design_version;
  let portIdA = 0;
  const portsA = createCreativeVersionApiPorts({ store: storeA, idFactory: () => `same-parent-a-${++portIdA}` });
  const selection = storeA.getSelection({ scope, brief_id: scope.brief_id });
  const parentAction = "composition-same-parent-create";
  const parentRequestHash = canonicalHash({ action_id: parentAction, design_version_id: design.design_version_id });
  const parentStarted = await portsA.jobs.begin({ scope, actor_id: ACTOR, action_id: parentAction,
    request_hash: parentRequestHash, operation: "composition.create" });
  const parentBytes = Uint8Array.from(Buffer.from("immutable parent preview bytes"));
  const parent = revisionInput({ scope, brief, design, previewBytes: parentBytes,
    revisionId: "composition-same-parent-root" });
  const parentIntent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
    operation: "composition.create", composition_id: parent.composition_id,
    candidate_revision_id: parent.revision_id, source_revision_id: null, source_revision_sha256: null, plan: null };
  const parentActionBegin = await portsA.storage.beginCompositionAction({ scope, actor_id: ACTOR,
    job_id: parentStarted.job_id, lease_token: parentStarted.lease_token, action_id: parentAction,
    operation: "composition.create", request_hash: parentRequestHash, intent: parentIntent,
    expected_current: null, expected_design_version_id: design.design_version_id,
    expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
  assert.equal(parentActionBegin.status, "pending");
  const parentStage = await portsA.storage.stageCompositionRevision({ scope, actor_id: ACTOR,
    job_id: parentStarted.job_id, lease_token: parentStarted.lease_token, action_id: parentAction,
    request_hash: parentRequestHash, revision: parent, preview_bytes: parentBytes });
  assert.equal(parentStage.status, "staged");
  const parentPublished = await portsA.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: parentStarted.job_id,
    lease_token: parentStarted.lease_token, action_id: parentAction, operation: "composition.create",
    result: compositionResult(parent, parentBytes), publication_fence: publicationFence({ brief, design,
      actionId: parentAction, jobId: parentStarted.job_id, revision: parent }) },
  (transaction) => portsA.storage.commitCompositionRevision({ scope, actor_id: ACTOR,
    job_id: parentStarted.job_id, action_id: parentAction, request_hash: parentRequestHash,
    revision_sha256: parent.revision_sha256 }, transaction));
  assert.equal(parentPublished.status, "completed");

  storeB = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  let portIdB = 0;
  const portsB = createCreativeVersionApiPorts({ store: storeB, idFactory: () => `same-parent-b-${++portIdB}` });
  const children = [
    { ports: portsA, suffix: "a", size: "25.00" },
    { ports: portsB, suffix: "b", size: "27.00" },
  ];
  for (const child of children) {
    child.action_id = `composition-same-parent-update-${child.suffix}`;
    child.request_hash = canonicalHash({ action_id: child.action_id, parent_sha256: parent.revision_sha256 });
    child.started = await child.ports.jobs.begin({ scope, actor_id: ACTOR, action_id: child.action_id,
      request_hash: child.request_hash, operation: "composition.update" });
    child.plan = createCompositionEditPlan({ plan_id: `same-parent-plan-${child.suffix}`,
      binding: parent.binding, layer_manifest: parent.layer_manifest,
      target_composition_revision_id: `composition-same-parent-child-${child.suffix}`,
      operations: [{ operation_id: `same-parent-size-${child.suffix}`, kind: "set_text_size",
        layer_id: "test:name-layer", size: { value: child.size, unit: "pt" } }], trustedScope: scope });
    child.preview_bytes = Uint8Array.from(Buffer.from(`child preview ${child.suffix}`));
    child.revision = childCompositionRevision(parent, child.preview_bytes, child.plan, scope);
    child.intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
      operation: "composition.update", composition_id: parent.composition_id,
      candidate_revision_id: child.revision.revision_id, source_revision_id: parent.revision_id,
      source_revision_sha256: parent.revision_sha256, plan: child.plan };
    const begun = await child.ports.storage.beginCompositionAction({ scope, actor_id: ACTOR,
      job_id: child.started.job_id, lease_token: child.started.lease_token, action_id: child.action_id,
      operation: "composition.update", request_hash: child.request_hash, intent: child.intent,
      expected_current: { revision_id: parent.revision_id, revision_sha256: parent.revision_sha256 },
      expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
      expected_selection_revision: selection.revision });
    assert.equal(begun.status, "pending");
    const staged = await child.ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR,
      job_id: child.started.job_id, lease_token: child.started.lease_token, action_id: child.action_id,
      request_hash: child.request_hash, revision: child.revision, preview_bytes: child.preview_bytes });
    assert.equal(staged.status, "staged");
  }
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const [{ CreativeVersionStore }, { createCreativeVersionApiPorts }] = await Promise.all([
        import(workerData.storeUrl), import(workerData.portsUrl),
      ]);
      const store = new CreativeVersionStore({ databasePath: workerData.databasePath,
        objectRoot: workerData.objectRoot, now: () => workerData.now });
      const ports = createCreativeVersionApiPorts({ store });
      parentPort.once("message", async (task) => {
        try {
          const result = await ports.jobs.completeIfActive(task.input,
            (transaction) => ports.storage.commitCompositionRevision(task.commitInput, transaction));
          parentPort.postMessage({ type: "result", status: result.status });
        } catch (error) {
          parentPort.postMessage({ type: "result", error: error?.module === "creative-engine.versions"
            ? error.code : "unexpected" });
        } finally {
          store.close();
          parentPort.close();
        }
      });
      parentPort.postMessage({ type: "ready" });
    })().catch(() => parentPort.postMessage({ type: "setup_error" }));
  `;
  const workers = children.map(() => new Worker(workerSource, { eval: true, workerData: {
    storeUrl: pathToFileURL(resolve(REPO_ROOT, "src/versions/store.mjs")).href,
    portsUrl: pathToFileURL(resolve(REPO_ROOT, "src/versions/api-ports.mjs")).href,
    databasePath, objectRoot, now: NOW,
  } }));
  t.after(async () => { await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined))); });
  function receive(worker, expectedType) {
    return new Promise((resolveMessage, rejectMessage) => {
      const onMessage = (message) => {
        if (message.type === "setup_error") return rejectMessage(new Error("composition publication worker failed to initialize"));
        if (message.type !== expectedType) return;
        cleanup();
        if (message.error) rejectMessage(new Error(`composition publication worker returned ${message.error}`));
        else resolveMessage(message);
      };
      const onError = (error) => { cleanup(); rejectMessage(error); };
      const onExit = (code) => {
        if (code !== 0) { cleanup(); rejectMessage(new Error(`composition publication worker exited ${code}`)); }
      };
      const cleanup = () => {
        worker.off("message", onMessage);
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
      worker.on("message", onMessage);
      worker.on("error", onError);
      worker.on("exit", onExit);
    });
  }
  const ready = workers.map((worker) => receive(worker, "ready"));
  const outcomesReady = Promise.all(workers.map((worker) => receive(worker, "result")));
  await Promise.all(ready);
  for (const [index, child] of children.entries()) {
    workers[index].postMessage({
      input: { scope, actor_id: ACTOR, job_id: child.started.job_id, lease_token: child.started.lease_token,
        action_id: child.action_id, operation: "composition.update",
        result: compositionResult(child.revision, child.preview_bytes),
        publication_fence: publicationFence({ brief, design, actionId: child.action_id,
          jobId: child.started.job_id, revision: child.revision,
          expectedCurrent: { revision_id: parent.revision_id, revision_sha256: parent.revision_sha256 } }) },
      commitInput: { scope, actor_id: ACTOR, job_id: child.started.job_id, action_id: child.action_id,
        request_hash: child.request_hash, revision_sha256: child.revision.revision_sha256 },
    });
  }
  const outcomes = await outcomesReady;
  assert.deepEqual(outcomes.map((item) => item.status).sort(), ["completed", "stale_context"],
    "both different children were staged against the same parent; only one current-pointer CAS can publish");
  const winner = children[outcomes.findIndex((item) => item.status === "completed")];
  const currentA = await portsA.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  const currentB = await portsB.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(currentA.revision.revision_id, winner.revision.revision_id);
  assert.equal(currentB.revision.revision_sha256, winner.revision.revision_sha256);
  assert.equal(currentA.revision.parent_revision_id, parent.revision_id);
  assert.equal(currentA.revision.parent_revision_sha256, parent.revision_sha256);
  assert.equal(storeA.db.prepare(`SELECT COUNT(*) AS count FROM creative_composition_revisions_v1
    WHERE tenant_id=? AND project_id=? AND brief_id=? AND composition_id=?`)
    .get(scope.tenant_id, scope.project_id, scope.brief_id, parent.composition_id).count, 2,
  "history contains the root and one winning child, not the loser's staged candidate");
  const retainedParent = await portsA.storage.getCompositionRevision({ scope,
    composition_id: parent.composition_id, revision_id: parent.revision_id });
  assert.deepEqual(retainedParent.preview_bytes, parentBytes, "the winning CAS preserves the parent's exact preview bytes");
  const history = await portsB.storage.listCompositionRevisions({ scope, composition_id: parent.composition_id, limit: 10 });
  assert.deepEqual(new Set(history.items.map((item) => item.revision_id)),
    new Set([parent.revision_id, winner.revision.revision_id]));
});

test("publication hard-exit rolls back inserted revision/current pointer and resumes from the durable staged bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-publication-hard-exit-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let clock = NOW;
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => clock });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "composition-publication-hard-exit-design" }))).design_version;
  let id = 0;
  let ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-publication-port-${++id}`,
    leaseDurationMs: 1_000 });
  const actionId = "composition-publication-hard-exit-action";
  const requestHash = canonicalHash({ action: actionId });
  const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: actionId,
    request_hash: requestHash, operation: "composition.create" });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const previewBytes = Uint8Array.from(Buffer.from("publication survives exactly as staged"));
  const revision = revisionInput({ scope, brief, design, previewBytes, revisionId: "composition-hard-exit-revision" });
  const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
    operation: "composition.create", composition_id: revision.composition_id,
    candidate_revision_id: revision.revision_id, source_revision_id: null,
    source_revision_sha256: null, plan: null };
  const begun = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, operation: "composition.create",
    request_hash: requestHash, intent, expected_current: null,
    expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
    expected_selection_revision: selection.revision });
  assert.equal(begun.status, "pending");
  const staged = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
    revision, preview_bytes: previewBytes });
  assert.equal(staged.status, "staged");
  const result = { status: "saved", composition: createCompositionProductionEnvelope(revision),
    revision_sha256: revision.revision_sha256, selection_revision: selection.revision };
  const fence = publicationFence({ brief, design, actionId, jobId: started.job_id, revision });
  store.close();

  const worker = fileURLToPath(new URL("../../fixtures/versions/composition-publication-crash-worker.mjs", import.meta.url));
  const publicationInput = Buffer.from(JSON.stringify({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
    revision_sha256: revision.revision_sha256, result, publication_fence: fence })).toString("base64url");
  const child = spawnSync(process.execPath, [worker, databasePath, objectRoot, publicationInput],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 86, `child must exit inside the publication transaction: ${child.stdout}${child.stderr}`);
  assert.equal(child.stdout, "hard_exit_at_composition.after_current_update\n");
  assert.equal(child.stderr, "");

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => clock });
  ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-publication-resume-${++id}`,
    leaseDurationMs: 1_000 });
  assert.equal(store.getCompositionAction({ scope, action_id: actionId }).status, "staged");
  assert.deepEqual(store.getCompositionAction({ scope, action_id: actionId }).preview_bytes, previewBytes);
  assert.equal(store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE job_id=?").get(started.job_id).status,
    "running");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0,
    "the revision insert made before the child exit rolls back with its transaction");
  assert.equal(store.getCurrentComposition({ scope, design_version_id: design.design_version_id }), null,
    "the current-pointer write made before the child exit rolls back with its transaction");

  clock = NOW + 2_000;
  const resumed = await ports.jobs.resumeExpired({ scope, actor_id: ACTOR, job_id: started.job_id,
    action_id: actionId, request_hash: requestHash });
  assert.equal(resumed.kind, "started");
  const replayedStage = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: resumed.lease_token, action_id: actionId, operation: "composition.create",
    request_hash: requestHash, intent, expected_current: null,
    expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
    expected_selection_revision: selection.revision });
  assert.equal(replayedStage.status, "staged");
  assert.deepEqual(replayedStage.preview_bytes, previewBytes);
  const publication = await ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: resumed.lease_token, action_id: actionId, operation: "composition.create", result,
    publication_fence: fence }, (transaction) => ports.storage.commitCompositionRevision({ scope,
    actor_id: ACTOR, action_id: actionId, job_id: started.job_id, request_hash: requestHash,
    revision_sha256: revision.revision_sha256 }, transaction));
  assert.equal(publication.status, "completed");
  assert.equal(publication.result.composition.revision.revision_sha256, revision.revision_sha256);
  assert.equal((await ports.jobs.get({ scope, job_id: started.job_id })).status, "completed");
  assert.equal((await ports.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id }))
    .revision.revision_sha256, revision.revision_sha256);
});

test("post-COMMIT hard-exit reopens as an exact public replay without repeating composition effects", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-publication-post-commit-hard-exit-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });

  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "composition-hard-exit-design" }))).design_version;
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  let portId = 0;
  let ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-post-commit-${++portId}` });

  // Publish the parent through the same durable job/action transaction used by
  // the public operation, so the child has a real current pointer to advance.
  const parentActionId = "composition-post-commit-parent";
  const parentRequestHash = canonicalHash({ action_id: parentActionId, operation: "composition.create" });
  const parentStarted = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: parentActionId,
    request_hash: parentRequestHash, operation: "composition.create" });
  const parentBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const parentRevision = revisionInput({ scope, brief, design, previewBytes: parentBytes,
    revisionId: "composition-hard-exit-parent", compositionId: "composition:hard-exit-public" });
  const parentIntent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
    operation: "composition.create", composition_id: parentRevision.composition_id,
    candidate_revision_id: parentRevision.revision_id, source_revision_id: null,
    source_revision_sha256: null, plan: null };
  assert.equal((await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR,
    job_id: parentStarted.job_id, lease_token: parentStarted.lease_token, action_id: parentActionId,
    operation: "composition.create", request_hash: parentRequestHash, intent: parentIntent,
    expected_current: null, expected_design_version_id: design.design_version_id,
    expected_design_hash: design.design_hash, expected_selection_revision: selection.revision })).status, "pending");
  assert.equal((await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR,
    job_id: parentStarted.job_id, lease_token: parentStarted.lease_token, action_id: parentActionId,
    request_hash: parentRequestHash, revision: parentRevision, preview_bytes: parentBytes })).status, "staged");
  const parentResult = compositionResult(parentRevision, parentBytes);
  const parentPublished = await ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: parentStarted.job_id,
    lease_token: parentStarted.lease_token, action_id: parentActionId, operation: "composition.create",
    result: parentResult, publication_fence: publicationFence({ brief, design, actionId: parentActionId,
      jobId: parentStarted.job_id, revision: parentRevision }) }, (transaction) => ports.storage.commitCompositionRevision({
    scope, actor_id: ACTOR, job_id: parentStarted.job_id, action_id: parentActionId,
    request_hash: parentRequestHash, revision_sha256: parentRevision.revision_sha256 }, transaction));
  assert.equal(parentPublished.status, "completed");

  const textLayer = parentRevision.layer_manifest.find((layer) => layer.kind === "text");
  assert.ok(textLayer, "the fixture parent has a manifest-bound text layer");
  const actionId = "composition-post-commit-public-update";
  const request = compositionApiRequest(actionId, "composition.update", {});
  const plan = createCompositionEditPlan({ plan_id: "composition-post-commit-plan",
    binding: parentRevision.binding, layer_manifest: parentRevision.layer_manifest,
    target_composition_revision_id: "composition-hard-exit-child",
    operations: [{ operation_id: "composition-post-commit-set-name", kind: "set_text",
      layer_id: textLayer.layer_id, value: "Published before response loss" }],
    trustedScope: scope });
  request.payload.plan = plan;
  const requestHash = compositionRequestHash(request);
  const childBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  const childRevision = childCompositionRevision(parentRevision, childBytes, plan, scope);
  const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: actionId,
    request_hash: requestHash, operation: "composition.update" });
  const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
    operation: "composition.update", composition_id: childRevision.composition_id,
    candidate_revision_id: childRevision.revision_id, source_revision_id: parentRevision.revision_id,
    source_revision_sha256: parentRevision.revision_sha256, plan };
  assert.equal((await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR,
    job_id: started.job_id, lease_token: started.lease_token, action_id: actionId,
    operation: "composition.update", request_hash: requestHash, intent,
    expected_current: { revision_id: parentRevision.revision_id, revision_sha256: parentRevision.revision_sha256 },
    expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
    expected_selection_revision: selection.revision })).status, "pending");
  assert.equal((await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR,
    job_id: started.job_id, lease_token: started.lease_token, action_id: actionId,
    request_hash: requestHash, revision: childRevision, preview_bytes: childBytes })).status, "staged");
  const result = compositionResult(childRevision, childBytes);
  const fence = publicationFence({ brief, design, actionId, jobId: started.job_id,
    revision: childRevision, expectedCurrent: parentRevision });
  const retainedDetails = { actionId, requestHash, parentRevisionId: parentRevision.revision_id,
    parentRevisionSha256: parentRevision.revision_sha256, childRevisionId: childRevision.revision_id,
    childRevisionSha256: childRevision.revision_sha256, resultSha256: canonicalHash(result) };
  store.close();
  await retainCompositionArtifact("postcommit-precut-staged", root, retainedDetails);

  // This worker exits only after the successful SQLite COMMIT has persisted
  // the revision, current pointer, action result, and completed public job.
  const worker = fileURLToPath(new URL("../../fixtures/versions/composition-publication-crash-worker.mjs", import.meta.url));
  const publicationInput = Buffer.from(JSON.stringify({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
    revision_sha256: childRevision.revision_sha256, result, publication_fence: fence,
    operation: "composition.update", fault_point: "after_job_commit" })).toString("base64url");
  retainedDetails.workerInputSha256 = createHash("sha256").update(publicationInput).digest("hex");
  const child = spawnSync(process.execPath, [worker, databasePath, objectRoot, publicationInput],
    { encoding: "utf8", timeout: 30_000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.signal, null, child.stderr);
  assert.equal(child.status, 86, `child must exit after committed publication: ${child.stdout}${child.stderr}`);
  assert.equal(child.stdout, "hard_exit_at_after_job_commit\n");
  assert.equal(child.stderr, "");
  retainedDetails.worker = child;
  await retainCompositionArtifact("postcommit-after-hard-exit-before-replay", root, retainedDetails);

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-post-commit-reopen-${++portId}` });
  const durableAction = await ports.storage.getCompositionAction({ scope, action_id: actionId });
  assert.equal(durableAction.status, "published");
  assert.equal(durableAction.revision.revision_sha256, childRevision.revision_sha256);
  assert.deepEqual(durableAction.preview_bytes, childBytes);
  const jobRow = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE job_id=?").get(started.job_id);
  assert.equal(jobRow.status, "completed");
  assert.equal(canonicalSerialize(JSON.parse(jobRow.result_json)), canonicalSerialize(result));
  assert.deepEqual(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 2);
  const history = await ports.storage.listCompositionRevisions({ scope,
    composition_id: childRevision.composition_id, limit: 10 });
  assert.deepEqual(new Set(history.items.map((item) => item.revision_id)),
    new Set([parentRevision.revision_id, childRevision.revision_id]));
  const current = await ports.storage.getCurrentComposition({ scope, design_version_id: design.design_version_id });
  assert.equal(current.revision.revision_id, childRevision.revision_id);
  assert.deepEqual(current.preview_bytes, childBytes);
  const old = await ports.storage.getCompositionRevision({ scope,
    composition_id: parentRevision.composition_id, revision_id: parentRevision.revision_id });
  assert.equal(old.revision.revision_sha256, parentRevision.revision_sha256);
  assert.deepEqual(old.preview_bytes, parentBytes);

  const effects = { resolveCurrent: 0, assertCurrent: 0, preparePreview: 0,
    image: 0, reservation: 0, provider: 0 };
  const replayPorts = createCreativeVersionApiPorts({ store, otherPorts: {
    composition: {
      resolveCurrent() { effects.resolveCurrent += 1; throw new Error("replay must not resolve new authority"); },
      assertCurrent() { effects.assertCurrent += 1; throw new Error("replay must not assert new authority"); },
      preparePreview() { effects.preparePreview += 1; throw new Error("replay must not prepare a preview"); },
    },
    provider: { generate() { effects.image += 1; }, edit() { effects.image += 1; } },
    metering: { reserveAttempt() { effects.reservation += 1; } },
    image: { generate() { effects.image += 1; } },
  } });
  const api = createCreativeApi({ ports: replayPorts.ports, now: () => NOW });
  const principal = { actor_id: ACTOR, tenant_id: scope.tenant_id, project_id: scope.project_id,
    expires_at: new Date(NOW + 60_000).toISOString(), permissions: ["creative.read", "creative.edit"],
    budget_scope_id: "composition-hard-exit-budget", budget_policy_version: "fixture-policy-v1" };
  const replay = await api.invoke(principal, request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.job.status, "completed");
  assert.equal(canonicalSerialize(replay.result), canonicalSerialize(result),
    "the public API returns the exact committed result and retained preview bytes after response loss");
  assert.deepEqual(effects, { resolveCurrent: 0, assertCurrent: 0, preparePreview: 0,
    image: 0, reservation: 0, provider: 0 },
  "completed post-COMMIT replay performs no owner, preview, provider, or reservation effect");
  store.close();
  store = null;
  await retainCompositionArtifact("postcommit-after-public-replay", root, retainedDetails);
});

test("a cancelled pending composition action remains durable without fabricated preview bytes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-pending-cancel-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "pending-cancel-design" }))).design_version;
  const ports = createCreativeVersionApiPorts({ store, idFactory: (() => {
    let index = 0;
    return () => `composition-cancel-port-${++index}`;
  })() });
  const actionId = "composition-cancel-before-preview";
  const requestHash = canonicalHash({ action: actionId });
  const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: actionId,
    request_hash: requestHash, operation: "composition.create" });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const proposedBytes = Uint8Array.from(Buffer.from("must not be staged after cancellation"));
  const proposed = revisionInput({ scope, brief, design, previewBytes: proposedBytes,
    revisionId: "composition-cancelled-revision" });
  const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0", operation: "composition.create",
    composition_id: proposed.composition_id, candidate_revision_id: proposed.revision_id,
    source_revision_id: null, source_revision_sha256: null, plan: null };
  const begun = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, operation: "composition.create", request_hash: requestHash,
    intent, expected_current: null, expected_design_version_id: design.design_version_id,
    expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
  assert.equal(begun.status, "pending");
  assert.equal(begun.revision, null);
  assert.equal(begun.preview_bytes, null);

  const cancelledJob = await ports.jobs.cancel({ scope, actor_id: ACTOR, job_id: started.job_id,
    target_action_id: actionId, action_id: "composition-cancel-request", request_hash: canonicalHash("cancel-request") });
  assert.equal(cancelledJob.kind, "cancelled");
  const finished = await ports.storage.finishCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
    status: "cancelled", reason: "job_cancelled_before_preview" });
  assert.equal(finished.status, "cancelled");
  assert.equal(finished.revision, null);
  assert.equal(finished.preview_bytes, null);

  const lateStage = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
    revision: proposed, preview_bytes: proposedBytes });
  assert.equal(lateStage.status, "conflict");
  assert.equal(store.getCurrentComposition({ scope, design_version_id: design.design_version_id }), null);
  assert.equal(store.listCompositionRevisions({ scope, composition_id: intent.composition_id, limit: 10 }).items.length, 0);

  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  const reopened = store.getCompositionAction({ scope, action_id: actionId });
  assert.equal(reopened.status, "cancelled");
  assert.equal(reopened.revision, null);
  assert.equal(reopened.preview_bytes, null);
  assert.equal(store.getCurrentComposition({ scope, design_version_id: design.design_version_id }), null);
});

test("recovery idempotently reconciles cancelled pending and staged composition actions after a process cut", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-cancel-recovery-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "cancel-recovery-design" }))).design_version;
  let id = 0;
  let ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-recovery-port-${++id}` });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const actions = [];

  for (const stage of [false, true]) {
    const actionId = stage ? "composition-cancelled-after-stage" : "composition-cancelled-before-stage";
    const requestHash = canonicalHash({ action: actionId });
    const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: actionId,
      request_hash: requestHash, operation: "composition.create" });
    const previewBytes = Uint8Array.from(Buffer.from(`exact staged bytes ${actionId}`));
    const revision = revisionInput({ scope, brief, design, previewBytes,
      revisionId: stage ? "composition-cancelled-staged-revision" : "composition-cancelled-pending-revision" });
    const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
      operation: "composition.create", composition_id: revision.composition_id,
      candidate_revision_id: revision.revision_id, source_revision_id: null,
      source_revision_sha256: null, plan: null };
    const begun = await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
      lease_token: started.lease_token, action_id: actionId, operation: "composition.create", request_hash: requestHash,
      intent, expected_current: null, expected_design_version_id: design.design_version_id,
      expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
    assert.equal(begun.status, "pending");
    if (stage) {
      const staged = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
        lease_token: started.lease_token, action_id: actionId, request_hash: requestHash,
        revision, preview_bytes: previewBytes });
      assert.equal(staged.status, "staged");
      assert.deepEqual(staged.preview_bytes, previewBytes);
    }
    const cancelled = await ports.jobs.cancel({ scope, actor_id: ACTOR, job_id: started.job_id,
      target_action_id: actionId, action_id: `cancel-request-${stage ? "staged" : "pending"}`,
      request_hash: canonicalHash({ cancel: actionId }) });
    assert.equal(cancelled.kind, "cancelled");
    const cut = await ports.storage.getCompositionAction({ scope, action_id: actionId });
    assert.equal(cut.status, stage ? "staged" : "pending",
      "the simulated process cut is after the durable job cancellation and before action finalization");
    actions.push({ actionId, revision, previewBytes, stage });
  }

  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-recovery-reopened-${++id}` });
  assert.deepEqual(await store.recover(), { examined: 2, committed: 0, conflicts: 0, unknown: 0 });
  for (const expected of actions) {
    const action = await ports.storage.getCompositionAction({ scope, action_id: expected.actionId });
    assert.equal(action.status, "cancelled");
    assert.equal(action.result.status, "cancelled");
    assert.equal(action.result.reason, expected.stage ? "job_cancelled_after_preview" : "job_cancelled_before_preview");
    if (expected.stage) {
      assert.equal(action.revision.revision_sha256, expected.revision.revision_sha256);
      assert.deepEqual(action.preview_bytes, expected.previewBytes,
        "recovery retains already staged preview evidence byte-for-byte and never regenerates it");
    } else {
      assert.equal(action.revision, null);
      assert.equal(action.preview_bytes, null, "pending cancellation never fabricates preview bytes");
    }
    assert.equal((await ports.jobs.get({ scope, job_id: action.job_id })).status, "cancelled");
    assert.equal(await ports.storage.getCompositionRevision({ scope, composition_id: expected.revision.composition_id,
      revision_id: expected.revision.revision_id }), null, "cancelled recovery cannot publish revision history");
  }
  assert.equal(store.getCurrentComposition({ scope, design_version_id: design.design_version_id }), null);
  assert.deepEqual(await store.recover(), { examined: 0, committed: 0, conflicts: 0, unknown: 0 },
    "a second recovery pass is an idempotent no-op after both actions reach terminal states");
});

test("publication refuses an asynchronous final authority fence and keeps the job uncompleted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-async-final-fence-"));
  const store = new CreativeVersionStore({ databasePath: join(root, "creative.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => "composition-async-fence-job" });
  const action_id = "composition-async-final-fence";
  const request_hash = canonicalHash({ action_id, operation: "generate" });
  const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id, request_hash, operation: "generate" });
  assert.equal(started.kind, "started");
  await assert.rejects(ports.jobs.completeIfActive({ scope, actor_id: ACTOR, job_id: started.job_id,
    lease_token: started.lease_token, action_id, operation: "generate", result: { status: "saved" },
    publication_fence: { brief_id: brief.brief_id, brief_hash: canonicalHash(brief),
      expected_current_design_version_id: null, expected_current_design_hash: null } },
  async () => ({ status: "persisted" }), async () => true),
  (error) => error instanceof VersionStoreError && error.code === "invalid_request" &&
    error.field === "job_publication.final_fence_async");
  assert.equal((await ports.jobs.get({ scope, job_id: started.job_id })).status, "running",
    "an asynchronous final callback cannot commit a completed result");
});

test("a child hard-exit after committed cancellation leaves pending and staged actions recoverable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-cancel-hard-exit-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "cancel-hard-exit-design" }))).design_version;
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-hard-exit-port-${++id}` });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const expected = [];
  for (const staged of [false, true]) {
    const action_id = staged ? "composition-hard-exit-staged" : "composition-hard-exit-pending";
    const request_hash = canonicalHash({ action_id });
    const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id, request_hash,
      operation: "composition.create" });
    const preview_bytes = Uint8Array.from(Buffer.from(`immutable preview bytes ${action_id}`));
    const revision = revisionInput({ scope, brief, design, previewBytes: preview_bytes,
      revisionId: `${action_id}-revision` });
    const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
      operation: "composition.create", composition_id: revision.composition_id,
      candidate_revision_id: revision.revision_id, source_revision_id: null,
      source_revision_sha256: null, plan: null };
    await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
      lease_token: started.lease_token, action_id, operation: "composition.create", request_hash, intent,
      expected_current: null, expected_design_version_id: design.design_version_id,
      expected_design_hash: design.design_hash, expected_selection_revision: selection.revision });
    if (staged) {
      const result = await ports.storage.stageCompositionRevision({ scope, actor_id: ACTOR, job_id: started.job_id,
        lease_token: started.lease_token, action_id, request_hash, revision, preview_bytes });
      assert.equal(result.status, "staged");
    }
    expected.push({ action_id, job_id: started.job_id, revision, preview_bytes, staged });
  }

  store.close();
  const worker = fileURLToPath(new URL("../../fixtures/versions/composition-cancel-crash-worker.mjs", import.meta.url));
  for (const item of expected) {
    const child = spawnSync(process.execPath, [worker, databasePath, objectRoot,
      scope.tenant_id, scope.project_id, scope.brief_id, ACTOR, item.job_id, item.action_id],
    { encoding: "utf8", timeout: 30_000 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.signal, null, `child should terminate through the deliberate hard exit: ${child.stderr}`);
    assert.equal(child.status, 86, `child must exit only after durable cancellation: ${child.stdout}${child.stderr}`);
    assert.equal(child.stdout, "durable_cancel_committed\n");
    assert.equal(child.stderr, "");

    store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
    const beforeRecovery = store.getCompositionAction({ scope, action_id: item.action_id });
    assert.equal(beforeRecovery.status, item.staged ? "staged" : "pending",
      "the actual child-process cut leaves the composition action unfinished after the job commits cancellation");
    assert.equal(store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(item.job_id).status, "cancelled");
    assert.deepEqual(await store.recover(), { examined: 1, committed: 0, conflicts: 0, unknown: 0 });
    const recovered = store.getCompositionAction({ scope, action_id: item.action_id });
    assert.equal(recovered.status, "cancelled");
    assert.equal(recovered.result.reason, item.staged
      ? "job_cancelled_after_preview" : "job_cancelled_before_preview");
    if (item.staged) {
      assert.equal(recovered.revision.revision_sha256, item.revision.revision_sha256);
      assert.deepEqual(recovered.preview_bytes, item.preview_bytes);
    } else {
      assert.equal(recovered.revision, null);
      assert.equal(recovered.preview_bytes, null);
    }
    assert.equal(await store.getCompositionRevision({ scope, composition_id: item.revision.composition_id,
      revision_id: item.revision.revision_id }), null);
    store.close();
  }
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.deepEqual(await store.recover(), { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
});

test("recovery records integrity-unknown for independently corrupted cancelled action identity or intent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "composition-cancel-corrupt-recovery-"));
  const databasePath = join(root, "creative.sqlite");
  const objectRoot = join(root, "objects");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(async () => { try { store.close(); } catch {} await rm(root, { recursive: true, force: true }); });
  const scope = DEFAULT_SCOPE;
  const brief = createBrief(scope);
  store.putBrief({ scope: { tenant_id: scope.tenant_id, project_id: scope.project_id }, brief });
  const design = (await store.saveDesignVersion(createWrite({ id: "corrupt-cancel-recovery-design" }))).design_version;
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `composition-corrupt-port-${++id}` });
  const selection = store.getSelection({ scope, brief_id: scope.brief_id });
  const cases = [
    { actionId: "composition-cancel-corrupt-identity", corruption: "identity" },
    { actionId: "composition-cancel-corrupt-intent", corruption: "intent" },
  ];
  for (const item of cases) {
    const requestHash = canonicalHash({ action: item.actionId });
    const started = await ports.jobs.begin({ scope, actor_id: ACTOR, action_id: item.actionId,
      request_hash: requestHash, operation: "composition.create" });
    const proposed = revisionInput({ scope, brief, design,
      previewBytes: Uint8Array.from(Buffer.from("never staged")),
      revisionId: `${item.actionId}-revision` });
    const intent = { contract: "CreativeCompositionActionIntent", schema_version: "1.0",
      operation: "composition.create", composition_id: proposed.composition_id,
      candidate_revision_id: proposed.revision_id, source_revision_id: null,
      source_revision_sha256: null, plan: null };
    await ports.storage.beginCompositionAction({ scope, actor_id: ACTOR, job_id: started.job_id,
      lease_token: started.lease_token, action_id: item.actionId, operation: "composition.create",
      request_hash: requestHash, intent, expected_current: null,
      expected_design_version_id: design.design_version_id, expected_design_hash: design.design_hash,
      expected_selection_revision: selection.revision });
    const cancelled = await ports.jobs.cancel({ scope, actor_id: ACTOR, job_id: started.job_id,
      target_action_id: item.actionId, action_id: `cancel-request-${item.corruption}`,
      request_hash: canonicalHash({ cancel: item.actionId }) });
    assert.equal(cancelled.kind, "cancelled");

    const triggers = store.db.prepare(`SELECT name,sql FROM sqlite_master
      WHERE type='trigger' AND name IN ('creative_composition_actions_identity_immutable',
        'creative_composition_actions_transition') ORDER BY name`).all();
    assert.equal(triggers.length, 2);
    const triggerSql = new Map(triggers.map((trigger) => [trigger.name, trigger.sql]));
    assert.ok([...triggerSql.values()].every((sql) => typeof sql === "string"));
    store.db.exec("BEGIN IMMEDIATE");
    try {
      store.db.exec("DROP TRIGGER creative_composition_actions_identity_immutable");
      store.db.exec("DROP TRIGGER creative_composition_actions_transition");
      if (item.corruption === "identity") {
        store.db.prepare(`UPDATE creative_composition_actions_v1 SET request_hash=?
          WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?`)
          .run(canonicalHash({ deliberately: "tampered identity" }), scope.tenant_id, scope.project_id,
            scope.brief_id, item.actionId);
      } else {
        const tampered = structuredClone(intent);
        tampered.candidate_revision_id = `${item.actionId}-different-candidate`;
        store.db.prepare(`UPDATE creative_composition_actions_v1 SET intent_json=?
          WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?`)
          .run(canonicalSerialize(tampered), scope.tenant_id, scope.project_id, scope.brief_id, item.actionId);
      }
      for (const [name, sql] of triggerSql) {
        store.db.exec(sql);
        assert.equal(store.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?")
          .get(name).sql, sql, `the fixture restores the exact original ${name} trigger before recovery`);
      }
      store.db.exec("COMMIT");
    } catch (error) {
      if (store.db.isTransaction) store.db.exec("ROLLBACK");
      throw error;
    }
  }

  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.deepEqual(await store.recover(), { examined: 2, committed: 0, conflicts: 0, unknown: 2 });
  for (const item of cases) {
    const raw = store.db.prepare(`SELECT status,request_hash,intent_json,intent_hash,result_json,
      candidate_revision_json,preview_bytes FROM creative_composition_actions_v1
      WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?`)
      .get(scope.tenant_id, scope.project_id, scope.brief_id, item.actionId);
    assert.equal(raw.status, "unknown");
    assert.equal(JSON.parse(raw.result_json).code, "integrity_error");
    assert.equal(JSON.parse(raw.result_json).reason, "cancelled_action_integrity_error");
    assert.equal(raw.candidate_revision_json, null);
    assert.equal(raw.preview_bytes, null);
    if (item.corruption === "identity") {
      assert.notEqual(raw.request_hash, canonicalHash({ action: item.actionId }),
        "recovery records, rather than repairs, the corrupted action identity");
    } else {
      assert.notEqual(canonicalHash(JSON.parse(raw.intent_json)), raw.intent_hash,
        "recovery records, rather than recomputes, the corrupted intent hash");
    }
  }
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0);
  assert.deepEqual(await store.recover(), { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
});
