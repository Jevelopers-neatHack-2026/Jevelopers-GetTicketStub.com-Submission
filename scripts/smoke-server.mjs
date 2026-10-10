// Repeatable smoke test for the account API. Run the dev server (or `npm start`) first, then:
//   node scripts/smoke-server.mjs [baseUrl]
// Uses fresh random emails and a random client IP each run, so it can be repeated. It writes to the
// database the server uses. The expired-link check edits that file directly (TICKETSTUB_DB or the default).
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DB = process.env.TICKETSTUB_DB ?? "./data/ticketstub.sqlite";
const run = randomBytes(4).toString("hex");
let failed = 0;
let passed = 0;

function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${detail}`}`);
}

/** A client with its own cookie jar and IP, like one browser. */
function client(label) {
  const jar = new Map();
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const api = async (method, path, body, opts = {}) => {
    const headers = { "x-real-ip": ip, ...(opts.origin === null ? {} : { origin: opts.origin ?? BASE }) };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, v] = pair.split("=");
      if (/max-age=0/i.test(attrs.join(";")) || v === "") jar.delete(k.trim());
      else jar.set(k.trim(), v);
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, json, text, headers: res.headers, jar };
  };
  /** Asks for a link and opens it, so the jar holds a session. */
  const signIn = async (email, returnTo = "/wall", reason = "save") => {
    const r = await api("POST", "/api/auth/link", { email, returnTo, reason });
    if (!r.json?.devLink) throw new Error(`${label}: no devLink (${r.status} ${JSON.stringify(r.json)})`);
    const token = new URL(r.json.devLink).searchParams.get("token");
    return { link: r, cb: await api("POST", "/api/auth/confirm", { token }) };
  };
  return { api, signIn, jar, label, ip };
}

const tokenOf = (devLink) => new URL(devLink).searchParams.get("token");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const uniquePng = () => `data:image/png;base64,${Buffer.concat([PNG, randomBytes(8)]).toString("base64")}`;

const stub = (id, title, updatedAt, extra = {}) => ({
  id,
  createdAt: new Date().toISOString(),
  event: { type: "concert", title, facts: [] },
  versions: [{ id: `${id}-v1`, edition: "classic", art: { kind: "procedural", seed: 1, provenance: "simulated" }, createdAt: new Date().toISOString() }],
  currentVersionId: `${id}-v1`,
  personal: { titleFont: 0, titleColor: "#000", foilTitle: false, hiddenFields: [], friends: [] },
  material: "card",
  finish: "matte",
  torn: true,
  wallAngle: 0,
  photos: ["data:image/png;base64,AAAA"],
  updatedAt,
  ...extra,
});

const sync = (c, stubs, deleted = []) => c.api("POST", "/api/wall/sync", { stubs, deleted });
const titles = (r) => (r.json?.stubs ?? []).map((s) => `${s.id}:${s.event.title}`).sort();

async function main() {
  const t0 = Date.now();
  const a = client("A");
  const emailA = `smoke-a-${run}@example.com`;

  // Auth: link -> devLink -> callback -> cookie -> me
  const me0 = await a.api("GET", "/api/auth/me");
  check("me is null before sign-in", me0.status === 200 && me0.json?.account === null);
  check("sync without a session is 401", (await sync(a, [])).status === 401);
  check("link without Origin is 403", (await a.api("POST", "/api/auth/link", { email: emailA, reason: "save" }, { origin: null })).status === 403);
  check("link from a foreign Origin is 403", (await a.api("POST", "/api/auth/link", { email: emailA, reason: "save" }, { origin: "https://evil.example" })).status === 403);
  check("link with a bad email is 400", (await a.api("POST", "/api/auth/link", { email: "nope", reason: "save" })).status === 400);
  check("link with a bad reason is 400", (await a.api("POST", "/api/auth/link", { email: emailA, reason: "other" })).status === 400);
  const { link, cb } = await a.signIn(emailA, "/wall?x=1#top");
  check("link returns sandbox devLink", link.status === 200 && link.json.ok === true && link.json.sandbox === true && typeof link.json.devLink === "string");
  check("callback is 303 to returnTo with signedIn=1", cb.status === 303 && cb.headers.get("location") === "/wall?x=1&signedIn=1#top", cb.headers.get("location"));
  check("callback sets an httpOnly SameSite=Lax cookie", /ts_session=/.test(cb.headers.get("set-cookie") ?? "") && /HttpOnly/i.test(cb.headers.get("set-cookie") ?? "") && /SameSite=Lax/i.test(cb.headers.get("set-cookie") ?? ""));
  const me1 = await a.api("GET", "/api/auth/me");
  check("me returns the account", me1.json?.account?.email === emailA && typeof me1.json.account.id === "string");

  // Used link
  const again = await client("anon").api("POST", "/api/auth/confirm", { token: tokenOf(link.json.devLink) });
  check("a used link redirects to /wall?signin=expired", again.status === 303 && again.headers.get("location") === "/wall?signin=expired");

  // GET alone never burns a link
  const scan = client("scanner");
  const scanLink = await scan.api("POST", "/api/auth/link", { email: `smoke-scan-${run}@example.com`, returnTo: "/wall", reason: "checkout" });
  const scanToken = tokenOf(scanLink.json.devLink);
  check("the devLink points at the confirm page", new URL(scanLink.json.devLink).pathname === "/signin/confirm");
  const pageGet = await fetch(`${BASE}/signin/confirm?token=${scanToken}`);
  const pageHtml = await pageGet.text();
  check("the confirm page renders with the sign-in stamp and a masked address", pageGet.status === 200 && pageHtml.includes("Sign in to TicketStub") && pageHtml.includes("s***@example.com"), String(pageGet.status));
  const oldGetLink = await scan.api("GET", `/api/auth/callback?token=${scanToken}`);
  check("the old callback GET only redirects to the confirm page", oldGetLink.status === 303 && oldGetLink.headers.get("location") === `/signin/confirm?token=${scanToken}` && !oldGetLink.jar.has("ts_session"));
  for (let i = 0; i < 3; i++) await fetch(`${BASE}/signin/confirm?token=${scanToken}`);
  await scan.api("GET", `/api/auth/confirm?token=${scanToken}`);
  const peek = await scan.api("GET", `/api/auth/confirm?token=${scanToken}`);
  check("repeated GETs leave the link valid", peek.json.valid === true && peek.json.kind === "signin" && peek.json.maskedEmail === "s***@example.com" && !("email" in peek.json));
  check("a POST without Origin is 403 and burns nothing", (await scan.api("POST", "/api/auth/confirm", { token: scanToken }, { origin: null })).status === 403 && (await scan.api("GET", `/api/auth/confirm?token=${scanToken}`)).json.valid === true);
  const formRes = await fetch(`${BASE}/api/auth/confirm`, { method: "POST", redirect: "manual", headers: { origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: `token=${scanToken}` });
  check("the tap (a form post) signs in with a 303 and a cookie", formRes.status === 303 && formRes.headers.get("location") === "/wall?signedIn=1" && /ts_session=/.test(formRes.headers.get("set-cookie") ?? ""));
  check("the page then reads as expired", (await (await fetch(`${BASE}/signin/confirm?token=${scanToken}`)).text()).includes("This link has expired"));
  check("peek on a used link is invalid", (await scan.api("GET", `/api/auth/confirm?token=${scanToken}`)).json.valid === false);

  // Expired link (edit the row, as waiting 15 minutes is not a smoke test)
  const exp = client("exp");
  const expLink = await exp.api("POST", "/api/auth/link", { email: `smoke-exp-${run}@example.com`, reason: "save" });
  try {
    const token = new URL(expLink.json.devLink).searchParams.get("token");
    const db = new DatabaseSync(DB);
    db.prepare("UPDATE login_links SET expires_at = 1 WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
    db.close();
    const r = await exp.api("POST", "/api/auth/confirm", { token });
    check("an expired link redirects to /wall?signin=expired", r.status === 303 && r.headers.get("location") === "/wall?signin=expired" && !r.jar.has("ts_session"));
  } catch (e) {
    check("an expired link redirects to /wall?signin=expired", false, `(could not edit ${DB}: ${e.message})`);
  }
  check("a garbage token redirects to expired", (await client("g").api("POST", "/api/auth/confirm", { token: "nope" })).headers.get("location") === "/wall?signin=expired");

  // returnTo must be relative
  for (const [bad, label] of [["https://evil.example/x", "absolute url"], ["//evil.example", "protocol-relative"], ["/\\evil.example", "backslash"], ["javascript:alert(1)", "javascript:"]]) {
    const c = client("rt");
    const { cb: r } = await c.signIn(`smoke-rt-${randomBytes(3).toString("hex")}-${run}@example.com`, bad);
    check(`returnTo ${label} falls back to /wall`, r.headers.get("location") === "/wall?signedIn=1", r.headers.get("location"));
  }

  // Sync merge
  const t = Date.now() - 3_600_000; // updatedAt past now+1 day is clamped, so stay in the past
  let r = await sync(a, [stub("s1", "One", t), stub("s2", "Two", t)]);
  check("sync stores stubs and returns the wall", r.status === 200 && titles(r).join() === "s1:One,s2:Two" && typeof r.json.now === "number" && r.json.deleted.length === 0);
  check("photos are not stored", r.json.stubs.every((s) => s.photos.length === 0));
  r = await sync(a, [stub("s1", "One newer", t + 10)]);
  check("newer updatedAt wins", titles(r).includes("s1:One newer"));
  r = await sync(a, [stub("s1", "One older", t - 10)]);
  check("older updatedAt loses", titles(r).includes("s1:One newer") && !titles(r).includes("s1:One older"));
  r = await sync(a, [stub("s1", "One tied", t + 10)]);
  check("equal updatedAt keeps the server copy", titles(r).includes("s1:One newer"));
  r = await sync(a, [], ["s2"]);
  check("tombstone removes the stub and is reported", !titles(r).some((x) => x.startsWith("s2:")) && r.json.deleted.includes("s2"));
  r = await sync(a, [stub("s2", "Two stale", t + 5)]);
  check("tombstone wins over an older stub", !titles(r).some((x) => x.startsWith("s2:")) && r.json.deleted.includes("s2"));
  r = await sync(a, [stub("s2", "Two revived", Date.now() + 60_000)]);
  check("a stub edited after the delete comes back", titles(r).includes("s2:Two revived") && !r.json.deleted.includes("s2"));
  r = await sync(a, [stub("s3", "Three", t)], ["s3"]);
  check("delete in the same request wins", !titles(r).some((x) => x.startsWith("s3:")));

  // Two devices, one account
  const b = client("B");
  await b.signIn(emailA);
  r = await sync(b, [stub("d1", "Phone only", t), stub("s1", "One from phone, old", t - 100)]);
  check("device B receives the account's stubs and keeps its own", titles(r).includes("s1:One newer") && titles(r).includes("d1:Phone only") && titles(r).includes("s2:Two revived"), titles(r).join());
  r = await sync(a, []);
  check("device A pulls down what B pushed", titles(r).includes("d1:Phone only"));
  await sync(b, [], ["d1"]);
  r = await sync(a, [stub("d1", "Phone only", t)]);
  check("a stale device can't resurrect a deleted stub", !titles(r).some((x) => x.startsWith("d1:")) && r.json.deleted.includes("d1"));

  // Validation and bounds
  check("a stub without an id is 400", (await sync(a, [{ event: { title: "x" } }])).status === 400);
  check("a stub without an event is 400", (await sync(a, [{ id: "x", event: "nope", versions: [], personal: {} }])).status === 400);
  check("a stub with a bad id is 400", (await sync(a, [{ ...stub("x", "x", t), id: "../../etc" }])).status === 400);
  check("sync with a foreign Origin is 403", (await a.api("POST", "/api/wall/sync", { stubs: [], deleted: [] }, { origin: "https://evil.example" })).status === 403);
  const big = await a.api("POST", "/api/wall/sync", JSON.stringify({ stubs: [], deleted: [], pad: "x".repeat(33 * 1024 * 1024) }));
  check("a body over the limit is 413", big.status === 413, String(big.status));
  check("malformed JSON is 400", (await a.api("POST", "/api/wall/sync", "{nope")).status === 400);

  // Public wall
  const pub0 = await a.api("PUT", "/api/wall/public", { isPublic: true });
  const token = pub0.json?.token;
  check("making the wall public returns a token", pub0.status === 200 && typeof token === "string" && token.length >= 10);
  const anon = client("viewer");
  const view = await anon.api("GET", `/api/u/${token}`);
  check("public wall is readable without a session", view.status === 200 && view.json.stubs.length >= 2 && view.json.stubs.every((s) => s.torn));
  check("the token is stable", (await a.api("PUT", "/api/wall/public", { isPublic: true })).json.token === token);
  const off = await a.api("PUT", "/api/wall/public", { isPublic: false });
  check("turning it off returns null", off.json.token === null);
  check("a private wall is 404", (await anon.api("GET", `/api/u/${token}`)).status === 404);
  check("the token comes back the same when re-enabled", (await a.api("PUT", "/api/wall/public", { isPublic: true })).json.token === token);
  check("an unknown wall token is 404", (await anon.api("GET", "/api/u/doesnotexist1")).status === 404);
  const cur = await a.api("GET", "/api/wall/public");
  check("GET /api/wall/public reports the state", cur.status === 200 && cur.json.isPublic === true && cur.json.token === token, JSON.stringify(cur.json));
  check("GET /api/wall/public needs a session", (await anon.api("GET", "/api/wall/public")).status === 401);
  check("public wall needs a session to change", (await anon.api("PUT", "/api/wall/public", { isPublic: true })).status === 401);

  // Share
  const sh1 = await anon.api("POST", "/api/share", { stub: stub("shared1", "Shared v1", t) });
  const sh2 = await anon.api("POST", "/api/share", { stub: stub("shared1", "Shared v2", t) });
  check("share returns a short URL-safe token", sh1.status === 200 && /^[A-Za-z0-9_-]{8,16}$/.test(sh1.json.token), JSON.stringify(sh1.json));
  check("the same stub gets the same token", sh1.json.token === sh2.json.token);
  const got = await anon.api("GET", `/api/share/${sh1.json.token}`);
  check("the snapshot is the latest", got.status === 200 && got.json.stub.event.title === "Shared v2" && got.json.stub.photos.length === 0);
  const shA = await a.api("POST", "/api/share", { stub: stub("shared1", "Mine", t) });
  check("a signed-in owner's share is separate from an anonymous one", shA.json.token !== sh1.json.token && (await anon.api("GET", `/api/share/${sh1.json.token}`)).json.stub.event.title === "Shared v2");
  check("an unknown share is 404", (await anon.api("GET", "/api/share/nope-nope-nope")).status === 404);
  check("a share with no stub is 400", (await anon.api("POST", "/api/share", { stub: { id: "x" } })).status === 400);

  // Orders
  const order = {
    stubIds: ["s1"],
    lines: [{ title: "One newer", material: "card", finish: "foil", size: "classic", totalMinor: 3500 }],
    totalMinor: 3500,
    method: "card",
  };
  const guest = client("guest");
  check("a guest order without an email is 401", (await guest.api("POST", "/api/orders", { order })).status === 401);
  const guestEmail = `smoke-guest-${run}@example.com`;
  const go = await guest.api("POST", "/api/orders", { order: { ...order, email: guestEmail } });
  check("a guest order with an email is created", go.status === 200 && go.json.order.mode === "sandbox" && /^ord_/.test(go.json.order.id) && go.json.order.email === guestEmail);
  const so = await a.api("POST", "/api/orders", { order });
  check("a signed-in order uses the account email", so.status === 200 && so.json.order.email === emailA);
  check("an order with a bad method is 400", (await a.api("POST", "/api/orders", { order: { ...order, method: "bitcoin" } })).status === 400);
  check("an order with a negative total is 400", (await a.api("POST", "/api/orders", { order: { ...order, totalMinor: -1 } })).status === 400);
  const list = await a.api("GET", "/api/orders");
  check("orders are listed for the session", list.status === 200 && list.json.orders.some((o) => o.id === so.json.order.id) && !list.json.orders.some((o) => o.id === go.json.order.id));
  check("orders need a session to list", (await guest.api("GET", "/api/orders")).status === 401);
  const g2 = client("guest-signin");
  await g2.signIn(guestEmail);
  check("a guest's order shows once they sign in with that email", (await g2.api("GET", "/api/orders")).json.orders.some((o) => o.id === go.json.order.id));

  // Organizer and claims
  const org = await a.api("POST", "/api/organizer/events", { title: "Smoke party", stub: stub("evt-stub", "Smoke party", t), guests: [{ name: "Ada", seat: "A1" }, { name: "Grace" }], expiresInDays: 7 });
  check("organizer event returns claims", org.status === 200 && /^evt_/.test(org.json.eventId) && org.json.claims.length === 2 && org.json.claims[0].seat === "A1" && !("seat" in org.json.claims[1]));
  check("organizer event needs a session", (await anon.api("POST", "/api/organizer/events", { title: "x", stub: stub("e", "x", t), guests: [{ name: "x" }] })).status === 401);
  check("organizer event with no guests is 400", (await a.api("POST", "/api/organizer/events", { title: "x", stub: stub("e", "x", t), guests: [] })).status === 400);
  const ct = org.json.claims[0].token;
  const cv = await anon.api("GET", `/api/claim/${ct}`);
  check("claim preview carries the guest name", cv.status === 200 && cv.json.guestName === "Ada" && cv.json.seat === "A1" && cv.json.claimed === false && cv.json.expired === false && cv.json.stub.personal.guestName === "Ada");
  check("claim needs a session", (await anon.api("POST", `/api/claim/${ct}`)).status === 401);
  const c2 = client("second");
  await c2.signIn(`smoke-second-${run}@example.com`);
  const claimA = await a.api("POST", `/api/claim/${ct}`);
  check("first claim adds the stub to the wall", claimA.status === 200 && claimA.json.stub.personal.guestName === "Ada" && claimA.json.stub.torn === true);
  check("claiming again with the same account is idempotent", (await a.api("POST", `/api/claim/${ct}`)).json.stub.id === claimA.json.stub.id);
  const wallA = await sync(a, []);
  check("the claimed stub is on the claimer's wall exactly once", wallA.json.stubs.filter((s) => s.id === claimA.json.stub.id).length === 1);
  const claimB = await c2.api("POST", `/api/claim/${ct}`);
  check("a different account gets 409", claimB.status === 409 && claimB.json.error.code === "already_claimed", String(claimB.status));
  check("claim preview now says claimed", (await anon.api("GET", `/api/claim/${ct}`)).json.claimed === true);
  check("an unknown claim token is 404", (await anon.api("GET", "/api/claim/doesnotexist1")).status === 404);
  const exEvt = await a.api("POST", "/api/organizer/events", { title: "Old", stub: stub("evt-old", "Old", t), guests: [{ name: "Late" }], expiresInDays: 1 });
  try {
    const db = new DatabaseSync(DB);
    db.prepare("UPDATE organizer_events SET expires_at = 1 WHERE id = ?").run(exEvt.json.eventId);
    db.close();
    const lt = exEvt.json.claims[0].token;
    check("an expired claim previews as expired", (await anon.api("GET", `/api/claim/${lt}`)).json.expired === true);
    check("an expired claim can't be claimed (410)", (await c2.api("POST", `/api/claim/${lt}`)).status === 410);
  } catch (e) {
    check("expired claim", false, `(could not edit ${DB}: ${e.message})`);
  }

  // Rate limit: 5 per email
  const rl = client("rl");
  const rlEmail = `smoke-rl-${run}@example.com`;
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await rl.api("POST", "/api/auth/link", { email: rlEmail, reason: "save" })).status);
  check("the 6th link for one email is 429", codes.slice(0, 5).every((c) => c === 200) && codes[5] === 429, codes.join());
  const ipc = client("ip");
  const ipCodes = [];
  for (let i = 0; i < 21; i++) ipCodes.push((await ipc.api("POST", "/api/auth/link", { email: `smoke-ip-${i}-${run}@example.com`, reason: "save" })).status);
  check("the 21st link from one IP is 429", ipCodes.slice(0, 20).every((c) => c === 200) && ipCodes[20] === 429, ipCodes.join());

  // Emails and the stub picture
  const prev = await anon.api("GET", "/api/dev/email-preview?kind=receipt");
  check("email preview returns HTML in dev", prev.status === 200 && /TICKETSTUB/.test(prev.text ?? "") === true, String(prev.status));
  const imgRes = await fetch(`${BASE}/api/stub-image/${sh1.json.token}`);
  check("stub image renders a PNG for a share token", imgRes.status === 200 && imgRes.headers.get("content-type") === "image/png");
  check("stub image for an unknown token is 404", (await fetch(`${BASE}/api/stub-image/nope-nope-nope`)).status === 404);

  // Account: change email
  const acc = client("acc");
  const emailOld = `smoke-old-${run}@example.com`;
  const emailNew = `smoke-new-${run}@example.com`;
  await acc.signIn(emailOld);
  const accOrder = await acc.api("POST", "/api/orders", { order });
  check("email change needs a session", (await anon.api("POST", "/api/account/email", { email: emailNew })).status === 401);
  check("email change to the same address is 400", (await acc.api("POST", "/api/account/email", { email: emailOld })).status === 400);
  check("email change with a foreign Origin is 403", (await acc.api("POST", "/api/account/email", { email: emailNew }, { origin: "https://evil.example" })).status === 403);
  const ch = await acc.api("POST", "/api/account/email", { email: emailNew });
  check("email change returns a sandbox devLink", ch.status === 200 && ch.json.sandbox === true && /\/signin\/confirm\?token=/.test(ch.json.devLink ?? ""));
  const chToken = tokenOf(ch.json.devLink);
  const peekEmail = await anon.api("GET", `/api/auth/confirm?token=${chToken}`);
  check("an email-change link peeks as kind=email, masked", peekEmail.json.valid === true && peekEmail.json.kind === "email" && peekEmail.json.maskedEmail.includes("***"));
  const oldGet = await anon.api("GET", `/api/account/email/confirm?token=${chToken}`);
  check("the old email-change GET only redirects to the confirm page", oldGet.status === 303 && oldGet.headers.get("location").startsWith("/signin/confirm?token=") && (await anon.api("GET", `/api/auth/confirm?token=${chToken}`)).json.valid === true);
  const conf = await anon.api("POST", "/api/auth/confirm", { token: chToken });
  check("confirming an email change never creates a session", !conf.jar.has("ts_session"));
  check("confirming redirects to /account?email=changed", conf.status === 303 && conf.headers.get("location") === "/account?email=changed", conf.headers.get("location"));
  check("me shows the new email", (await acc.api("GET", "/api/auth/me")).json.account.email === emailNew);
  check("the email link is single use", (await acc.api("POST", "/api/auth/confirm", { token: chToken })).headers.get("location") === "/account?email=expired");
  const takenReq = await acc.api("POST", "/api/account/email", { email: emailA });
  const taken = await anon.api("POST", "/api/auth/confirm", { token: tokenOf(takenReq.json.devLink) });
  check("an address owned by another account redirects to ?email=taken", taken.headers.get("location") === "/account?email=taken");
  check("the email stayed as it was", (await acc.api("GET", "/api/auth/me")).json.account.email === emailNew);
  const sw = await acc.api("POST", "/api/share", { stub: stub("acc-share", "Acc share", t) });
  await sync(acc, [stub("acc-1", "Acc one", t)]);
  const accPub = (await acc.api("PUT", "/api/wall/public", { isPublic: true })).json.token;

  // Account: delete
  check("delete needs a session", (await anon.api("DELETE", "/api/account", { confirm: emailNew })).status === 401);
  check("delete with the wrong confirmation is 400", (await acc.api("DELETE", "/api/account", { confirm: "wrong@example.com" })).status === 400);
  check("delete with a foreign Origin is 403", (await acc.api("DELETE", "/api/account", { confirm: emailNew }, { origin: "https://evil.example" })).status === 403);
  const del = await acc.api("DELETE", "/api/account", { confirm: emailNew.toUpperCase() });
  check("delete removes the account and clears the cookie", del.status === 200 && del.json.ok === true && !del.jar.has("ts_session") && (await acc.api("GET", "/api/auth/me")).json.account === null);
  check("its public wall is gone", (await anon.api("GET", `/api/u/${accPub}`)).status === 404);
  check("its shares are gone", (await anon.api("GET", `/api/share/${sw.json.token}`)).status === 404);
  try {
    const db = new DatabaseSync(DB);
    const o = db.prepare("SELECT account_id, email, data FROM orders WHERE id = ?").get(accOrder.json.order.id);
    db.close();
    check("its order is kept, anonymised", o && o.account_id === null && o.email === null && !("email" in JSON.parse(o.data)));
  } catch (e) {
    check("its order is kept, anonymised", false, `(could not read ${DB}: ${e.message})`);
  }
  const back = client("back");
  await back.signIn(emailNew);
  check("the same email starts a fresh, empty account", (await sync(back, [])).json.stubs.length === 0);

  // Art as files
  const art = client("art");
  await art.signIn(`smoke-art-${run}@example.com`);
  const png = uniquePng();
  const withArt = (id, src) => stub(id, id, t, { versions: [{ id: `${id}-v`, edition: "classic", art: { kind: "image", src, seed: 1, provenance: "live" }, createdAt: "x" }] });
  const artRes = await sync(art, [withArt("art-1", png)]);
  const got1 = artRes.json.stubs[0];
  const artUrl = got1?.versions[0].art.src;
  check("embedded art becomes an /api/files URL", /^\/api\/files\/[a-f0-9]{64}\.png$/.test(artUrl ?? ""), String(artUrl).slice(0, 60));
  check("rewriting the art does not touch updatedAt", got1.updatedAt === t);
  const fileRes = await fetch(BASE + artUrl);
  const fileBytes = Buffer.from(await fileRes.arrayBuffer());
  check("the file is served with type, nosniff and immutable caching", fileRes.status === 200 && fileRes.headers.get("content-type") === "image/png" && fileRes.headers.get("x-content-type-options") === "nosniff" && /immutable/.test(fileRes.headers.get("cache-control") ?? "") && fileBytes.equals(Buffer.from(png.split(",")[1], "base64")));
  check("a stub that already carries the URL is accepted as is", (await sync(art, [withArt("art-1", artUrl)])).status === 200);
  check("path traversal and bad names are 404", (await fetch(`${BASE}/api/files/..%2F..%2Fpackage.json`)).status === 404 && (await fetch(`${BASE}/api/files/${"a".repeat(64)}.png`)).status === 404 && (await fetch(`${BASE}/api/files/${"A".repeat(64)}.png`)).status === 404 && (await fetch(`${BASE}/api/files/${"a".repeat(64)}.svg`)).status === 404);
  const fake = await sync(art, [withArt("art-2", `data:image/png;base64,${Buffer.from("not an image at all").toString("base64")}`)]);
  check("a data URL that isn't really a PNG is 400", fake.status === 400 && fake.json.error.code === "bad_image", String(fake.status));
  check("an svg data URL is 400", (await sync(art, [withArt("art-3", `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`)])).status === 400);
  check("a declared type that doesn't match the bytes is 400", (await sync(art, [withArt("art-4", `data:image/jpeg;base64,${PNG.toString("base64")}`)])).status === 400);
  const bigPng = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
  const huge = await sync(art, [withArt("art-5", `data:image/png;base64,${bigPng.toString("base64")}`)]);
  check("an image over 6 MB is 413", huge.status === 413, String(huge.status));
  const artShare = await art.api("POST", "/api/share", { stub: withArt("art-1", uniquePng()) });
  const shared = await art.api("GET", `/api/share/${artShare.json.token}`);
  check("share also moves art to a file", /^\/api\/files\//.test(shared.json.stub.versions[0].art.src));
  const img = await fetch(`${BASE}/api/stub-image/${artShare.json.token}`);
  check("the stub picture renders with stored art", img.status === 200 && img.headers.get("content-type") === "image/png");
  const orgArt = await art.api("POST", "/api/organizer/events", { title: "Art party", stub: withArt("art-evt", uniquePng()), guests: [{ name: "G" }] });
  const orgClaim = await anon.api("GET", `/api/claim/${orgArt.json.claims[0].token}`);
  check("organizer events move art to a file too", /^\/api\/files\//.test(orgClaim.json.stub.versions[0].art.src));
  // A file no one else references goes with the account; one shared by hash stays
  const soloRes = await sync(art, [withArt("art-solo", uniquePng())]);
  const soloUrl = soloRes.json.stubs.find((x) => x.id === "art-solo").versions[0].art.src;
  const keeper = client("keeper");
  await keeper.signIn(`smoke-keeper-${run}@example.com`);
  await sync(keeper, [withArt("keep-1", artUrl)]);
  const artMe = (await art.api("GET", "/api/auth/me")).json.account.email;
  await art.api("DELETE", "/api/account", { confirm: artMe });
  check("deleting the account removes art nothing else uses", (await fetch(BASE + soloUrl)).status === 404);
  check("art still referenced by another account stays", (await fetch(BASE + artUrl)).status === 200);

  // Disposable email domains
  const dis = client("disposable");
  const disBad = await dis.api("POST", "/api/auth/link", { email: `smoke-${run}@mailinator.com`, reason: "save" });
  check("a disposable domain is refused at sign-in with 400 disposable_email", disBad.status === 400 && disBad.json?.error?.code === "disposable_email", `${disBad.status} ${disBad.text}`);
  const disSub = await dis.api("POST", "/api/auth/link", { email: `smoke-${run}@a.b.YOPMAIL.com`, reason: "save" });
  check("a subdomain and upper case of a disposable domain are refused too", disSub.status === 400 && disSub.json?.error?.code === "disposable_email", String(disSub.status));
  check("a normal domain still signs in", (await dis.api("POST", "/api/auth/link", { email: `smoke-ok-${run}@example.org`, reason: "save" })).status === 200);
  const disAcc = client("disposable-acct");
  await disAcc.signIn(`smoke-dis-${run}@example.com`);
  const disChange = await disAcc.api("POST", "/api/account/email", { email: `smoke-${run}@guerrillamail.com` });
  check("an email change to a disposable domain is 400 disposable_email", disChange.status === 400 && disChange.json?.error?.code === "disposable_email", String(disChange.status));

  // Art caps: 10 per account and per device per day, 30 per IP. The caps are read on every call, so rows seeded
  // into art_usage prove the 429 without spending a generation. (A server with an OpenAI key would spend one on the first call.)
  const today = new Date().toISOString().slice(0, 10);
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  const seedUsage = (key, count) => {
    const db = new DatabaseSync(DB);
    try {
      db.prepare("INSERT INTO art_usage (key, day, count) VALUES (?, ?, ?) ON CONFLICT (key, day) DO UPDATE SET count = excluded.count").run(key, today, count);
    } finally {
      db.close();
    }
  };
  const artBody = { event: { type: "concert", title: "Smoke night", facts: [] }, vibe: "Neon", seed: 7 };
  const dev = client("art-device");
  const art1 = await dev.api("POST", "/api/art", artBody);
  check("art works under the cap", art1.status === 200 && typeof art1.json?.kind === "string", String(art1.status));
  const devCookie = art1.headers.getSetCookie().find((c) => c.startsWith("ts_device="));
  check("the first art call sets an httpOnly device cookie", !!devCookie && /httponly/i.test(devCookie) && dev.jar.has("ts_device"));
  const art2 = await dev.api("POST", "/api/art", artBody);
  check("the device cookie is not reissued", art2.status === 200 && !art2.headers.getSetCookie().some((c) => c.startsWith("ts_device=")));
  seedUsage(`dev:${sha(dev.jar.get("ts_device"))}`, 10);
  const art3 = await dev.api("POST", "/api/art", artBody);
  check("a device at its cap gets 429 art_limit with retryAt", art3.status === 429 && art3.json?.error?.code === "art_limit" && art3.json.retryAt > Date.now(), `${art3.status} ${art3.text}`);
  check("the 429 carries procedural art as the fallback", art3.json?.art?.kind === "procedural");
  const fresh = client("art-fresh-device");
  seedUsage(`ip:${sha(fresh.ip)}`, 30);
  check("an IP at its cap gets 429 whatever the device", (await fresh.api("POST", "/api/art", artBody)).status === 429);
  const accArt = client("art-account");
  await accArt.signIn(`smoke-artcap-${run}@example.com`);
  const accId = (await accArt.api("GET", "/api/auth/me")).json.account.id;
  seedUsage(`acc:${accId}`, 10);
  const accCapped = await accArt.api("POST", "/api/art", artBody);
  check("an account at its cap gets 429 on any device", accCapped.status === 429 && accCapped.json?.error?.code === "art_limit", String(accCapped.status));
  const accOther = await accArt.api("DELETE", "/api/account", { confirm: `smoke-artcap-${run}@example.com` });
  check("the capped account can still be deleted", accOther.status === 200);

  // Sign out
  const so2 = await b.api("POST", "/api/auth/signout");
  check("signout clears the session", so2.status === 200 && (await b.api("GET", "/api/auth/me")).json.account === null);
  check("the old session is dead server-side", (await sync(b, [])).status === 401);
  check("errors have the contract shape", (await sync(b, [])).json?.error?.code === "unauthorized");

  console.log(`\n${passed} passed, ${failed} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke crashed:", e.message);
  process.exit(2);
});
