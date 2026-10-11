// The malformed-shape corpus: validly signed contexts that must all be refused as `unknown`. It is data, not tokens,
// so each caller signs it with its own key: generate.mjs with the fixture key (-> v2/malformed-shapes.json), the
// unit tests with a throwaway key, and scripts/check-finance-context.mjs with the running server's CONTEXT_SECRET.
// The /1 cases open with the seven shapes the Finance receipt (GT-FIN-003) found passing the old offline verifier:
// missing actor id, missing or unknown environment, missing or unknown mode, malformed project kind or id, missing issuedAt.
import { CONTEXT_SCHEMA, CONTEXT_SCHEMA_V2, capabilitiesFor, toContextV2 } from "../../src/server/context-token.ts";

export const NOW = Date.parse("2026-10-10T12:00:00.000Z");
export const AUDIENCE = "ticketstub.finance";
const iso = (ms) => new Date(ms).toISOString();

/** A valid /1 context: an account owner on one stub. */
export function v1Base() {
  const project = { kind: "stub", id: "stub_fx_1" };
  return {
    schema: CONTEXT_SCHEMA,
    actor: { kind: "account", id: "acc_FIXTURE_owner1" },
    tenant: { id: "acc_FIXTURE_owner1" },
    project,
    role: "owner",
    capabilities: capabilitiesFor("account", "owner", project, false),
    membershipRevision: 3,
    revoked: false,
    environment: "development",
    mode: "fixture",
    issuedAt: iso(NOW),
    expiresAt: iso(NOW + 5 * 60_000),
  };
}

/** A valid /2 context. `over` replaces whole top-level fields. Default: an event captain, sandbox, fixture evidence. */
export function v2Base(over = {}, { staff = false } = {}) {
  const project = { kind: "event", id: "evt_fx_1" };
  const v1 = {
    ...v1Base(),
    actor: { kind: "account", id: "acc_FIXTURE_captain1" },
    tenant: { id: "acc_FIXTURE_captain1" },
    project,
    role: "captain",
    capabilities: capabilitiesFor("account", "captain", project, false),
  };
  return { ...toContextV2(v1, { staff, environment: "development", economicMode: "sandbox", evidenceMode: "fixture", audience: AUDIENCE }), ...over };
}

const drop = (o, ...path) => {
  const last = path.pop();
  const target = path.reduce((x, k) => x[k], o);
  delete target[last];
};
const put = (o, v, ...path) => {
  const last = path.pop();
  path.reduce((x, k) => x[k], o)[last] = v;
};

/** [name, schema version, mutation]. Every one must verify as { ok: false, reason: "unknown" } once correctly signed. */
export const MALFORMED = [
  // ---- /1: the seven from the Finance receipt, plus the rest of the shape ----
  ["v1 missing account actor id", 1, (c) => drop(c, "actor", "id")],
  ["v1 empty account actor id", 1, (c) => put(c, "", "actor", "id")],
  ["v1 missing environment", 1, (c) => drop(c, "environment")],
  ["v1 unknown environment", 1, (c) => put(c, "production", "environment")],
  ["v1 missing mode", 1, (c) => drop(c, "mode")],
  ["v1 unknown mode", 1, (c) => put(c, "paid_test", "mode")],
  ["v1 malformed project kind", 1, (c) => put(c, "wall", "project", "kind")],
  ["v1 malformed project id", 1, (c) => put(c, "a b/../c", "project", "id")],
  ["v1 project id too long", 1, (c) => put(c, "x".repeat(129), "project", "id")],
  ["v1 missing issuedAt", 1, (c) => drop(c, "issuedAt")],
  ["v1 issuedAt not a date", 1, (c) => put(c, "yesterday-ish", "issuedAt")],
  ["v1 missing tenant id", 1, (c) => drop(c, "tenant", "id")],
  ["v1 unknown role", 1, (c) => put(c, "finance-admin", "role")],
  ["v1 capabilities not strings", 1, (c) => put(c, ["stub.read", 7], "capabilities")],
  ["v1 revision not an integer", 1, (c) => put(c, 1.5, "membershipRevision")],
  ["v1 revoked not a boolean", 1, (c) => put(c, "no", "revoked")],
  // ---- /2 ----
  ["v2 actor id not kind-prefixed", 2, (c) => put(c, "acc_FIXTURE_captain1", "actor", "id")],
  ["v2 actor id carries another kind's prefix", 2, (c) => put(c, "guest:acc_FIXTURE_captain1", "actor", "id")],
  ["v2 tenant differs from actor", 2, (c) => put(c, "account:acc_someone_else", "tenant", "id")],
  ["v2 anonymous actor with a raw id", 2, (c) => {
    c.actor = { kind: "anonymous", id: "anonymous:somebody" };
    c.tenant = { id: "anonymous:somebody" };
  }],
  ["v2 actor kind unknown", 2, (c) => put(c, "service", "actor", "kind")],
  ["v2 missing environment", 2, (c) => drop(c, "environment")],
  ["v2 unknown environment", 2, (c) => put(c, "production", "environment")],
  ["v2 missing economic mode", 2, (c) => drop(c, "economicMode")],
  ["v2 unknown economic mode", 2, (c) => put(c, "paid-test", "economicMode")],
  ["v2 missing evidence mode", 2, (c) => drop(c, "evidenceMode")],
  ["v2 unknown evidence mode", 2, (c) => put(c, "mocked", "evidenceMode")],
  ["v2 carries the v1 mode field and no mode axes", 2, (c) => {
    drop(c, "economicMode");
    drop(c, "evidenceMode");
    c.mode = "fixture";
  }],
  ["v2 paid_test from a live environment", 2, (c) => {
    c.environment = "live";
    c.economicMode = "paid_test";
  }],
  ["v2 live money from a development environment", 2, (c) => put(c, "live", "economicMode")],
  ["v2 missing audience", 2, (c) => drop(c, "audience")],
  ["v2 missing issuer", 2, (c) => drop(c, "issuer")],
  ["v2 project ref missing", 2, (c) => drop(c, "project", "ref")],
  ["v2 project ref not kind-prefixed", 2, (c) => put(c, "evt_fx_1", "project", "ref")],
  ["v2 project ref names another kind", 2, (c) => put(c, "stub:evt_fx_1", "project", "ref")],
  ["v2 malformed project kind", 2, (c) => {
    c.project = { kind: "wall", id: "evt_fx_1", ref: "wall:evt_fx_1" };
  }],
  ["v2 malformed project id", 2, (c) => {
    c.project = { kind: "event", id: "a b", ref: "event:a b" };
  }],
  ["v2 missing issuedAt", 2, (c) => drop(c, "issuedAt")],
  ["v2 finance grant held by a guest", 2, (c) => {
    c.actor = { kind: "guest", id: "guest:fxguest0000000001" };
    c.tenant = { id: "guest:fxguest0000000001" };
    c.capabilities = [...c.capabilities, "finance.read"];
  }],
  ["v2 finance grant not in the grant list", 2, (c) => put(c, [...c.capabilities, "finance.command.delete_everything"], "capabilities")],
];

/** The malformed contexts, ready to sign: [{ name, schema, ctx }]. */
export function malformedContexts() {
  return MALFORMED.map(([name, schema, mutate]) => {
    const ctx = structuredClone(schema === 1 ? v1Base() : v2Base());
    mutate(ctx);
    return { name, schema: schema === 1 ? CONTEXT_SCHEMA : CONTEXT_SCHEMA_V2, ctx };
  });
}
