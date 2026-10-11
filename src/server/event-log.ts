import "server-only";
import { getRequestContext, type RequestContext } from "./context";
import { EVENT_SPEC, pushRing, refOf, requestIdOf, sanitizeEvent, type EventType, type EventValue } from "./events";
import { getStorage, storageAvailable } from "./index";

// Recording is a side effect of a request, never a reason for it to fail: any trouble is swallowed after one
// log line that carries no payload. The event is built by the sanitizer in events.ts, so a caller cannot
// put anything outside the taxonomy into it.

interface Opts {
  /** An id (stub or organizer event) this event concerns. Stored as a hash. */
  project?: string;
  /** Overrides the actor: for events where the caller has just become someone (sign-in). */
  account?: string;
  /** A context the route already has, to save a lookup. */
  ctx?: RequestContext;
}

export async function recordEvent(req: Request, type: EventType, fields: Record<string, EventValue | undefined> = {}, opts: Opts = {}): Promise<void> {
  try {
    const ctx = opts.account ? undefined : (opts.ctx ?? (await getRequestContext(req)));
    const tenant = opts.account ?? ctx?.tenant.id;
    const kind = opts.account ? "account" : ctx?.actor.kind;
    const ev = sanitizeEvent({
      type,
      requestId: requestIdOf(req.headers),
      actor: kind,
      actorRef: kind && kind !== "anonymous" && tenant ? refOf(tenant) : undefined,
      projectRef: opts.project ? refOf(opts.project) : undefined,
      mode: process.env.TICKETSTUB_RUNTIME_MODE === "live" ? "live" : "sandbox",
      fields,
    });
    if (!ev) return;
    const tenantRef = tenant && kind !== "anonymous" ? refOf(tenant) : undefined;
    if (storageAvailable()) {
      try {
        await getStorage().appendEvent(ev, tenantRef);
        return;
      } catch {
        /* fall through to the ring */
      }
    }
    pushRing(ev, tenantRef);
  } catch {
    console.warn(`[events] could not record ${EVENT_SPEC[type] ? type : "event"}`);
  }
}
