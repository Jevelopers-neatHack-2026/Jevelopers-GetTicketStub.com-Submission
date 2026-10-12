// Reference verifier for a ticketstub.context/1 token. No dependencies: copy this function into a consumer.
//   node fixtures/context/verify.mjs        checks every fixture in this folder against its expected outcome
// verifyContext(token, key, { now, state }) -> { ok: true, ctx } | { ok: false, reason }
// reason is one of: unknown | forged | stale | revoked | expired | unsupported_version
// Without `state` it proves signature, version and expiry only. Stale and revoked need the issuer's current
// answer: { membershipRevision, sessionLive } for the token's account (see README.md).
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "ticketstub.context/1";
const ROLES = ["owner", "captain", "member", "viewer", "staff", "none"];
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const dec = (s) => Buffer.from(s, "base64url");

export function verifyContext(token, key, { now = Date.now(), state } = {}) {
  if (typeof token !== "string" || token.length > 8192) return { ok: false, reason: "unknown" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, reason: "unknown" };
  let head, body;
  try {
    head = JSON.parse(dec(parts[0]).toString("utf8"));
    body = JSON.parse(dec(parts[1]).toString("utf8"));
  } catch {
    return { ok: false, reason: "unknown" };
  }
  if (!isObj(head) || head.alg !== "HS256" || head.typ !== "ticketstub.context" || !isObj(body)) return { ok: false, reason: "unknown" };
  const want = createHmac("sha256", key).update(`${parts[0]}.${parts[1]}`).digest();
  const got = dec(parts[2]);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "forged" };
  const c = body.ctx;
  if (!isObj(c)) return { ok: false, reason: "unknown" };
  if (c.schema !== SCHEMA) return { ok: false, reason: "unsupported_version" };
  const shaped =
    isObj(c.actor) && ["account", "guest", "anonymous"].includes(c.actor.kind) && isObj(c.tenant) && typeof c.tenant.id === "string" &&
    ROLES.includes(c.role) && Array.isArray(c.capabilities) && c.capabilities.every((x) => typeof x === "string") &&
    Number.isInteger(c.membershipRevision) && typeof c.revoked === "boolean" && !Number.isNaN(Date.parse(c.expiresAt));
  if (!shaped) return { ok: false, reason: "unknown" };
  if (Date.parse(c.expiresAt) <= now) return { ok: false, reason: "expired" };
  if (c.revoked || state?.sessionLive === false) return { ok: false, reason: "revoked" };
  if (state?.membershipRevision !== undefined && state.membershipRevision !== c.membershipRevision) return { ok: false, reason: "stale" };
  return { ok: true, ctx: c };
}

/** The check a consumer runs on every request: the token must be for THIS tenant and THIS project. */
export function authorizes(ctx, { tenant, project, capability }) {
  return ctx.tenant.id === tenant && ctx.project?.kind === project.kind && ctx.project?.id === project.id && ctx.capabilities.includes(capability);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const here = dirname(fileURLToPath(import.meta.url));
  const key = JSON.parse(readFileSync(join(here, "fixture-key.json"), "utf8")).key;
  let bad = 0;
  for (const f of readdirSync(here).filter((n) => n.endsWith(".json") && !["fixture-key.json", "index.json"].includes(n))) {
    const fx = JSON.parse(readFileSync(join(here, f), "utf8"));
    const r = verifyContext(fx.token, key, { now: Date.parse(fx.verifyAt), state: fx.state });
    const ok = r.ok === fx.expect.ok && (r.ok ? r.ctx.role === fx.expect.role && r.ctx.tenant.id === fx.expect.tenant : r.reason === fx.expect.reason);
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${fx.fixture}: ${r.ok ? `ok role=${r.ctx.role}` : r.reason}`);
  }
  process.exit(bad ? 1 : 0);
}
