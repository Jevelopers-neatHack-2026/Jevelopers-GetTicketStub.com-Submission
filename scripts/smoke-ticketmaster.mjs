// Smoke test for the Ticketmaster Discovery mapper, run on a saved sample response (no network, no key).
//   node scripts/smoke-ticketmaster.mjs        (Node 22.18+/24/25 strip TypeScript types natively)
// The sample is written from the documented Discovery v2 schema; see scripts/fixtures/.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const tm = await load("src/customer/studio/research/ticketmaster.ts");
const pkgMod = await load("src/customer/studio/research/ticketmasterPackage.ts");
const rawText = readFileSync(path.join(root, "scripts/fixtures/ticketmaster-discovery-event.json"), "utf8");
const sample = JSON.parse(rawText);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`ok  ${name}`);
};
const okAsync = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok  ${name}`);
};

// ---- URL parsing ----
ok("parse: ticketmaster.com /<slug>/event/<id>", () => {
  const p = tm.parseTicketmasterUrl("https://www.ticketmaster.com/harbour-lights-tour-boston-massachusetts-10-24-2026/event/0E006FIXTURE0001");
  assert.equal(p.id, "0E006FIXTURE0001");
  assert.equal(p.date, "2026-10-24");
});
ok("parse: other TLDs (.co.uk .ca .ie .com.au)", () => {
  for (const h of ["ticketmaster.co.uk", "www.ticketmaster.ca", "ticketmaster.ie", "www.ticketmaster.com.au"]) {
    assert.equal(tm.parseTicketmasterUrl(`https://${h}/some-band-tickets/event/vvG1ZZ0Sample1Aa`).id, "vvG1ZZ0Sample1Aa", h);
  }
});
ok("parse: livenation /event/<id>/<slug> and /event/<slug>-<id>", () => {
  assert.equal(tm.parseTicketmasterUrl("https://www.livenation.com/event/vvG1ZZ0Sample1Aa/some-band-tickets").id, "vvG1ZZ0Sample1Aa");
  assert.equal(tm.parseTicketmasterUrl("https://www.livenation.com/event/some-band-tickets-vvG1ZZ0Sample1Aa").id, "vvG1ZZ0Sample1Aa");
});
ok("parse: slug-only gives keyword and date, no id", () => {
  const p = tm.parseTicketmasterUrl("https://www.ticketmaster.com/the-pale-hours-tickets-2026-10-24/artist");
  assert.equal(p.id, undefined);
  assert.equal(p.keyword, "the pale hours");
  assert.equal(p.date, "2026-10-24");
});
ok("parse: non-Ticketmaster hosts are ignored", () => {
  assert.equal(tm.parseTicketmasterUrl("https://example.com/event/vvG1ZZ0Sample1Aa"), undefined);
  assert.equal(tm.parseTicketmasterUrl("https://nottticketmaster.com/event/vvG1ZZ0Sample1Aa"), undefined);
});

// ---- Mapper ----
const mapped = tm.mapDiscoveryEvent(sample, { sourceUrl: "https://example.test/x" });
const byId = (id) => mapped.event.facts.find((f) => f.id === id);
ok("event: title, venue, city, date, type", () => {
  const e = mapped.event;
  assert.equal(e.type, "concert");
  assert.equal(e.title, "The Pale Hours");
  assert.equal(e.subtitle, "Harbour Lights Tour");
  assert.equal(e.venue, "Harbour Hall");
  assert.equal(e.city, "Boston");
  assert.equal(e.dateISO, "2026-10-24");
  assert.equal(e.seat, undefined, "seat is never known from Discovery");
  assert.equal(e.sourceUrl, sample.url);
});
ok("facts: live, source Ticketmaster, sourceUrl = event url, confidence set", () => {
  for (const f of mapped.event.facts) {
    assert.equal(f.provenance, "live", f.id);
    assert.equal(f.source, "Ticketmaster");
    assert.equal(f.sourceUrl, sample.url);
    assert.ok(f.confidence > 0 && f.confidence <= 1);
  }
  assert.deepEqual(mapped.event.facts.map((f) => f.id), ["date", "time", "venue", "lineup", "genre", "price"]);
  assert.equal(byId("time").value, "19:30 (America/New_York)");
  assert.equal(byId("lineup").label, "Northgate Choir · Kelvin Park");
  assert.equal(byId("price").label, "$45.50–$180");
});
ok("segment mapping", () => {
  assert.equal(tm.typeFromSegment("Music"), "concert");
  assert.equal(tm.typeFromSegment("Sports"), "game");
  assert.equal(tm.typeFromSegment("Arts & Theatre"), "show");
  assert.equal(tm.typeFromSegment("Miscellaneous"), "generic");
});
ok("image: widest non-fallback 16:9, https, attribution kept", () => {
  const img = mapped.fields.image;
  assert.equal(img.width, 2048);
  assert.ok(img.url.startsWith("https://"));
  assert.equal(img.attribution, "Photo: Sample Photographer");
  assert.equal(img.fallback, false);
});
ok("missing data becomes pending, never invented", () => {
  const sparse = tm.mapDiscoveryEvent({ name: "Mystery Night", dates: { start: { dateTBD: true, timeTBA: true } } }, { sourceUrl: "https://www.ticketmaster.com/event/abc123def456" });
  const f = sparse.event.facts;
  for (const id of ["date", "time", "venue"]) {
    const x = f.find((k) => k.id === id);
    assert.equal(x.provenance, "pending");
    assert.equal(x.value, "Not known yet");
  }
  assert.equal(f.find((k) => k.id === "price"), undefined, "price only when present");
  assert.equal(sparse.event.dateISO, undefined);
  assert.equal(sparse.event.type, "generic");
});

// ---- Package (EventIntelligencePackage 1.1) ----
const lookup = {
  status: "ok",
  eventId: sample.id,
  event: mapped.event,
  fields: mapped.fields,
  image: mapped.fields.image,
  retrievedAt: "2026-10-10T12:00:00.000Z",
  rawText,
  matchedBy: "id",
  sourceUrl: sample.url,
};
const pkg = pkgMod.buildEventIntelligencePackage(lookup, { environment: "test" });
ok("package: envelope + invariants of schema 1.1", () => {
  assert.equal(pkg.contract, "EventIntelligencePackage");
  assert.equal(pkg.schema_version, "1.1");
  for (const k of ["event_id", "tenant_id", "project_id", "correlation_id", "producer", "package_id"]) assert.ok(pkg[k], k);
  assert.ok(Number.isFinite(Date.parse(pkg.occurred_at)) && Number.isFinite(Date.parse(pkg.ingested_at)));
  assert.match(pkg.source_identity[0].content_hash, /^sha256:[a-f0-9]{64}$/);
  const sources = new Set(pkg.source_identity.map((s) => s.source_id));
  const ids = new Set();
  for (const f of pkg.facts) {
    assert.ok(!ids.has(f.fact_id), "unique fact_id");
    ids.add(f.fact_id);
    if (f.status === "verified") {
      assert.ok("value" in f && f.provenance.length > 0, f.key);
    } else {
      assert.ok(!("value" in f), "unknown facts carry no value");
    }
    for (const p of f.provenance) assert.ok(sources.has(p.source_id));
  }
  for (const s of ["assets", "preferences", "interpretations", "permissions", "locks"]) {
    assert.ok(pkg[s].presence === "present" || pkg[s].items.length === 0, s);
  }
  assert.equal(pkg.permissions.presence, "unknown", "discovery data grants no reproduction permission");
});
ok("package: facts, placeholders, asset candidate", () => {
  const get = (k) => pkg.facts.find((f) => f.key === k);
  assert.equal(get("event_name").value, "Harbour Lights Tour");
  assert.equal(get("event_date").value, "2026-10-24");
  assert.equal(get("venue").value, "Harbour Hall");
  assert.deepEqual(get("supporting_acts").value, ["Northgate Choir", "Kelvin Park"]);
  assert.equal(get("price_range").value.currency, "USD");
  assert.equal(get("event_date").provenance[0].evidence_ref, `source:ticketmaster-event-${sample.id}#/dates/start/localDate`);
  assert.deepEqual(pkg.ticketstub_placeholders, ["tenant_id", "project_id", "correlation_id"]);
  assert.equal(pkg.ticketstub_asset_candidates[0].width, 2048);
  assert.equal(pkg.assets.items.length, 0);
  assert.ok(!JSON.stringify(pkg).includes("apikey"));
});
ok("package: TBD date is an unknown fact with no value", () => {
  const sparse = tm.mapDiscoveryEvent({ id: "x1y2z3w4v5", name: "Mystery Night", dates: { start: { dateTBD: true } } }, { sourceUrl: "https://t.test" });
  const p = pkgMod.buildEventIntelligencePackage({ ...lookup, fields: sparse.fields, event: sparse.event, image: undefined, eventId: "x1y2z3w4v5" }, { environment: "test" });
  const d = p.facts.find((f) => f.key === "event_date");
  assert.equal(d.status, "unknown");
  assert.equal("value" in d, false);
  assert.equal(p.assets.presence, "absent");
});

// ---- Lookup with a stubbed fetch (never touches the network) ----
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const link = tm.parseTicketmasterUrl("https://www.ticketmaster.com/harbour-lights-tour-tickets/event/vvG1ZZ0Sample1Aa");
await okAsync("lookup: no key is skipped, makes no request", async () => {
  let calls = 0;
  const r = await tm.lookupTicketmaster(link, { apiKey: "", fetchImpl: async () => (calls++, json(200, {})) });
  assert.equal(r.status, "skipped");
  assert.equal(r.reason, "no-api-key");
  assert.equal(calls, 0);
});
await okAsync("lookup: success via events/{id}.json with apikey", async () => {
  const urls = [];
  const r = await tm.lookupTicketmaster(link, { apiKey: "KEY", fetchImpl: async (u) => (urls.push(String(u)), json(200, sample)) });
  assert.equal(r.status, "ok");
  assert.ok(urls[0].startsWith("https://app.ticketmaster.com/discovery/v2/events/vvG1ZZ0Sample1Aa.json?"));
  assert.ok(urls[0].includes("apikey=KEY"));
  assert.ok(!r.sourceUrl.includes("KEY") && !r.event.sourceUrl.includes("KEY"));
});
await okAsync("lookup: legacy id falls back to the id filter", async () => {
  const urls = [];
  const r = await tm.lookupTicketmaster(link, {
    apiKey: "KEY",
    fetchImpl: async (u) => (urls.push(String(u)), urls.length === 1 ? json(404, {}) : json(200, { _embedded: { events: [sample] } })),
  });
  assert.equal(r.status, "ok");
  assert.ok(urls[1].includes("events.json") && urls[1].includes("id=vvG1ZZ0Sample1Aa"));
});
await okAsync("lookup: slug-only uses keyword + date, lowers confidence", async () => {
  const urls = [];
  const slugLink = tm.parseTicketmasterUrl("https://www.ticketmaster.com/harbour-lights-tour-tickets-2026-10-24/artist");
  const r = await tm.lookupTicketmaster(slugLink, { apiKey: "KEY", fetchImpl: async (u) => (urls.push(String(u)), json(200, { _embedded: { events: [sample] } })) });
  assert.equal(r.status, "ok");
  assert.equal(r.matchedBy, "keyword");
  assert.ok(urls[0].includes("keyword=harbour+lights+tour") && urls[0].includes("localStartDateTime"));
  assert.ok(r.event.facts.every((f) => f.confidence <= 0.7));
});
await okAsync("lookup: 429, 401, 500, timeout and junk all degrade without throwing", async () => {
  const cases = [
    [async () => json(429, {}), "rate-limited"],
    [async () => json(401, {}), "bad-api-key"],
    [async () => json(500, {}), "api-error"],
    [async () => new Response("not json", { status: 200 }), "bad-response"],
    [async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "timeout"],
    [async () => { throw new Error("socket"); }, "api-error"],
  ];
  for (const [fetchImpl, reason] of cases) {
    const r = await tm.lookupTicketmaster(link, { apiKey: "KEY", fetchImpl });
    assert.equal(r.status, "error", reason);
    assert.equal(r.reason, reason);
    assert.ok(r.message.length > 0);
  }
});
await okAsync("lookup: oversized response is refused", async () => {
  const big = new Response("x".repeat(1_600_000), { status: 200 });
  const r = await tm.lookupTicketmaster(link, { apiKey: "KEY", fetchImpl: async () => big });
  assert.equal(r.status, "error");
});

console.log(`\n${n} checks passed`);
