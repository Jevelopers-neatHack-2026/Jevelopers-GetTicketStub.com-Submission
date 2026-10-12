// Derives tests/fixtures/production-bundle/provenance.json PROGRAMMATICALLY from the real producer artifact bytes.
// Nothing in the output is typed by hand: every hash, size, ref and pin is computed or read from the artifact.
// usage: node tests/production-bundle-provenance-tool.mjs <artifactDir> <artifactZip> <custodyReceipt.json> <runId> <artifactId> <outFile>
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [artifactDir, artifactZip, receiptPath, runId, artifactId, outFile] = process.argv.slice(2);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const files = Object.fromEntries(walk(artifactDir).map((path) => {
  const bytes = readFileSync(path);
  return [relative(artifactDir, path), { size: bytes.length, sha256: sha(bytes) }];
}));
const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const receiptEntries = receipt.entries.map((entry) => ({ path: entry.path.replace(/^/, ""), size: entry.size, sha256: entry.sha256 }));
const mismatches = receiptEntries.filter((entry) => files[entry.path]?.sha256 !== entry.sha256 || files[entry.path]?.size !== entry.size).map((entry) => entry.path);
const unlisted = Object.keys(files).filter((path) => !receiptEntries.some((entry) => entry.path === path));
if (mismatches.length !== 0 || receiptEntries.length !== 64 || Object.keys(files).length !== 65 || unlisted.join() !== "CORPUS.json") {
  throw new Error(`artifact does not match custody receipt: ${JSON.stringify({ mismatches, entries: receiptEntries.length, files: Object.keys(files).length, unlisted })}`);
}
const corpus = JSON.parse(readFileSync(join(artifactDir, "CORPUS.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(artifactDir, "bundle/manifest.json"), "utf8"));
const commitment = JSON.parse(readFileSync(join(artifactDir, "bundle/trusted-commitment.json"), "utf8"));
const kind = (path) => path === "CORPUS.json" ? "corpus-json" : path === "bundle/trusted-commitment.json" ? "control" : path.startsWith("bundle/") ? "baseline" : "variant";
const pins = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, value]) => ({ path, kind: kind(path), size: value.size, sha256: value.sha256 }));
const counts = pins.reduce((acc, pin) => ({ ...acc, [pin.kind]: (acc[pin.kind] ?? 0) + 1 }), {});
const refs = Object.fromEntries(["spec_ref", "capability_ref", "composition_ref", "facts_ref", "template_ref", "approval_ref", "handoff_ref", "renderer_ref", "lineage_ref"].map((key) => [key, manifest[key]]));
const extra = readFileSync(join(artifactDir, "variants/extra-file/extra.bin"));
const out = {
  schema: "fulfillment-production-bundle-fixture-provenance/1",
  note: "Synthetic, unaccepted producer diagnostic corpus. Not an approved ProductionBundle, no approval, no supplier eligibility, no order authority.",
  synthetic: corpus.synthetic,
  accepted: corpus.accepted,
  handoffEligible: corpus.handoffEligible,
  finance_receipt: corpus.finance_receipt,
  canonical_usage_intake: corpus.canonical_usage_intake,
  usage_refs: corpus.usage_refs,
  producer: {
    repository: "Jevelopers-neatHack-2026/print-production",
    revision: corpus.production_revision,
    linuxRun: Number(runId),
    artifactId: Number(artifactId),
    artifactName: "pp16-bundle-handoff-1",
    artifactZipSha256: sha(readFileSync(artifactZip)),
    corpusJsonSha256: files["CORPUS.json"].sha256,
    runtime: corpus.runtime
  },
  sharedContractsPin: corpus.shared_contracts_pin,
  counts: { regularFiles: Object.keys(files).length, receiptEntries: receiptEntries.length, byKind: counts },
  bundle: { id: commitment.bundle_ref.id, revision: commitment.bundle_ref.revision, hash: commitment.bundle_ref.content_hash, schemaVersion: manifest.schema_version },
  scope: { tenant_id: manifest.tenant_id, project_id: manifest.project_id },
  trustedCommitment: { name: "trusted-commitment.json", ...files["bundle/trusted-commitment.json"] },
  manifestRefs: refs,
  composedPreviewHash: manifest.composition.composed_preview_hash,
  rowScope: manifest.row_scope,
  extraBin: { literal: new TextDecoder().decode(extra), length: extra.length, sha256: sha(extra) },
  pins
};
writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify({ wrote: outFile, pins: pins.length, counts }));
