// Browser-side calls to the research, art and agent routes. Errors carry user-facing copy.
import type { ArtLayer, EventData, Stub } from "../types";
import { currentVersion } from "../types";

const READ_ERROR = "We couldn't read that link.";

async function postJson<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("You look offline. Check your connection and try again.");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(fallbackError);
  }
  if (!res.ok || (data && typeof data === "object" && "error" in data)) {
    const msg = (data as { error?: unknown })?.error;
    throw new Error(typeof msg === "string" && msg ? msg : fallbackError);
  }
  return data as T;
}

const EVENT_KEYS: (keyof EventData)[] = ["type", "title", "subtitle", "venue", "city", "dateISO", "seat", "sourceUrl", "setlist", "score", "cast", "programme", "facts", "assets"];

/** Only the EventData fields: the route also returns research extras that must not be saved into (and synced with) a stub. */
export function pickEvent(data: EventData): EventData {
  const out: Record<string, unknown> = {};
  for (const k of EVENT_KEYS) if (data[k] !== undefined) out[k] = data[k];
  const event = out as unknown as EventData;
  // The route's extras say when a source was read and whether it sent an image. Keep those two things, honestly.
  const tm = (data as EventData & { ticketmaster?: { retrievedAt?: string; image?: { url?: string } } }).ticketmaster;
  if (tm?.retrievedAt) {
    event.facts = event.facts.map((f) => (f.retrievedAt || f.provenance === "pending" || !/ticketmaster/i.test(f.source) ? f : { ...f, retrievedAt: tm.retrievedAt }));
  }
  if (tm?.image?.url && !event.assets?.length) {
    event.assets = [
      {
        id: "ticketmaster-image",
        label: "Event image from Ticketmaster",
        sourceUrl: tm.image.url,
        status: "unknown",
        reason: "We can't confirm we have the right to print Ticketmaster's image, so it stays off your stub. The art is made from your facts instead.",
      },
    ];
  }
  return event;
}

/** Research one event from a link (or a demo keyword). Throws Error(message) on failure. */
export async function researchEvent(input: { url?: string; query?: string }): Promise<EventData> {
  if (input.url && input.url.trim()) {
    return pickEvent(await postJson<EventData>("/api/research", { url: input.url.trim() }, READ_ERROR));
  }
  if (input.query && input.query.trim()) {
    const results = await searchEvents(input.query);
    if (!results[0]) throw new Error("We couldn't find that show. Try the artist, team or venue name.");
    return results[0];
  }
  throw new Error("Paste a link or search for your show.");
}

/** Search fallback. Results are demo events, labelled simulated. */
export async function searchEvents(query: string): Promise<EventData[]> {
  const data = await postJson<{ results?: EventData[] }>("/api/research", { query }, "Search is unavailable right now. Try again in a moment.");
  return Array.isArray(data.results) ? data.results.map(pickEvent) : [];
}

/** Shown when the daily art cap is reached. The art that comes back with it is procedural, so nothing breaks. */
export const ART_LIMIT_NOTE = "You've made a lot of art today. Procedural art still works, and new art comes back tomorrow.";

export interface RemixResult {
  art: ArtLayer;
  /** Set when the daily cap was reached and `art` is the procedural fallback. */
  limitNote?: string;
  /** Epoch ms when new art is available again. */
  retryAt?: number;
}

/** Remix the art layer for a stub, and say so when the daily cap turned it into procedural art. */
export async function remixArtNoted(stub: Stub, vibe?: string): Promise<RemixResult> {
  const v = currentVersion(stub);
  const seed = Math.floor(Math.random() * 2_147_483_647);
  let res: Response;
  try {
    res = await fetch("/api/art", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: stub.event, vibe, seed, edition: v?.edition, first: false }),
    });
  } catch {
    throw new Error("You look offline. Check your connection and try again.");
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error("We couldn't remix the art. Try again in a moment.");
  }
  if (res.status === 429 && (data as { error?: { code?: string } })?.error?.code === "art_limit") {
    const d = data as { art?: ArtLayer; retryAt?: number };
    const art: ArtLayer = d.art?.kind === "procedural" ? d.art : { kind: "procedural", seed, vibe, provenance: "simulated" };
    return { art, limitNote: ART_LIMIT_NOTE, retryAt: d.retryAt };
  }
  if (!res.ok || (data && typeof data === "object" && "error" in data)) {
    const msg = (data as { error?: unknown })?.error;
    throw new Error(typeof msg === "string" && msg ? msg : "We couldn't remix the art. Try again in a moment.");
  }
  return { art: data as ArtLayer };
}

/** Remix the art layer for a stub. The caller pushes it as a new DesignVersion. */
export async function remixArt(stub: Stub, vibe?: string): Promise<ArtLayer> {
  return (await remixArtNoted(stub, vibe)).art;
}

/** Optional server agent reply. Returns undefined when no model is configured (caller falls back to rules). */
export async function askAgent(stub: Stub, message: string): Promise<{ reply: string; provenance: "live" } | undefined> {
  let res: Response;
  try {
    res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: stub.event, message }),
    });
  } catch {
    throw new Error("You look offline. Check your connection and try again.");
  }
  if (res.status === 204) return undefined;
  const data = await res.json() as { reply?: string; provenance?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "The agent is unavailable. Try again in a moment.");
  return data.reply && data.provenance === "live" ? { reply: data.reply, provenance: "live" } : undefined;
}
