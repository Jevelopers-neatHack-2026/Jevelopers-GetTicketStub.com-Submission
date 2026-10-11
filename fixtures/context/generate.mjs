// Regenerates the JSON fixtures in this folder. Deterministic: same inputs, same bytes.
//   node fixtures/context/generate.mjs
// Signs with the FIXTURE key below. That key is public on purpose. It is fixture only, never production:
// a token signed with it carries mode "fixture", and no live deployment is configured with it.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_SCHEMA, capabilitiesFor, signContext } from "../../src/server/context-token.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_KEY = "FIXTURE-ONLY-NEVER-PRODUCTION--ticketstub-context-key-v1";
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

function ctx({ actor, tenant, project, role, staff = false, revision = 1, issued = NOW, ttl = 5 * 60_000, schema = CONTEXT_SCHEMA }) {
  return {
    schema,
    actor,
    tenant: { id: tenant },
    ...(project ? { project } : {}),
    role,
    capabilities: capabilitiesFor(actor.kind, role, project, staff),
    membershipRevision: revision,
    revoked: false,
    environment: "development",
    mode: "fixture",
    issuedAt: iso(issued),
    expiresAt: iso(issued + ttl),
  };
}

const account = (id) => ({ kind: "account", id });
const owner1 = account("acc_FIXTURE_owner1");
const SID = "fx0000000000000000000001";

const out = {};
function add(name, description, token, expect, state, verifyAt = NOW) {
  out[name] = { fixture: name, description, verifyAt: iso(verifyAt), token, ...(state ? { state } : {}), expect };
}
const live = { membershipRevision: 3, sessionLive: true };
const okExpect = (c) => ({ ok: true, role: c.role, tenant: c.tenant.id, ...(c.project ? { project: c.project } : {}) });

const owner = ctx({ actor: owner1, tenant: owner1.id, project: { kind: "stub", id: "stub_fx_1" }, role: "owner", revision: 3 });
add("owner", "An account owner on their own stub.", signContext(owner, FIXTURE_KEY, SID), okExpect(owner), live);

const captain = ctx({ actor: account("acc_FIXTURE_captain1"), tenant: "acc_FIXTURE_captain1", project: { kind: "event", id: "evt_fx_1" }, role: "captain", revision: 2 });
add("captain", "The captain (creator) of an organizer event.", signContext(captain, FIXTURE_KEY, "fx0000000000000000000002"), okExpect(captain), { membershipRevision: 2, sessionLive: true });

const staff = ctx({ actor: account("acc_FIXTURE_staff1"), tenant: "acc_FIXTURE_staff1", role: "staff", staff: true, revision: 1 });
add("staff", "A signed-in account on the ADMIN_EMAILS list. admin.view only, no project access.", signContext(staff, FIXTURE_KEY, "fx0000000000000000000003"), okExpect(staff), { membershipRevision: 1, sessionLive: true });

const guest = ctx({ actor: { kind: "guest", id: "fxguest0000000001" }, tenant: "guest:fxguest0000000001", role: "none", revision: 0 });
add("guest", "A server-bound guest device. Drafts only: no account capabilities.", signContext(guest, FIXTURE_KEY, null), okExpect(guest));

const unknown = ctx({ actor: { kind: "anonymous" }, tenant: "anonymous", role: "none", revision: 0 });
add("unknown", "No session and no device: role none, the public capabilities only. A valid token that grants nothing private.", signContext(unknown, FIXTURE_KEY, null), okExpect(unknown));

add("malformed", "Not a token at all.", "not-a-token", { ok: false, reason: "unknown" });

add("forged", "The owner payload signed with a different key.", signContext(owner, "some-other-key-the-issuer-never-saw-0000", SID), { ok: false, reason: "forged" }, live);

add(
  "stale",
  "Signed correctly, but the account's membershipRevision has moved on (4 now, the token says 3): email changed, signed out everywhere, or staff status flipped.",
  signContext(owner, FIXTURE_KEY, SID),
  { ok: false, reason: "stale" },
  { membershipRevision: 4, sessionLive: true },
);

add(
  "revoked",
  "Signed correctly, but the session behind it was signed out (or the account was deleted).",
  signContext(owner, FIXTURE_KEY, SID),
  { ok: false, reason: "revoked" },
  { membershipRevision: 3, sessionLive: false },
);

const old = ctx({ actor: owner1, tenant: owner1.id, project: { kind: "stub", id: "stub_fx_1" }, role: "owner", revision: 3, issued: NOW - 10 * 60_000 });
add("expired", "Issued ten minutes before verifyAt; the lifetime is five.", signContext(old, FIXTURE_KEY, SID), { ok: false, reason: "expired" }, live);

const v2 = ctx({ actor: owner1, tenant: owner1.id, project: { kind: "stub", id: "stub_fx_1" }, role: "owner", revision: 3, schema: "ticketstub.context/2" });
add("unsupported-version", "A correctly signed token with a schema this verifier does not know.", signContext(v2, FIXTURE_KEY, SID), { ok: false, reason: "unsupported_version" }, live);

const projB = ctx({ actor: owner1, tenant: owner1.id, project: { kind: "stub", id: "stub_fx_2" }, role: "owner", revision: 3 });
add("cross-project-a", "The same user on project A (stub_fx_1). Authorizes project A only.", signContext(owner, FIXTURE_KEY, SID), okExpect(owner), live);
add("cross-project-b", "The same user on project B (stub_fx_2). A token for B must not authorize A, and the reverse.", signContext(projB, FIXTURE_KEY, SID), okExpect(projB), live);

const t1 = ctx({ actor: account("acc_FIXTURE_tenant1"), tenant: "acc_FIXTURE_tenant1", project: { kind: "stub", id: "stub_fx_shared" }, role: "owner", revision: 1 });
const t2 = ctx({ actor: account("acc_FIXTURE_tenant2"), tenant: "acc_FIXTURE_tenant2", project: { kind: "stub", id: "stub_fx_shared" }, role: "owner", revision: 1 });
add("tenant-a-owner", "Tenant A's owner of stub_fx_shared. Project ids are only unique inside a tenant.", signContext(t1, FIXTURE_KEY, "fx0000000000000000000004"), okExpect(t1), { membershipRevision: 1, sessionLive: true });
add("tenant-b-owner", "Tenant B's owner of a stub with the same id. Key every lookup by tenant AND project.", signContext(t2, FIXTURE_KEY, "fx0000000000000000000005"), okExpect(t2), { membershipRevision: 1, sessionLive: true });

mkdirSync(here, { recursive: true });
for (const [name, f] of Object.entries(out)) writeFileSync(join(here, `${name}.json`), `${JSON.stringify(f, null, 2)}\n`);
const keyFile = {
  warning: "FIXTURE ONLY. NEVER PRODUCTION. Public on purpose: it signs test tokens that carry mode fixture. Never set it as CONTEXT_SECRET.",
  kid: "fixture",
  alg: "HS256",
  key: FIXTURE_KEY,
};
writeFileSync(join(here, "fixture-key.json"), `${JSON.stringify(keyFile, null, 2)}\n`);
const index = { schema: CONTEXT_SCHEMA, key: "fixture-key.json", verifier: "verify.mjs", fixtures: Object.keys(out).map((n) => `${n}.json`) };
writeFileSync(join(here, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`wrote ${Object.keys(out).length} fixtures to ${here}`);
