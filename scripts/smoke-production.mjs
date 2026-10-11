import assert from "node:assert/strict";

const base = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const routes = ["/", "/search", "/new?demo=neathack", "/studio/smoke", "/wall", "/cart", "/organizer", "/brand/favicon.svg"];
for (const route of routes) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, route);
  const text = await response.text();
  if (route === "/") {
    assert.match(text, /TicketStub/);
    assert.match(text, /Demo preview/);
    const assets = [...text.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)];
    assert.ok(assets.length > 0, "home page must reference built assets");
    for (const [, asset] of assets) {
      const result = await fetch(new URL(asset.replaceAll("&amp;", "&"), base));
      assert.equal(result.status, 200, asset);
    }
  }
  console.log(`PASS ${route}`);
}
const post = (route, body) => fetch(new URL(route, base), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15000),
});
const demo = await post("/api/research", { url: "https://example.invalid/neathack" });
assert.equal(demo.status, 200);
const event = await demo.json();
assert.ok(event.facts.length > 0);
assert.ok(event.facts.every((fact) => fact.provenance !== "live"));
const blocked = await post("/api/research", { url: "http://127.0.0.1:1/private" });
assert.equal(blocked.status, 422, "preview must not fetch arbitrary URLs");
const art = await post("/api/art", { event });
assert.equal(art.status, 200);
assert.equal((await art.json()).provenance, "simulated");
const agent = await post("/api/agent", { event, message: "Tell me about it" });
assert.equal(agent.status, 204);
const missing = await fetch(new URL("/missing-deployment-smoke-route", base));
assert.equal(missing.status, 404);
console.log("PASS demo APIs, blocked external research, simulated art/agent, and 404");
