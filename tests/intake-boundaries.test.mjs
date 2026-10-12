import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

// Offline negative tests for the URL-first intake boundary: nothing here may reach the network.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = fileURLToPath(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url));
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const scratch = mkdtempSync(join(tmpdir(), "ticketstub-intake-"));
process.env.TICKETSTUB_DB = join(scratch, "intake.sqlite");
process.env.TICKETSTUB_FILES = join(scratch, "files");
const intake = await import("../src/server/intake-url.ts");
const research = await import("../src/app/api/research/route.ts");

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let fetched = [];
const PUBLIC = "93.184.216.34";
afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; intake.setHostResolver(); fetched = []; });
function offline(resolve = async () => [PUBLIC], handler) {
  fetched = [];
  process.env.TICKETSTUB_RUNTIME_MODE = "live";
  intake.setHostResolver(resolve);
  globalThis.fetch = async (url, init) => { fetched.push(String(url)); return handler ? handler(String(url), init) : assert.fail(`unexpected fetch ${url}`); };
}
const post = (body, raw) => research.POST(new Request("http://localhost/api/research", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }));
const codeOf = async (res) => (await res.json()).error?.code;

test("parseIntakeUrl rejects schemes, credentials, ports, controls and length", () => {
  const reason = (s) => { const r = intake.parseIntakeUrl(s); return r.ok ? "ok" : r.reason; };
  for (const s of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "ftp://example.com/x", "mailto:a@example.com", "blob:https://example.com/x", "//example.com/x"]) assert.equal(reason(s), "unsupported_scheme", s);
  for (const s of ["https://user:pw@example.com/", "https://user@example.com/", "http://:pw@example.com/"]) assert.equal(reason(s), "url_credentials", s);
  for (const s of ["https://example.com:8443/", "http://example.com:22/"]) assert.equal(reason(s), "unsupported_port", s);
  for (const s of ["https://exa mple.com/", "https://example.com/\u0000", "https://example.com\\@evil.com/", "https://"]) assert.equal(reason(s), "url_malformed", s);
  assert.equal(reason(`https://example.com/${"a".repeat(2048)}`), "url_too_long");
  assert.equal(reason("example.com/e/1"), "ok");
  assert.equal(reason("https://example.com:443/e"), "ok");
  assert.equal(reason(`https://example.com/${"a".repeat(2000)}`), "ok"); // boundary: under the cap
});

test("private, loopback, link-local, reserved and local-name hosts are blocked without DNS", () => {
  const hosts = [
    "localhost", "LOCALHOST.", "foo.localhost", "printer.local", "db.internal", "intranet", "127.0.0.1", "127.1", "2130706433", "0x7f.0.0.1", "0177.0.0.1", "0.0.0.0",
    "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "192.0.2.1", "224.0.0.1", "255.255.255.255",
    "[::1]", "[::]", "[fe80::1]", "[fc00::1]", "[fd12:3456::1]", "[ff02::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "[::ffff:10.0.0.1]", "[64:ff9b::a00:1]", "[2001:db8::1]", "[2002:7f00:1::]",
  ];
  for (const h of hosts) {
    const r = intake.parseIntakeUrl(`http://${h}/x`);
    assert.equal(r.ok, false, h);
    assert.equal(r.reason, "blocked_destination", h);
  }
  for (const h of ["93.184.216.34", "172.32.0.1", "[2606:2800:220:1:248:1893:25c8:1946]", "example.com"]) assert.equal(intake.parseIntakeUrl(`https://${h}/x`).ok, true, h);
});

test("route refuses unsupported schemes and credentials before any lookup or fetch", async () => {
  offline(async () => assert.fail("resolved a rejected link"));
  for (const [url, code] of [["javascript:alert(1)", "unsupported_url"], ["https://u:p@example.com/", "unsupported_url"], ["http://169.254.169.254/latest/meta-data", "unsupported_url"], ["http://localhost/admin", "unsupported_url"], ["http://example.com:6379/", "unsupported_url"], [`https://example.com/${"a".repeat(3000)}`, "too_large"]]) {
    const res = await post({ url });
    assert.equal(res.status, 422, url.slice(0, 40));
    const body = await res.json();
    assert.equal(body.error.code, code);
    assert.ok(!JSON.stringify(body).includes("169.254"), "the input is not echoed");
  }
  assert.deepEqual(fetched, []);
});

test("unsupported inputs are refused explicitly, never accepted and ignored", async () => {
  offline();
  for (const field of ["file", "image", "screenshot", "upload", "urls", "sources", "email", "csv"]) {
    const res = await post({ url: "https://example.com/e", [field]: field === "urls" ? ["https://a.example.com"] : "x" });
    assert.equal(res.status, 422, field);
    assert.equal(await codeOf(res), "unsupported_input", field);
  }
  assert.deepEqual(fetched, []);
});

test("malformed, oversize and wrongly typed bodies are rejected before dispatch", async () => {
  offline();
  assert.equal((await post(null, "null")).status, 400);
  assert.equal((await post(null, "[1]")).status, 400);
  assert.equal((await post(null, "{not json")).status, 400);
  assert.equal((await post({ url: ["https://example.com"] })).status, 400);
  assert.equal((await post({ url: 42 })).status, 400);
  assert.equal((await post({ query: { $ne: 1 } })).status, 400);
  const big = await post({ url: "https://example.com/e", pad: "x".repeat(9000) });
  assert.equal(big.status, 413);
  assert.equal((await post({ query: "q".repeat(201) })).status, 422);
  assert.equal((await post({ query: "q".repeat(200) })).status, 200); // boundary
  assert.deepEqual(fetched, []);
});

test("a hostname that resolves to a private address is refused before fetch", async () => {
  for (const addr of ["127.0.0.1", "10.1.2.3", "::1", "::ffff:192.168.0.1", "169.254.169.254"]) {
    offline(async () => [PUBLIC, addr]); // one bad answer among good ones is enough
    const res = await post({ url: "https://rebind.example.com/e" });
    assert.equal(res.status, 422, addr);
    assert.equal(await codeOf(res), "unsupported_url");
    assert.deepEqual(fetched, [], addr);
  }
  offline(async () => []);
  assert.deepEqual(fetched, []);
  assert.notEqual((await post({ url: "https://nxdomain.example.com/e" })).status, 200);
  assert.deepEqual(fetched, []);
});

test("redirects to private or non-http destinations are refused and never requested", async () => {
  for (const target of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8080/", "http://10.0.0.1/", "ftp://example.com/x", "https://user:pw@example.com/x", "http://localhost/"]) {
    offline(undefined, (url) => url === "https://example.com/start" ? new Response(null, { status: 302, headers: { location: target } }) : assert.fail(`followed redirect to ${url}`));
    const res = await post({ url: "https://example.com/start" });
    assert.equal(res.status, 422, target);
    assert.equal(await codeOf(res), "unsupported_url", target);
    assert.deepEqual(fetched, ["https://example.com/start"], target);
  }
});

test("a redirect to a hostname that resolves privately is refused", async () => {
  offline(async (host) => host === "inner.example.net" ? ["10.9.9.9"] : [PUBLIC], () => new Response(null, { status: 301, headers: { location: "https://inner.example.net/x" } }));
  const res = await post({ url: "https://example.com/start" });
  assert.equal(res.status, 422);
  assert.deepEqual(fetched, ["https://example.com/start"]);
});

test("redirect chains are capped, and a public redirect is still followed", async () => {
  offline(undefined, (url) => new Response(null, { status: 302, headers: { location: `${url}x` } }));
  await assert.rejects(intake.fetchPublic("https://example.com/a"), (e) => e.reason === "too_many_redirects");
  assert.equal(fetched.length, intake.INTAKE_LIMITS.redirects + 1);

  fetched = [];
  offline(undefined, (url) => url.endsWith("/a") ? new Response(null, { status: 302, headers: { location: "/b" } }) : new Response("<title>ok</title>"));
  const res = await intake.fetchPublic("https://example.com/a");
  assert.equal(await res.text(), "<title>ok</title>");
  assert.deepEqual(fetched, ["https://example.com/a", "https://example.com/b"]);
});

test("readCapped stops at the byte cap", async () => {
  const stream = new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode("a".repeat(1000))); } });
  const text = await intake.readCapped(new Response(stream), 2500);
  assert.equal(text.length, 2500);
});

test("demo keywords still work and make no outbound request", async () => {
  offline();
  const res = await post({ url: "neathack" });
  assert.equal(res.status, 200);
  assert.deepEqual(fetched, []);
});
