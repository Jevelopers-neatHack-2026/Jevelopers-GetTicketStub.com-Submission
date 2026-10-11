import { getRequestContext, requireCapability } from "@/server/context";
import { recordEvent } from "@/server/event-log";
import { CLIENT_EVENT_TYPES, EVENT_SCHEMA, ringEvents, refOf, type EventType, type StoredEvent } from "@/server/events";
import { HttpError, checkOrigin, clientIp, isObject, json, limit, notFound, readJson, route } from "@/server/http";
import { getStorage, storageAvailable } from "@/server/index";

// GET /api/events?project=stub:<id> (or event:<id>): the safe history of one project, for its owner (a stub's
// owner, an organizer event's captain). A project the caller can't see is a 404, as if it did not exist.
// GET /api/events?scope=all: every event, newest first, for staff (the admin.view capability); anyone else gets a 404.
// Every event is already sanitized: hashes, codes, counts and timestamps only. See src/server/events.ts.
const PAGE = 200;
const PROJECT = /^(?:(stub|event):)?([\w.:-]{1,128})$/;
const REF_FIELDS = new Set(["fact", "version"]);

export const GET = route(async (req: Request) => {
  const q = new URL(req.url).searchParams;
  if (q.get("scope") === "all") {
    const ctx = await getRequestContext(req);
    requireCapability(ctx, "admin.view");
    const stored = storageAvailable() ? await getStorage().listEvents({ limit: PAGE }) : [];
    return json({ schema: EVENT_SCHEMA, scope: "all", events: merge(stored) });
  }
  const m = PROJECT.exec(q.get("project") ?? "");
  if (!m) throw notFound();
  const project = { kind: (m[1] ?? "stub") as "stub" | "event", id: m[2] };
  const ctx = await getRequestContext(req, project);
  requireCapability(ctx, project.kind === "stub" ? "stub.read" : "event.read");
  const projectRef = refOf(project.id);
  const stored = storageAvailable() ? await getStorage().listEvents({ projectRef, limit: PAGE }) : [];
  // Not the tenant ref: an owner sees what happened to their project, not the rest of the account.
  return json({ schema: EVENT_SCHEMA, project: { kind: project.kind, ref: projectRef }, events: merge(stored, projectRef) });
});

/** Stored rows plus the in-memory ring (events from while storage was down), newest first, without internal refs. */
function merge(stored: StoredEvent[], projectRef?: string) {
  const ring = ringEvents().filter((e) => !projectRef || e.projectRef === projectRef);
  return [...stored, ...ring]
    .sort((a, b) => b.at - a.at)
    .slice(0, PAGE)
    .map((e) => ({ schema: e.schema, type: e.type, at: e.at, requestId: e.requestId, actor: e.actor, ...(e.projectRef ? { projectRef: e.projectRef } : {}), mode: e.mode, fields: e.fields }));
}

// The browser reports the two things only it can see: a version chosen, a fact corrected. The body is
// { type, project?, fields }, `project` being the stub id and ref fields (fact, version) raw ids that the
// server hashes. Anything outside the taxonomy for that type is dropped by the sanitizer.
export const POST = route(async (req: Request) => {
  checkOrigin(req);
  limit(`events:ip:${clientIp(req)}`, 120, 15 * 60_000);
  const body = await readJson(req, 2048);
  if (!isObject(body) || typeof body.type !== "string" || !CLIENT_EVENT_TYPES.includes(body.type as EventType)) {
    throw new HttpError(400, "bad_request", "Send { type, project, fields }.");
  }
  const project = typeof body.project === "string" && /^[\w.:-]{1,128}$/.test(body.project) ? body.project : undefined;
  const ctx = await getRequestContext(req, project ? { kind: "stub", id: project } : undefined);
  if (project && ctx.role === "none") throw notFound(); // only the owner's own project can collect events
  const fields: Record<string, unknown> = {};
  if (isObject(body.fields)) {
    for (const [k, v] of Object.entries(body.fields)) fields[k] = REF_FIELDS.has(k) && typeof v === "string" && /^[\w.:-]{1,128}$/.test(v) ? refOf(v) : v;
  }
  await recordEvent(req, body.type as EventType, fields as Record<string, never>, { project, ctx });
  return json({ ok: true });
});
