// Structural check of the creative-engine adapter against creative-engine's fixture JSON.
// Run: node scripts/check-creative-adapter.mjs   (Node 22.15+; uses module.registerHooks to run the .ts sources directly)
// Builds a brief, edit plans, a DesignControlSchema and an API envelope from the demo stubs and compares keys and enums
// with the vendored fixtures in src/customer/studio/creative/fixtures (creative-engine impl/creative-brief-integrated).
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

process.removeAllListeners("warning"); // the .ts sources have no package "type"; the reparse warning is noise here
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

// Node's type stripping needs explicit extensions; the Next sources use extensionless and "@/" imports.
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

const dir = join(src, "customer/studio/creative");
const fx = (name) => JSON.parse(readFileSync(join(dir, "fixtures", name), "utf8"));
const adapter = await import(pathToFileURL(join(dir, "adapter.ts")).href);
const controlsMod = await import(pathToFileURL(join(dir, "controls.ts")).href);
const demo = await import(pathToFileURL(join(src, "customer/studio/fixtures.ts")).href);
const ops = await import(pathToFileURL(join(src, "customer/studio/editor/ops.ts")).href);

const failures = [];
const notes = [];
const pendingFields = [];
const fail = (m) => failures.push(m);

const scope = {
  tenantId: "tenant-ticketstub-demo",
  projectId: "project-ticketstub-demo",
  correlationId: "journey-demo-1",
  actor: { actorId: "account-demo-1" },
  environment: "test",
  billingMode: "simulated",
  now: () => "2026-10-10T12:00:00.000Z",
  newId: (kind) => `${kind}-fixed`,
};

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Same keys (recursively, using the fixture's first array item as the shape). `ext` lists paths where we deliberately add keys. */
function sameShape(label, actual, expected, { ext = [], skip = [], path = "$" } = {}) {
  if (skip.includes(path)) return;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return fail(`${label} ${path}: expected an array`);
    if (expected.length && actual.length) for (const item of actual) sameShape(label, item, expected[0], { ext, skip, path: `${path}[]` });
    return;
  }
  if (!isObj(expected)) {
    if (isObj(actual) || Array.isArray(actual)) fail(`${label} ${path}: expected a scalar`);
    return;
  }
  if (!isObj(actual)) return fail(`${label} ${path}: expected an object`);
  for (const k of Object.keys(expected)) if (!(k in actual)) fail(`${label} ${path}.${k}: missing (fixture has it)`);
  for (const k of Object.keys(actual)) {
    if (!(k in expected)) {
      if (ext.includes(`${path}.${k}`) || ext.includes(`${path}[].${k}`)) notes.push(`${label} ${path}.${k}: our extension, not in the fixture`);
      else fail(`${label} ${path}.${k}: extra key (not in fixture)`);
    } else sameShape(label, actual[k], expected[k], { ext, skip, path: `${path}.${k}` });
  }
}

function sameEnums(label, actual, expected, paths) {
  for (const p of paths) {
    const get = (o) => p.split(".").reduce((x, k) => x?.[k], o);
    if (get(actual) !== get(expected)) fail(`${label} ${p}: "${get(actual)}" vs fixture "${get(expected)}"`);
  }
}

function collectPending(label, value, path = "$") {
  if (typeof value === "string" && value.startsWith("PENDING_")) pendingFields.push(`${label} ${path} = ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => collectPending(label, v, `${path}[${i}]`));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) collectPending(label, v, `${path}.${k}`);
}

const stub = demo.newStub(structuredClone(demo.PALE_HOURS), "pale1");
const first = ops.setEdition(stub, "letterpress");

// 1. CreativeBrief
const brief = adapter.toCreativeBrief(first, scope);
const briefFx = fx("creative-brief.json");
sameShape("brief", brief, briefFx);
sameEnums("brief", brief, briefFx, ["contract", "schema_version", "environment", "billing_mode", "research_package_ref.contract", "research_package_ref.schema_version"]);
if (!brief.facts.unresolved.some((f) => f.fact_id === "date" && f.status === "conflicting")) fail("brief: the 0.62-confidence date should be unresolved/conflicting");
if (!brief.facts.verified.some((f) => f.fact_id === "run")) fail("brief: the 0.95 fact should be verified");
for (const p of ["preferences", "interpretations", "permissions", "locks"]) {
  if (!["absent", "unknown", "present"].includes(brief[p].presence)) fail(`brief ${p}.presence: not an upstream enum value`);
}
collectPending("brief", brief);

// 2. EditPlan for each op
const planFx = fx("edit-plan.json");
const generateFx = fx("api-generate-plan.json");
const imageEditFx = fx("api-image-edit-plan.json");
const opCases = [
  [{ type: "setFont", index: 2 }, planFx],
  [{ type: "setTitleColour", value: "#E4572E" }, planFx],
  [{ type: "setFoilTitle", on: false }, planFx],
  [{ type: "setEdition", edition: "risograph" }, planFx],
  [{ type: "setFinish", finish: "holo" }, planFx],
  [{ type: "toggleKept", factId: "opener" }, planFx],
  [{ type: "setHidden", field: "subtitle", hidden: true }, planFx],
  [{ type: "setNote", note: "Row G, the encore." }, planFx],
  [{ type: "remixArt", vibe: "Neon", seed: 42 }, imageEditFx],
  [{ type: "remixArt", vibe: "Minimal", first: true }, generateFx],
  [{ type: "setFactValue", factId: "date", value: "2024-10-12" }, null],
  [{ type: "setMaterial", material: "framed" }, null],
  [{ type: "addPhotoArt" }, null],
  [{ type: "setFont", index: 7 }, null], // out of range: must not become a plan
  [{ type: "setNote", note: "x".repeat(141) }, null],
];
const table = [];
for (const [op, fixture] of opCases) {
  const { plan, unmapped } = adapter.toEditPlan(first, op, scope);
  const label = `plan:${op.type}`;
  if (fixture) {
    if (!plan) { fail(`${label}: expected a plan`); continue; }
    // changes[].value is typed unknown upstream; style_ref is an optional concept.generate parameter.
    sameShape(label, plan, fixture, { skip: ["$.steps[].parameters.changes[].value"], ext: ["$.steps[].parameters.style_ref"] });
    sameEnums(label, plan, fixture, ["contract", "schema_version", "environment", "billing_mode", "expected_result.contract", "expected_result.schema_version", "expected_result.artifact_kind"]);
    if (plan.operation !== fixture.operation) fail(`${label}: operation ${plan.operation} vs fixture ${fixture.operation}`);
    if (plan.steps[0].action !== plan.operation) fail(`${label}: step action differs from plan operation`);
    collectPending(label, plan);
  } else if (plan && ["setMaterial", "addPhotoArt"].includes(op.type)) fail(`${label}: must not map`);
  else if (plan && (op.index === 7 || op.note?.length > 140)) fail(`${label}: invalid value must not map`);
  table.push(`${op.type.padEnd(15)} -> ${(plan?.operation ?? "(none)").padEnd(18)} ${unmapped.map((u) => u.field).join(", ")}`);
  for (const u of unmapped) notes.push(`${label} does not map "${u.field}": ${u.reason}`);
}
const toggled = adapter.toEditPlan(first, { type: "toggleKept", factId: "opener" }, scope).plan.steps[0].parameters.changes[0];
if (toggled.field !== "kept_fact_ids" || !toggled.value.includes("opener") || !toggled.value.includes("run")) fail("toggleKept should carry the whole resulting kept list");

// 3. DesignVersion round trip
const dvFx = fx("design-version-base.json");
const dv = { ...dvFx, design_hash: "sha256:" + "0".repeat(64) };
const ours = adapter.fromDesignVersion(dv, { edition: "letterpress", vibe: "Neon" });
if (ours.id !== dvFx.design_version_id || ours.parentId !== undefined) fail("fromDesignVersion: id/parentId");
if (ours.art.provenance !== "simulated") fail("fromDesignVersion: simulated fixture must stay simulated");
if (!["procedural", "image"].includes(ours.art.kind) || typeof ours.art.seed !== "number") fail("fromDesignVersion: ArtLayer shape");
const child = adapter.fromDesignVersion({ ...dv, design_version_id: "design-v2", parent_version_id: "design-v1", billing_mode: "live", provider: "openai", model: "gpt-image-1" }, { resolveSrc: () => "https://example.test/a.jpg" });
if (child.parentId !== "design-v1" || child.art.provenance !== "live" || child.art.kind !== "image") fail("fromDesignVersion: live child");

// 4. DesignControlSchema + creative-controls inner schema
const { studioControlSchema, toDesignControlSchema, controlSchemaHash, canonicalJson, validateControl, studioControls } = controlsMod;
const ctlFx = fx("controls-producer-valid.json");
const refHash = await controlSchemaHash(ctlFx.schema);
if (refHash !== ctlFx.control_reference.control_schema_hash) fail(`controls: our canonical sha256 ${refHash} != fixture ${ctlFx.control_reference.control_schema_hash}`);
else notes.push("controls: control_schema_hash reproduced exactly from the fixture's inner schema (real hash, not a placeholder)");
const inner = studioControlSchema(scope, adapter.briefIdFor(first), { brief: "PENDING_brief_version", design: first.currentVersionId, composition: "PENDING_composition_version" }, first);
sameShape("controls.inner", inner, ctlFx.schema, { skip: ["$.controls"], ext: [] });
sameShape("controls.item", inner.controls[0], ctlFx.schema.controls[0], { ext: ["$.min", "$.max", "$.max_length"] });
for (const c of inner.controls) {
  if (!["select", "multi_select", "toggle", "text", "range"].includes(c.kind)) fail(`controls ${c.id}: kind`);
  if (!["composition.update", "artwork.edit"].includes(c.route)) fail(`controls ${c.id}: route not an upstream route`);
  if (c.kind !== "select") notes.push(`controls ${c.id}: kind "${c.kind}" does not exist upstream (only "select" does); needs a producer extension`);
  const fieldKnown = ["name_size", "layout", "logo_position", "style"].includes(c.field);
  if (!fieldKnown) notes.push(`controls ${c.id}: field "${c.field}" is not in upstream's fixed allowlist`);
}
const wrapper = toDesignControlSchema(inner, { event_id: "event-controls-1", correlation_id: scope.correlationId, producer: "ticketstub-studio", occurred_at: scope.now(), ingested_at: scope.now(), environment: "test", billing_mode: "simulated", source_refs: ["source:event-page"] }, await controlSchemaHash(inner));
const wrapperFx = fx("design-control-schema.json");
sameShape("controls.wrapper", wrapper, wrapperFx);
sameEnums("controls.wrapper", wrapper, wrapperFx, ["contract", "schema_version", "control_contract", "control_schema_version", "environment", "billing_mode"]);
collectPending("controls.wrapper", toDesignControlSchema(inner, wrapper));
// validateControl
const vc = studioControls(first);
const expectOk = (id, v, ok, code) => {
  const r = validateControl(vc, id, v);
  if (r.ok !== ok || (!ok && r.code !== code)) fail(`validateControl(${id}, ${JSON.stringify(v)}) -> ${JSON.stringify(r)}`);
};
expectOk("title_font", 3, true);
expectOk("title_font", 4, false, "invalid_value");
expectOk("title_font", "1", false, "invalid_value");
expectOk("title_colour", "#E4572E", true);
expectOk("title_colour", "#000000", false, "invalid_value");
expectOk("edition", "minimal", true);
expectOk("edition", "gothic", false, "invalid_value");
expectOk("finish", "holo", true);
expectOk("foil_title", "yes", false, "invalid_value");
expectOk("note", "x".repeat(140), true);
expectOk("note", "x".repeat(141), false, "invalid_value");
expectOk("art_seed", 2_147_483_647, true);
expectOk("art_seed", 2_147_483_648, false, "invalid_value");
expectOk("art_seed", -1, false, "invalid_value");
expectOk("hidden_facts", ["subtitle", "date"], true);
expectOk("hidden_facts", ["subtitle", "subtitle"], false, "invalid_value");
expectOk("hidden_facts", ["nope"], false, "invalid_value");
expectOk("logo_position", "top", false, "unknown_control");
if (validateControl([{ ...vc[0], locked: true }], "edition", "minimal").code !== "locked") fail("validateControl: locked");
if (canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) !== '{"a":[2,{"c":2,"d":1}],"b":1}') fail("canonicalJson");

// 5. API envelope
const required = ["contract", "schema_version", "event_id", "request_id", "tenant_id", "project_id", "correlation_id", "producer", "occurred_at", "ingested_at", "environment", "billing_mode", "source_refs", "operation", "payload"]; // docs/api/creative-api.md; action_id required for every op except list/compare/job.status
const needsAction = ["generate", "edit", "inspect", "restore", "cancel", "handoff", "brief.create", "brief.invalidate"];
const mapped = adapter.toArtEditRequest(first, { vibe: "Neon", seed: 7 }, scope, { actionId: "action-remix-1" });
const reqs = [
  mapped.request,
  adapter.toArtEditRequest(first, { vibe: "Minimal", first: true }, scope).request,
  adapter.toApiRequest("brief.create", adapter.toBriefCreatePayload(first), scope),
  adapter.toApiRequest("list", { brief_id: adapter.briefIdFor(first), limit: 20 }, scope),
  adapter.toApiRequest("job.status", { job_id: "job-1" }, scope),
];
for (const r of reqs) {
  const want = needsAction.includes(r.operation) ? [...required, "action_id"] : required;
  const extra = Object.keys(r).filter((k) => !want.includes(k) && k !== "action_id");
  const missing = want.filter((k) => !(k in r));
  if (missing.length || extra.length) fail(`envelope ${r.operation}: missing [${missing}] extra [${extra}]`);
  if (r.contract !== "CreativeApiRequest" || r.schema_version !== "1.0") fail(`envelope ${r.operation}: contract/version`);
  if (!["development", "test", "production"].includes(r.environment) || !["live", "sandbox", "simulated"].includes(r.billing_mode)) fail(`envelope ${r.operation}: enums`);
  if (needsAction.includes(r.operation) && !r.action_id) fail(`envelope ${r.operation}: action_id`);
}
if (reqs[0].operation !== "edit" || reqs[0].payload.design_version_id !== reqs[0].payload.plan.base.design_version_id) fail("envelope edit: payload.design_version_id must equal plan.base.design_version_id");
if (reqs[1].operation !== "generate" || Object.keys(reqs[1].payload).sort().join() !== "brief_id,plan") fail("envelope generate payload keys");
if (reqs[0].action_id !== "action-remix-1") fail("envelope: action_id passthrough");
if (Object.keys(reqs[2].payload).some((k) => ["facts", "permissions", "verified"].includes(k))) fail("brief.create payload must never carry facts or permissions");
const actor = adapter.toTrustedActor(scope);
if (actor.actor_id !== scope.actor.actorId || actor.tenant_id !== scope.tenantId) fail("trusted actor scope");
collectPending("actor", actor);
collectPending("envelope", reqs[0]);

console.log("op -> engine operation / fields that did not travel");
for (const row of table) console.log("  " + row);
console.log(`\nPENDING_ placeholders (${pendingFields.length}):`);
for (const p of [...new Set(pendingFields.map((s) => s.replace(/\[\d+\]/g, "[]")))]) console.log("  " + p);
console.log(`\nNotes (${notes.length}):`);
for (const n of [...new Set(notes)]) console.log("  " + n);
if (failures.length) {
  console.error(`\nFAIL (${failures.length})`);
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nOK: adapter output matches the creative-engine fixtures structurally.");
