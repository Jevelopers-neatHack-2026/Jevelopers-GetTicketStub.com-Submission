// Credential-free check of the research review and version history logic (GT-05, GT-06A): fact grouping, targeted questions,
// the immutable correction history (a correction keeps the original, an undo is a new entry), restoring a version without
// overwriting or generating, branching after a restore, and the compare diff in words. No network, no provider call.
// Run: node scripts/check-review-versions.mjs   (Node 22.15+; uses module.registerHooks to run the .ts sources directly)
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

process.removeAllListeners("warning"); // the .ts sources have no package "type"; the reparse warning is noise here
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

registerHooks({
  resolve(specifier, context, next) {
    let spec = specifier;
    if (spec.startsWith("@/")) spec = pathToFileURL(join(src, spec.slice(2))).href;
    try {
      return next(spec, context);
    } catch (err) {
      if (!/^(\.|file:)/.test(spec)) throw err;
      for (const ext of [".ts", "/index.ts"]) {
        try { return next(spec + ext, context); } catch { /* try the next one */ }
      }
      throw err;
    }
  },
});

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, String(v)), removeItem: (k) => void store.delete(k) };
globalThis.fetch = () => { throw new Error("check-review-versions must not use the network"); };

const at = (rel) => pathToFileURL(join(src, rel)).href;
const fx = await import(at("customer/studio/facts/corrections.ts"));
const ver = await import(at("customer/studio/versions/versions.ts"));
const ops = await import(at("customer/studio/editor/ops.ts"));
const st = await import(at("customer/studio/store.ts"));
const { PALE_HOURS, NEATHACK, newStub } = await import(at("customer/studio/fixtures.ts"));

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const pale = () => newStub(clone(PALE_HOURS), "pale-test");
const T0 = new Date("2026-10-10T10:00:00Z");
const T1 = new Date("2026-10-10T10:05:00Z");
const T2 = new Date("2026-10-10T10:09:00Z");

// ---------- GT-05: grouping ----------
check("facts group into source, unsure and missing; confidence that is unknown is never verified", () => {
  const s = pale();
  s.event.facts.push({ id: "weather2", label: "Weather: pending", value: "pending", source: "Open-Meteo", confidence: 0.2, provenance: "pending" });
  s.event.facts.push({ id: "odd", label: "Odd", value: "x", source: "page", confidence: undefined, provenance: "live" });
  const g = fx.groupFacts(s.event.facts, s);
  assert.deepEqual(g.source.map((f) => f.id).sort(), ["opener", "run", "weather"]);
  assert.deepEqual(g.unsure.map((f) => f.id).sort(), ["date", "odd"]);
  assert.deepEqual(g.missing.map((f) => f.id), ["weather2"]);
  assert.equal(g.corrected.length, 0);
});

check("sources that disagree are unsure even when the guess is confident-looking, until one is chosen", () => {
  const f = { id: "venue", label: "Hall", value: "Hall", source: "a", confidence: 0.5, provenance: "live", alternatives: ["Hall", "Arena"] };
  assert.equal(fx.isConflicting(f), true);
  assert.equal(fx.isConflicting({ ...f, confidence: 0.9 }), false);
});

// ---------- GT-05: targeted questions ----------
check("a conflicting date asks one short question with the known alternatives, and nothing is asked twice", () => {
  const s = pale();
  const qs = fx.openQuestions(s);
  assert.deepEqual(qs.map((q) => q.factId), ["date"]);
  assert.equal(qs[0].text, "Which date was it?");
  assert.deepEqual(qs[0].alternatives, ["2024-10-12", "2024-10-11", "2024-10-13"]);
  assert.equal(qs[0].input, "date");
  assert.equal(qs[0].required, true);
  const answered = fx.applyCorrection(s, { factId: "date", value: "2024-10-11", now: T0 });
  assert.deepEqual(fx.openQuestions(answered), [], "answering closes the question for every surface");
});

check("missing required facts ask; missing optional facts stay unknown and are not asked", () => {
  const s = newStub(clone(NEATHACK), "hack-test"); // no venue, optional "teams"/"winners" are pending
  const ids = fx.openQuestions(s).map((q) => q.factId);
  assert.ok(ids.includes("venue"), "venue is required and missing");
  assert.ok(!ids.includes("teams") && !ids.includes("winners"), "optional pending facts are not asked");
  assert.equal(fx.openQuestions(s).find((q) => q.factId === "venue").text, "Where was it?");
});

// ---------- GT-05: correction history ----------
check("a correction keeps original, corrected value, who, when and the optional reason, and shows as your correction", () => {
  const s0 = pale();
  const s1 = fx.applyCorrection(s0, { factId: "date", value: "2024-10-13", reason: "Ticket stub says the 13th", now: T0 });
  const c = s1.corrections[0];
  assert.equal(c.kind, "correct");
  assert.equal(c.by, "you");
  assert.equal(c.at, T0.toISOString());
  assert.equal(c.reason, "Ticket stub says the 13th");
  assert.equal(c.original.value, "2024-10-12");
  assert.equal(c.original.source, "ticket");
  assert.equal(c.original.confidence, 0.62);
  assert.equal(c.corrected.value, "2024-10-13");
  assert.equal(s1.event.dateISO, "2024-10-13", "the stub prints the corrected date");
  assert.equal(fx.factGroup(s1, s1.event.facts.find((f) => f.id === "date")), "corrected");
  assert.equal(fx.originalOf(s1, s1.event.facts.find((f) => f.id === "date")).value, "2024-10-12", "the original stays viewable");
  assert.equal(s0.corrections, undefined, "the earlier stub is untouched");
  assert.ok(!("reason" in fx.applyCorrection(s0, { factId: "date", value: "2024-10-11", now: T0 }).corrections[0]), "no reason when none was given");
});

check("history is append-only: undo is a new entry and nothing before it changes", () => {
  const s1 = fx.applyCorrection(pale(), { factId: "date", value: "2024-10-13", now: T0 });
  const s2 = fx.applyCorrection(s1, { factId: "date", value: "2024-10-11", reason: "second thought", now: T1 });
  const before = JSON.stringify(s2.corrections);
  const s3 = fx.undoCorrection(s2, "date", T2);
  assert.equal(s3.corrections.length, 3);
  assert.equal(JSON.stringify(s3.corrections.slice(0, 2)), before, "earlier entries are byte-identical");
  const undo = s3.corrections[2];
  assert.equal(undo.kind, "undo");
  assert.equal(undo.undoes, s2.corrections[1].id);
  assert.equal(s3.event.dateISO, "2024-10-13", "back to the earlier correction of yours");
  assert.equal(fx.activeCorrection(s3, "date").id, s1.corrections[0].id);
  const s4 = fx.undoCorrection(s3, "date", new Date("2026-10-10T10:12:00Z"));
  assert.equal(s4.corrections.length, 4);
  const f = s4.event.facts.find((x) => x.id === "date");
  assert.equal(f.value, "2024-10-12", "all the way back to the research");
  assert.equal(f.confidence, 0.62, "and the research confidence is restored, not promoted");
  assert.equal(fx.factGroup(s4, f), "unsure");
  assert.equal(fx.undoCorrection(s4, "date"), s4, "nothing left to undo");
});

check("confirming the same value is recorded as a confirmation, not a correction; empty answers record nothing", () => {
  const s = pale();
  assert.equal(fx.applyCorrection(s, { factId: "date", value: "2024-10-12", now: T0 }).corrections[0].kind, "confirm");
  assert.equal(fx.applyCorrection(s, { factId: "date", value: "   " }), s);
});

check("answering a missing required fact creates the fact and fills the stub", () => {
  const s = newStub(clone(NEATHACK), "hack-test");
  const s1 = fx.applyCorrection(s, { factId: "venue", value: "Online", now: T0 });
  assert.equal(s1.event.venue, "Online");
  assert.equal(s1.corrections[0].original.provenance, "pending");
  assert.equal(fx.factGroup(s1, s1.event.facts.find((f) => f.id === "venue")), "corrected");
  assert.equal(fx.undoCorrection(s1, "venue").event.facts.find((f) => f.id === "venue").provenance, "pending");
});

check("a correction to a printed fact says so; an unkept optional fact does not", () => {
  const s = pale();
  assert.equal(fx.changesPrintedStub(s, "date", "2024-10-13"), true, "the date is always printed");
  assert.equal(fx.changesPrintedStub(s, "date", "2024-10-12"), false, "same value changes nothing");
  assert.equal(fx.changesPrintedStub(s, "run", "Night 3 of 3"), true, "kept facts print");
  assert.equal(fx.changesPrintedStub(s, "opener", "Someone else"), false, "an unkept fact is not printed");
});

check("permission-sensitive assets are never shown as allowed unless a source says so", () => {
  const s = pale();
  s.event.assets = [
    { id: "a", label: "Poster", status: "unknown" },
    { id: "b", label: "Photo", status: "blocked", reason: "The page forbids reuse." },
    { id: "c", label: "Logo", status: "bogus" },
    { id: "d", label: "Own", status: "allowed" },
  ];
  const out = fx.reviewAssets(s);
  assert.deepEqual(out.map((a) => a.status), ["unknown", "blocked", "unknown", "allowed"]);
  assert.match(fx.assetExplanation(out[0]), /can't confirm/);
  assert.equal(fx.assetExplanation(out[1]), "The page forbids reuse.");
});

check("the store keeps the history per stub and appends only", () => {
  const s = pale();
  st.saveWall([s]);
  const a = st.recordCorrection(s.id, { factId: "date", value: "2024-10-11", now: T0 });
  assert.equal(st.correctionsFor(s.id).length, 1);
  const b = st.undoStubCorrection(s.id, "date");
  assert.equal(st.correctionsFor(s.id).length, 2);
  assert.equal(st.correctionsFor(s.id)[0].id, a.corrections[0].id);
  assert.equal(b.event.dateISO, "2024-10-12");
  assert.equal(st.recordCorrection("nope", { factId: "date", value: "2024-10-11" }), undefined);
});

// ---------- GT-06A: versions ----------
function history() {
  let s = pale();
  const v1 = s.currentVersionId;
  s = ops.addArtVersion(s, { kind: "procedural", seed: 11, vibe: "Neon", provenance: "simulated" });
  const v2 = s.currentVersionId;
  s = ops.setEdition(s, "letterpress");
  const v3 = s.currentVersionId;
  return { s, v1, v2, v3 };
}

check("each version has a stable short id, a parent and a plain account of how it was made", () => {
  const { s, v1, v2, v3 } = history();
  const [a, b, c] = [v1, v2, v3].map((id) => s.versions.find((v) => v.id === id));
  assert.match(ver.versionHash(b), /^[0-9a-f]{6}$/);
  assert.equal(ver.versionHash(b), ver.versionHash({ ...b }), "stable");
  assert.notEqual(ver.versionHash(a), ver.versionHash(b));
  assert.equal(b.parentId, v1);
  assert.equal(c.parentId, v2);
  assert.equal(ver.howMade(s, a).kind, "first");
  assert.equal(ver.howMade(s, b).text, "Remix, Neon vibe");
  assert.equal(ver.howMade(s, c).kind, "edition");
  assert.equal(ver.artLabel(b.art).sample, true, "simulated procedural art is labelled as a sample");
  assert.match(ver.artLabel(b.art).text, /sample/i);
  assert.equal(ver.artLabel({ kind: "image", seed: 1, provenance: "live", src: "x" }).sample, false);
  assert.equal(ver.artLabel({ kind: "procedural", seed: 1, provenance: "live" }).sample, true, "a generated image that was not kept is shown as a sample");
  assert.equal(ver.listVersions(s)[0].id, v3, "newest first");
});

check("restoring selects a prior version, overwrites nothing and generates nothing", () => {
  const { s, v1, v2 } = history();
  const frozen = JSON.stringify(s.versions);
  const r = ver.restoreVersion(s, v1);
  assert.equal(r.currentVersionId, v1);
  assert.equal(JSON.stringify(r.versions), frozen, "every version is byte-identical");
  assert.equal(r.versions.length, s.versions.length, "no version was added");
  assert.equal(ver.restoreVersion(r, v1), r, "restoring the selected one changes nothing");
  assert.equal(ver.restoreVersion(s, "missing"), s, "an unknown id leaves the selection alone");
  assert.equal(ver.restoreVersion(r, v2).currentVersionId, v2, "and you can go forward again");
});

check("an edit after a restore branches from the restored version", () => {
  const { s, v1, v2 } = history();
  const r = ver.restoreVersion(s, v2);
  const art = ops.addArtVersion(r, { kind: "procedural", seed: 99, vibe: "70s", provenance: "simulated" });
  const made = art.versions[art.versions.length - 1];
  assert.equal(made.parentId, v2);
  assert.equal(art.currentVersionId, made.id);
  const back = ver.restoreVersion(art, v1);
  const edition = ops.setEdition(back, "minimal");
  const ed = edition.versions[edition.versions.length - 1];
  assert.equal(ed.parentId, v1, "a new style after going back is a branch of the first version");
  assert.equal(ed.id, edition.currentVersionId);
  assert.equal(edition.versions.length, art.versions.length + 1, "the older branch is still there");
});

check("going back to earlier art does not create a duplicate version", () => {
  const { s, v1 } = history();
  const before = s.versions.length;
  const r = ver.restoreVersion(s, v1);
  assert.equal(r.versions.length, before);
});

check("compare lists what changed in words: art, style, material, finish, kept facts and personalization", () => {
  let { s, v1 } = history();
  const v3 = s.currentVersionId;
  // v1 was made before anything else; give it a recorded context like a newer version would have
  s = { ...s, versions: s.versions.map((v) => (v.id === v1 ? { ...v, context: ver.contextOf(s) } : v)) };
  s = ops.setMaterial(s, "card");
  s = ops.setFinish(s, "matte");
  s = ops.toggleKept(s, "opener");
  s = ops.setFont(s, 2);
  s = ops.toggleFoil(s);
  const text = ver.compareVersions(s, v1, v3).map((c) => c.text).join("\n");
  assert.match(text, /Art: .* became/);
  assert.match(text, /Style: researched became letterpress/);
  assert.match(text, /Material: print became card/);
  assert.match(text, /Finish: foil became matte/);
  assert.match(text, /Kept facts: added Opener: Velvet Coast/);
  assert.match(text, /Personalization: title font 1 to 3; foil title off/);
  const fields = ver.compareVersions(s, v1, v3).map((c) => c.field);
  assert.deepEqual(fields, ["art", "edition", "material", "finish", "facts", "personalization"]);
});

check("compare says so when an older version has no recorded settings, instead of guessing", () => {
  const { s, v1, v2 } = history();
  const out = ver.compareVersions(s, v1, v2);
  assert.ok(out.some((c) => /not recorded/.test(c.text)));
  assert.equal(ver.compareVersions(s, v1, "missing").length, 0);
});

check("the same art in two versions is reported as the same, with nothing else differing", () => {
  const { s } = history();
  const a = s.versions[0];
  const out = ver.compareVersions({ ...s, versions: s.versions.map((v) => ({ ...v, context: ver.contextOf(s) })) }, a.id, a.id);
  assert.deepEqual(out.map((c) => c.text), ["Art: the same.", "Nothing else differs."]);
});

check("the selected version is named for approval, and a restore changes which one", () => {
  const { s, v1, v3 } = history();
  assert.equal(s.currentVersionId, v3);
  const now = ver.selectedSummary(s);
  assert.equal(now.hash, ver.versionHash(s.versions.find((v) => v.id === v3)));
  assert.match(now.text, /letterpress style/);
  const r = ver.restoreVersion(s, v1);
  assert.notEqual(ver.selectedSummary(r).hash, now.hash);
  assert.equal(ver.selectedSummary(r).hash, ver.versionHash(s.versions.find((v) => v.id === v1)));
});

console.log(`\n${passed} checks passed${process.exitCode ? ", some failed" : ""}.`);
