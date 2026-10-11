// One entry point for the product checks, with evidence.
//   npm run verify:product -- --suite <foundation|access|research|creative|review|capabilities|messages|a11y|production|degraded> --mode fixture --evidence-dir <dir>
// (`accessibility` is an alias of `a11y`: GT-11 names the suite that way.)
// Every suite runs offline: in fixture mode a preload (scripts/lib/fixture-network-guard.mjs) refuses any host but
// loopback, and the server started here has no provider keys. A missing build or fixture, an unknown suite and
// any skipped check exit nonzero. Each run writes <evidence-dir>/<suite>-<timestamp>.json.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(root, "scripts/lib/fixture-network-guard.mjs");
/** smoke-server checks that need `next dev`; production answers them differently on purpose. */
// smoke-server now checks the email preview against the server it talks to, so nothing is excused
const DEV_ONLY_CHECKS = [];
const STAFF_EMAIL = "verify-staff@example.com";
const MEMBER_EMAIL = "verify-member@example.com";

// ---- arguments ----
const SUITES = {
  foundation: { server: true, needs: [".next/BUILD_ID"], run: foundation },
  access: { server: true, needs: [".next/BUILD_ID", "scripts/smoke-server.mjs"], run: (ctx) => script("scripts/smoke-server.mjs", [ctx.base], { SMOKE_ADMIN_EMAIL: STAFF_EMAIL }) },
  research: { server: false, needs: ["scripts/smoke-ticketmaster.mjs", "scripts/fixtures/ticketmaster-discovery-event.json"], run: () => script("scripts/smoke-ticketmaster.mjs") },
  creative: { server: false, needs: ["scripts/check-creative-adapter.mjs", "src/customer/studio/creative/fixtures"], run: () => script("scripts/check-creative-adapter.mjs") },
  review: { server: false, needs: ["scripts/check-review-versions.mjs", "src/customer/studio/facts/corrections.ts"], run: () => script("scripts/check-review-versions.mjs") },
  capabilities: { server: false, needs: ["scripts/check-capabilities.mjs", "src/customer/pages/capabilities.ts"], run: () => script("scripts/check-capabilities.mjs") },
  messages: { server: false, needs: ["scripts/check-messages.mjs", "src/customer/feedback-messages/messages.ts"], run: () => script("scripts/check-messages.mjs") },
  // GT-11: axe-core, overflow, keyboard, dialog focus and reduced motion in a real headless Chrome (needs Chrome or Edge, or CHROME_PATH).
  a11y: { server: true, needs: [".next/BUILD_ID", "scripts/check-a11y.mjs", "scripts/lib/cdp.mjs", "scripts/lib/contrast.mjs", "node_modules/axe-core/axe.min.js"], run: (ctx) => script("scripts/check-a11y.mjs", [ctx.base, evidenceDir]) },
  production: { server: true, needs: [".next/BUILD_ID", "scripts/smoke-production.mjs"], run: (ctx) => script("scripts/smoke-production.mjs", [], { SMOKE_BASE_URL: ctx.base }) },
  // Storage that cannot be written: the server starts with TICKETSTUB_DB under a file, so every OS refuses it.
  degraded: { server: true, unwritableStorage: true, needs: [".next/BUILD_ID", "scripts/smoke-production.mjs"], run: degraded },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(`unexpected argument "${a}"`);
    const [k, inline] = a.slice(2).split("=");
    out[k] = inline ?? argv[++i];
  }
  return out;
}

function fail(msg) {
  console.error(`verify:product: ${msg}`);
  console.error(`usage: npm run verify:product -- --suite <${Object.keys(SUITES).join("|")}> --mode fixture --evidence-dir <dir>`);
  process.exit(2);
}

const args = parseArgs(process.argv.slice(2));
if (!args.suite) fail("--suite is required");
if (args.suite === "accessibility") args.suite = "a11y";
const suite = Object.hasOwn(SUITES, args.suite) ? SUITES[args.suite] : null;
if (!suite) fail(`unknown suite "${args.suite}"`);
if (args.mode !== "fixture") fail(`unsupported --mode "${args.mode ?? ""}": only "fixture" runs without live services`);
if (!args["evidence-dir"]) fail("--evidence-dir is required");
const evidenceDir = resolve(args["evidence-dir"]);

// ---- bookkeeping ----
const steps = [];
const startedAt = new Date();
const tmp = mkdtempSync(join(tmpdir(), "ticketstub-verify-"));
const netLog = join(tmp, "blocked-network.log");
writeFileSync(netLog, "");
const guardUrl = pathToFileURL(guard).href;

function record(name, ok, detail = "") {
  steps.push({ name, ok, ...(ok ? {} : { detail }) });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
  return ok;
}

const git = (...a) => {
  try {
    return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const gitSha = git("rev-parse", "HEAD");
const gitDirty = git("status", "--porcelain") === null ? null : git("status", "--porcelain") !== "";

/** The child environment: no provider keys, no mail key, a throwaway database. */
function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "TICKETMASTER_API_KEY", "RESEND_API_KEY", "TICKETSTUB_RUNTIME_MODE", "APP_URL"]) delete env[k];
  return {
    ...env,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${guardUrl}`.trim(),
    VERIFY_NET_LOG: netLog,
    TICKETSTUB_DB: join(tmp, "verify.sqlite"),
    TICKETSTUB_FILES: join(tmp, "files"),
    TICKETSTUB_SANDBOX_MAIL: "1",
    ADMIN_EMAILS: STAFF_EMAIL,
    ...extra,
  };
}

function runNode(nodeArgs, env) {
  return new Promise((done) => {
    const child = spawn(process.execPath, nodeArgs, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code: code ?? 1, out }));
  });
}

/** Runs one of the repo's own check scripts and folds its ok/FAIL/SKIP lines into the evidence. */
async function script(file, fileArgs = [], envExtra = {}) {
  const { code, out } = await runNode([join(root, file), ...fileArgs], childEnv(envExtra));
  process.stdout.write(out);
  const lines = out.split(/\r?\n/);
  const passed = lines.filter((l) => /^(ok|PASS)\b/.test(l)).length;
  const skipped = lines.filter((l) => !/^(ok|PASS)\b/.test(l) && /\bskip(ped)?\b/i.test(l)).length;
  // Checks that only hold in `next dev`, named exactly; they fail by design against the production server used here.
  const failLines = lines.filter((l) => /^FAIL\b/.test(l));
  const expected = failLines.filter((l) => DEV_ONLY_CHECKS.some((name) => l.startsWith(`FAIL ${name}`)));
  const failed = failLines.length - expected.length;
  const ok = (code === 0 || (failLines.length > 0 && failed === 0)) && skipped === 0;
  steps.push({ name: file, command: `node ${file} ${fileArgs.join(" ")}`.trim(), exitCode: code, passed, failed, skipped, ...(expected.length ? { expectedFailures: expected } : {}), ok });
  if (skipped) console.error(`FAIL ${file}: ${skipped} required check(s) skipped`);
  if (!ok && code === 0) console.error(`FAIL ${file}: exit 0 but ${failed} failed line(s)`);
  if (expected.length) console.log(`note ${expected.length} dev-only check(s) failed by design against the production server: ${expected.join("; ")}`);
}

function freePort() {
  return new Promise((ok, no) => {
    const s = createServer();
    s.once("error", no);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function startServer(extraEnv = {}) {
  const port = await freePort();
  const env = childEnv({ PORT: String(port), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", ...extraEnv });
  const next = join(root, "node_modules/next/dist/bin/next");
  const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${log}`);
    try {
      if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) return { base, child, log: () => log };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`server did not answer /api/health within 30s:\n${log}`);
}

// ---- foundation ----
/** Every page.tsx under src/app, as a URL with sample values for dynamic segments. */
function declaredPages() {
  const appDir = join(root, "src/app");
  const pages = [];
  const seg = (s) => (/^\[\[\.\.\..+\]\]$/.test(s) ? "" : /^\[\.\.\..+\]$/.test(s) ? "verify/sample" : /^\[.+\]$/.test(s) ? "verify-sample" : s);
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (e.name === "page.tsx") {
        const segs = relative(appDir, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("_"));
        pages.push("/" + segs.map(seg).filter(Boolean).join("/"));
      }
    }
  })(appDir);
  return pages.sort();
}

/** A fetch client with a cookie jar and its own client address; redirects are never followed. */
function client(base) {
  const jar = new Map();
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const send = async (method, path, body) => {
    const headers = { "x-real-ip": ip, origin: base };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(20000) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [k, v] = pair.split("=");
      if (v === "" || /max-age=0/i.test(c)) jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    return { status: res.status, headers: res.headers, text: await res.text() };
  };
  const signIn = async (email) => {
    const link = await send("POST", "/api/auth/link", { email, returnTo: "/wall", reason: "save" });
    const devLink = JSON.parse(link.text).devLink;
    if (!devLink) throw new Error(`no devLink for ${email} (${link.status})`);
    const token = new URL(devLink).searchParams.get("token");
    return send("POST", "/api/auth/confirm", { token });
  };
  return { get: (p) => send("GET", p), send, signIn };
}

async function foundation({ base }) {
  const anon = client(base);

  // every declared page answers (admin is reserved: a real 404 for anyone who is not staff)
  const pages = declaredPages();
  record("declared pages found", pages.length > 20, `only ${pages.length}`);
  for (const url of pages) {
    const res = await anon.get(url);
    const want = url.startsWith("/admin") ? 404 : url === "/map" ? 308 : 200;
    const ok = res.status === want && (url !== "/map" || (res.headers.get("location") ?? "").endsWith("/help"));
    record(`page ${url} -> ${want}`, ok, `got ${res.status}`);
  }

  // invalid routes
  const missing = await anon.get("/definitely-not-a-route");
  record("unknown page is a 404 with the desk copy", missing.status === 404 && /isn(&#x27;|')t on the desk/.test(missing.text), `got ${missing.status}`);
  const missingApi = await anon.get("/api/definitely-not-a-route");
  record("unknown API route is a 404", missingApi.status === 404, `got ${missingApi.status}`);

  // health
  const health = await anon.get("/api/health");
  let body = {};
  try {
    body = JSON.parse(health.text);
  } catch {
    /* asserted below */
  }
  record("health is 200 with ok, version, mode and time", health.status === 200 && body.ok === true && typeof body.version === "string" && body.mode === "demo" && !Number.isNaN(Date.parse(body.time)), health.text.slice(0, 120));
  record("health is uncached and carries nothing else", health.headers.get("cache-control") === "no-store" && Object.keys(body).sort().join() === "mode,ok,persistence,storage,time,version" && body.storage === "ok" && body.persistence === "configured", Object.keys(body).join());

  // admin: anonymous and non-staff never learn it exists; staff get reload and deep links
  const member = client(base);
  const staff = client(base);
  await member.signIn(MEMBER_EMAIL);
  await staff.signIn(STAFF_EMAIL);
  for (const path of ["/admin", "/admin/x/y"]) {
    record(`anonymous ${path} is a real 404`, (await anon.get(path)).status === 404);
    const m = await member.get(path);
    record(`non-staff ${path} is a real 404 with no admin markup`, m.status === 404 && !m.text.includes("data-admin-fixture"), `got ${m.status}`);
  }
  for (const path of ["/admin", "/admin/x/y"]) {
    const want = path === "/admin" ? "" : "x/y";
    // the second GET is a hard reload: a full document request with no client navigation state
    for (const pass of ["entry", "reload"]) {
      const s = await staff.get(path);
      record(`staff ${path} ${pass} renders the fixture mount`, s.status === 200 && s.text.includes("data-admin-fixture") && s.text.includes(`data-admin-path="${want}"`) && s.text.includes("ts-admin"), `got ${s.status}`);
    }
  }
  const deep = await staff.get("/admin/x/y");
  record("the mount is handed the Admin root crumb and the capability list", deep.text.includes('data-admin-root="Admin"') && deep.text.includes("admin.view"));

  // error boundary: the fixture throws on purpose, for staff only
  const boom = await staff.get("/admin/fixture-error");
  record("a render error is a 500 that leaks neither the message nor a stack", boom.status === 500 && !boom.text.includes("deliberate") && !/at \w+ \(/.test(boom.text), `got ${boom.status}`);
  // Production paints the boundary in the browser, so the HTML only carries the chunks that hold it.
  const chunks = [...boom.text.matchAll(/\/_next\/static\/chunks\/[^"' ]+\.js/g)].map((m) => m[0]);
  let wired = false;
  for (const chunk of new Set(chunks)) {
    if ((await anon.get(chunk)).text.includes("press jammed")) wired = true;
  }
  record("the error boundary (desk copy) ships in the chunks that page loads", wired, `${chunks.length} chunk(s) checked`);
}

// ---- degraded ----
const UNAVAILABLE = { error: { code: "storage_unavailable", message: "Saving is off on this preview." } };

async function degraded(ctx) {
  const { base } = ctx;
  const anon = client(base);
  const json = (r) => {
    try {
      return JSON.parse(r.text);
    } catch {
      return null;
    }
  };

  // health says so, and says where the paths came from
  const health = await anon.get("/api/health");
  const h = json(health) ?? {};
  record("health is 200 and reports storage unavailable", health.status === 200 && h.ok === true && h.storage === "unavailable", health.text.slice(0, 160));
  record("health reports persistence configured (both paths set)", h.persistence === "configured", String(h.persistence));

  // every storage route answers the same calm 503
  const calls = [
    ["POST", "/api/auth/link", { email: "someone@example.com", reason: "save" }],
    ["POST", "/api/auth/confirm", { token: "x" }],
    ["GET", "/api/auth/confirm?token=x"],
    ["POST", "/api/wall/sync", { stubs: [], deleted: [] }],
    ["GET", "/api/wall/public"],
    ["PUT", "/api/wall/public", { isPublic: true }],
    ["GET", "/api/u/abcdefghijkl"],
    ["POST", "/api/share", { stub: {} }],
    ["GET", "/api/share/abcdefghijkl"],
    ["POST", "/api/share/revoke", { stubId: "s1" }],
    ["POST", "/api/orders", { order: {} }],
    ["GET", "/api/orders"],
    ["POST", "/api/organizer/events", { title: "x" }],
    ["GET", "/api/claim/abcdefghijkl"],
    ["POST", "/api/claim/abcdefghijkl", {}],
    ["POST", "/api/gift", { stub: "s1", to: "A", message: "hi" }],
    ["GET", "/api/gift/abcdefghijkl"],
    ["DELETE", "/api/gift/abcdefghijkl", {}],
    ["POST", "/api/account/email", { email: "someone@example.com" }],
    ["DELETE", "/api/account", { confirm: "x" }],
  ];
  for (const [method, path, body] of calls) {
    const r = await anon.send(method, path, body);
    const j = json(r);
    record(`${method} ${path} -> 503 storage_unavailable`, r.status === 503 && j?.error?.code === UNAVAILABLE.error.code && j.error.message === UNAVAILABLE.error.message && r.headers.get("cache-control") === "no-store", `got ${r.status} ${r.text.slice(0, 120)}`);
  }

  // the things that must keep working
  const context = await anon.get("/api/context");
  const c = json(context);
  record("/api/context still answers an anonymous caller", context.status === 200 && c?.context?.actor?.kind === "anonymous" && c.context.revoked === false && typeof c.token === "string", `got ${context.status}`);
  const me = await anon.get("/api/auth/me");
  record("/api/auth/me answers 200, signed out, storage unavailable", me.status === 200 && json(me)?.account === null && json(me)?.storage === "unavailable", `got ${me.status}`);
  const stale = await anon.send("GET", "/api/context", undefined);
  record("a stale session cookie changes nothing", stale.status === 200);
  const art = await anon.send("POST", "/api/art", { event: { title: "Probe" }, vibe: "calm" });
  const a = json(art);
  record("/api/art fails open to procedural art with no quota", art.status === 200 && a?.kind === "procedural" && a.provenance === "simulated", `got ${art.status} ${art.text.slice(0, 100)}`);
  const stubImage = await anon.get("/api/stub-image/brand");
  record("/api/stub-image/brand needs no storage", stubImage.status === 200, `got ${stubImage.status}`);

  // pages render, never 500
  for (const url of ["/", "/make", "/wall", "/studio/x", "/checkout/x", "/account"]) {
    const r = await anon.get(url);
    record(`page ${url} -> 200`, r.status === 200, `got ${r.status}`);
  }
  for (const url of declaredPages()) {
    const want = url.startsWith("/admin") ? 404 : url === "/map" ? 308 : 200;
    const r = await anon.get(url);
    record(`declared page ${url} -> ${want}`, r.status === want, `got ${r.status}`);
  }
  const confirmPage = await anon.get("/signin/confirm?token=x");
  record("/signin/confirm renders the expired-link page", confirmPage.status === 200 && /expired/i.test(confirmPage.text), `got ${confirmPage.status}`);

  // the log: one storage line, no path
  const lines = server.log().split(/\r?\n/).filter((l) => l.includes("[storage]"));
  record("the server logged exactly one storage line, saying unavailable", lines.length === 1 && /unavailable/.test(lines[0]), lines.join(" | "));
  record("the log line leaks no path", lines.every((l) => !l.includes(tmp) && !/[\\/]/.test(l)), lines.join(" | "));

  // the production smoke still passes in this state
  await script("scripts/smoke-production.mjs", [], { SMOKE_BASE_URL: base });
}

// ---- run ----
let exit = 1;
let server = null;
let blocked = [];
try {
  const missing = suite.needs.filter((rel) => !existsSync(join(root, rel)));
  if (missing.length) {
    record("required files and build present", false, `missing ${missing.join(", ")}${missing.some((m) => m.startsWith(".next")) ? " (run npm run build first)" : ""}`);
  } else {
    // the guard has to work before anything is trusted to it
    const probe = await runNode(["--import", guardUrl, "--input-type=module", "-e", "try { await fetch('https://example.com/'); console.log('REACHED'); } catch (e) { console.log(e.code); }"], { ...process.env, VERIFY_NET_LOG: join(tmp, "selftest.log") });
    record("fixture mode refuses outbound network", probe.out.trim() === "ETICKETSTUB_FIXTURE_NETWORK", probe.out.trim());
    const ctx = {};
    if (suite.server) {
      let extra = {};
      if (suite.unwritableStorage) {
        // A path under a file is not creatable on any OS, whoever runs it.
        const blocker = join(tmp, "not-a-directory");
        writeFileSync(blocker, "x");
        extra = { TICKETSTUB_DB: join(blocker, "ticketstub.sqlite"), TICKETSTUB_FILES: join(blocker, "files") };
      }
      server = await startServer(extra);
      ctx.base = server.base;
    }
    await suite.run(ctx);
    blocked = readFileSync(netLog, "utf8").split("\n").filter(Boolean);
    record("no outbound network attempted", blocked.length === 0, blocked.join("; "));
  }
} catch (e) {
  record("suite ran to completion", false, e instanceof Error ? e.message : String(e));
} finally {
  if (server) {
    const exited = new Promise((done) => server.child.once("close", done));
    server.child.kill();
    await exited; // the server holds the throwaway database open; Windows won't delete it until it is gone
  }
  exit = steps.length > 0 && steps.every((s) => s.ok) ? 0 : 1;
  const counts = steps.reduce(
    (c, s) => ({ passed: c.passed + (s.passed ?? (s.ok ? 1 : 0)), failed: c.failed + (s.failed ?? (s.ok ? 0 : 1)), skipped: c.skipped + (s.skipped ?? 0) }),
    { passed: 0, failed: 0, skipped: 0 },
  );
  mkdirSync(evidenceDir, { recursive: true });
  const file = join(evidenceDir, `${args.suite}-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        suite: args.suite,
        mode: args.mode,
        command: `npm run verify:product -- ${process.argv.slice(2).join(" ")}`,
        exitCode: exit,
        counts,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        gitSha,
        gitDirty,
        node: process.version,
        blockedNetwork: blocked,
        steps,
      },
      null,
      2,
    ) + "\n",
  );
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* a leftover temp folder is not a failed run */
  }
  console.log(`\n${args.suite} (${args.mode}): ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped -> exit ${exit}\nevidence: ${file}`);
  process.exit(exit);
}
