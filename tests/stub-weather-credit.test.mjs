import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// The stub, server-rendered for every edition: live Open-Meteo weather carries its CC BY credit wherever it shows (#48).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".module.css")) return { url: "data:text/javascript,export default new Proxy({},{get:(_,k)=>String(k)})", shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL) {
      for (const ext of [".ts", ".tsx"]) {
        const url = new URL(`${specifier}${ext}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts") || url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        fileName: fileURLToPath(url),
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { StubView } = await import("../src/customer/studio/stub/StubView.tsx");
const { newStub } = await import("../src/customer/studio/fixtures.ts");
const { EDITIONS } = await import("../src/customer/studio/types.ts");

const CREDIT = "Weather data by Open-Meteo.com";
const weather = (over = {}) => ({ id: "weather", label: "17°C · rain", value: "17.4°C max, 4 mm rain in Berlin", source: "Open-Meteo.com · place: GeoNames", sourceUrl: "https://open-meteo.com/", confidence: 0.9, provenance: "live", kept: true, ...over });
// A concert with a setlist: its back shows the setlist, not the facts, so only the front can carry weather.
const event = (facts, extra = {}) => ({ type: "concert", setlist: [{ title: "Opener" }], title: "Gig", dateISO: "2026-10-08", city: "Berlin", venue: "Hall", facts, ...extra });
const render = (ev, edition, flipped = false) => {
  const stub = newStub(ev, "credit");
  stub.versions[0].edition = edition;
  return renderToStaticMarkup(createElement(StubView, { stub, flipped }));
};
const count = (html) => html.split(CREDIT).length - 1;

test("every edition prints the credit right after the kept live weather on the front", () => {
  for (const edition of EDITIONS) {
    const html = render(event([weather()]), edition);
    assert.equal(count(html), 1, edition);
    assert.ok(html.indexOf("17°C · rain".toUpperCase()) >= 0 || html.indexOf("17°C · rain") >= 0, edition);
    assert.ok(html.indexOf(CREDIT) > Math.max(html.indexOf("17°C · rain"), html.indexOf("17°C · RAIN")), `${edition}: credit sits under the weather`);
  }
});

test("an unsure live weather chip also carries the credit", () => {
  assert.equal(count(render(event([weather({ confidence: 0.75, kept: false })]), "researched")), 1);
});

test("no credit without Open-Meteo weather on the stub: simulated, pending, hidden, or not kept", () => {
  for (const ev of [
    event([weather({ provenance: "simulated", source: "Open-Meteo" })]),
    event([weather({ provenance: "pending", label: "Weather: pending", confidence: 0.2, kept: false })]),
    event([weather({ kept: false })]),
    event([{ id: "venue", label: "Hall", value: "Hall", source: "event page", confidence: 0.9, provenance: "live", kept: true }]),
  ]) assert.equal(count(render(ev, "researched")), 0, JSON.stringify(ev.facts));
  const hidden = newStub(event([weather()]), "hidden");
  hidden.personal.hiddenFields = ["weather"];
  assert.equal(count(renderToStaticMarkup(createElement(StubView, { stub: hidden }))), 0);
});

test("the back's fact list credits the weather it lists, and not a programme", () => {
  const generic = { type: "generic", setlist: undefined };
  assert.equal(count(render(event([weather({ kept: false })], generic), "researched", true)), 1); // listed on the back only
  assert.equal(count(render(event([weather()], generic), "researched", true)), 2); // and on the front once kept
  assert.equal(count(render(event([weather({ kept: false })], { ...generic, programme: ["Doors", "Encore"] }), "researched", true)), 0);
});
