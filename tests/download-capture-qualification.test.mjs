import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CaptureQualification, captureQualificationPlan, retainFirstCapture } from "../scripts/lib/download-capture-qualification.mjs";

const plan = captureQualificationPlan([{ name: "390" }, { name: "1440" }]);
const pairId = ({ viewport, trial }) => `${viewport.name}:${trial}`;
let sequence = 0;
function capture(ledger, id, phase, matched = true) {
  const n = ++sequence;
  ledger.captured(id, phase, { captureId: `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`, sha256: "a".repeat(64), file: `capture-${n}.png` });
  ledger.compared(id, phase, matched, { mean: matched ? 3 : 103, bad: matched ? 0.02 : 0.57 });
}
function run({ failFirst = false, omitLast = false, exceptionFirst = false, skipLastCompare = false } = {}) {
  const ledger = new CaptureQualification(plan);
  for (const [index, item] of plan.entries()) {
    if (omitLast && index === plan.length - 1) continue;
    const id = pairId(item);
    ledger.begin(id);
    if (exceptionFirst && index === 0) { ledger.finish(id, 1, true); continue; }
    capture(ledger, id, "original", !failFirst || index !== 0);
    if (!skipLastCompare || index !== plan.length - 1) capture(ledger, id, "edited");
    ledger.finish(id, failFirst && index === 0 ? 1 : 0);
  }
  return ledger;
}

test("fixed matrix preserves both baseline pages then adds exactly two fresh pages per viewport", () => {
  assert.deepEqual(plan.map((p) => [p.viewport.name, p.trial, p.kind]), [
    ["390", 0, "baseline"], ["1440", 0, "baseline"], ["390", 1, "fresh_page"], ["390", 2, "fresh_page"], ["1440", 1, "fresh_page"], ["1440", 2, "fresh_page"],
  ]);
  const record = run().snapshot();
  assert.equal(record.expectedPairs, 6); assert.equal(record.expectedFirstCaptures, 12);
  assert.equal(record.recordedFirstCaptures, 12); assert.equal(record.comparedFirstCaptures, 12);
  assert.equal(record.complete, true); assert.equal(record.passed, true);
  assert.equal(record.sharedBrowserProfileAndCache, true); assert.equal(record.coldCacheClaim, false);
});

test("one failed first frame is retained and fails the whole matrix after every later pair passes", () => {
  const record = run({ failFirst: true }).snapshot();
  assert.equal(record.complete, true); assert.equal(record.passed, false);
  assert.equal(record.attemptedPairs, 6); assert.equal(record.comparedFirstCaptures, 12);
  assert.equal(record.pairs[0].phases.original.matched, false);
  assert.equal(record.pairs[0].phases.original.mean, 103);
  assert.ok(record.pairs.slice(1).every((p) => p.status === "passed"));
});

test("missing, skipped or exceptional pairs cannot pass even when all observed comparisons pass", () => {
  for (const option of ["omitLast", "exceptionFirst", "skipLastCompare"]) {
    const record = run({ [option]: true }).snapshot();
    assert.equal(record.passed, false, option); assert.equal(record.complete, false, option);
    if (option === "exceptionFirst") { assert.equal(record.attemptedPairs, 6); assert.equal(record.pairs[0].exception, true); }
  }
});

test("a second comparison cannot replace an earlier failed first result", () => {
  const ledger = run({ failFirst: true });
  const before = ledger.snapshot();
  ledger.compared("390:0", "original", true, { mean: 0, bad: 0 });
  const after = ledger.snapshot();
  assert.deepEqual(after.pairs[0], before.pairs[0]);
  assert.ok(after.violations.includes("invalid_or_duplicate_comparison"));
  assert.equal(after.passed, false);
});

test("duplicate capture IDs, malformed metrics and duplicate pair completion fail closed", () => {
  const ledger = new CaptureQualification(plan);
  ledger.begin("390:0");
  const first = { captureId: "00000000-0000-0000-0000-000000000001", sha256: "a".repeat(64), file: "first.png" };
  ledger.captured("390:0", "original", first);
  ledger.captured("390:0", "edited", first);
  ledger.compared("390:0", "original", true, { mean: NaN, bad: 0 });
  ledger.finish("390:0", 0); ledger.finish("390:0", 0);
  const record = ledger.snapshot();
  assert.equal(record.passed, false);
  assert.deepEqual(record.violations, ["invalid_or_duplicate_first_capture", "invalid_or_duplicate_comparison", "invalid_or_duplicate_pair_completion"]);
});

test("a selected diagnostic viewport is labeled as a subset, never the full gate", () => {
  const subset = new CaptureQualification(captureQualificationPlan([{ name: "390" }]), { diagnosticSubset: true }).snapshot();
  assert.equal(subset.scope, "diagnostic_subset");
  assert.equal(subset.expectedPairs, 3); assert.equal(subset.expectedFirstCaptures, 6);
  assert.equal(subset.passed, false);
});

test("empty, duplicated or missing viewport plans cannot declare a complete full gate", () => {
  for (const invalid of [[], plan.slice(0, -1), [...plan, plan[0]], captureQualificationPlan([{ name: "390" }])]) {
    const result = new CaptureQualification(invalid).snapshot();
    assert.equal(result.passed, false);
    assert.ok(result.violations.includes("invalid_or_incomplete_fixed_plan"));
  }
});

test("distinct capture IDs cannot share a file that would overwrite earlier authoritative bytes", () => {
  const ledger = new CaptureQualification(plan);
  ledger.begin("390:0");
  ledger.captured("390:0", "original", { captureId: "00000000-0000-0000-0000-000000000001", sha256: "a".repeat(64), file: "same.png" });
  ledger.captured("390:0", "edited", { captureId: "00000000-0000-0000-0000-000000000002", sha256: "b".repeat(64), file: "same.png" });
  assert.ok(ledger.snapshot().violations.includes("invalid_or_duplicate_first_capture"));
  assert.equal(ledger.snapshot().pairs[0].phases.original.sha256, "a".repeat(64));
});

test("the actual first-capture writer preserves an existing frame and never counts its rejected replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "ticketstub-first-capture-"));
  try {
    const qualification = new CaptureQualification(plan);
    qualification.begin("390:0");
    const first = { directory, file: "first.png", png: Buffer.from("original-failed-frame"), captureId: "00000000-0000-0000-0000-000000000001",
      sha256: "a".repeat(64), qualification, pairId: "390:0", phase: "original" };
    retainFirstCapture(first);
    qualification.compared("390:0", "original", false, { mean: 103, bad: 0.57 });
    const retained = qualification.snapshot().pairs[0].phases.original;
    assert.throws(() => retainFirstCapture({ ...first, png: Buffer.from("later-passing-frame"), phase: "edited",
      captureId: "00000000-0000-0000-0000-000000000002", sha256: "b".repeat(64) }), { code: "EEXIST" });
    qualification.finish("390:0", 1, true);
    assert.equal(readFileSync(join(directory, "first.png"), "utf8"), "original-failed-frame");
    assert.deepEqual(qualification.snapshot().pairs[0].phases.original, retained);
    assert.equal(qualification.snapshot().recordedFirstCaptures, 1);
    assert.equal(qualification.snapshot().pairs[0].phases.edited, undefined);
    assert.equal(qualification.snapshot().passed, false);
  } finally { rmSync(directory, { recursive: true }); }
});
