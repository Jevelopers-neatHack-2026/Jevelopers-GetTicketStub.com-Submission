// Ticketmaster Discovery API v2 lookup: URL parsing, a bounded fetch, and the mapper into EventData + Fact.
// Server-side only (it holds the API key), but import-free at runtime so scripts/smoke-ticketmaster.mjs can run it directly.
// Field names follow https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/ (Get Event Details).
import type { EventData, EventType, Fact } from "../types";

const API = "https://app.ticketmaster.com/discovery/v2";
const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const SOURCE = "Ticketmaster";

// ---------- Discovery v2 response shapes (the parts we read; every field may be absent) ----------

export interface DiscoveryImage {
  url?: string;
  ratio?: "16_9" | "3_2" | "4_3" | string;
  width?: number;
  height?: number;
  fallback?: boolean;
  attribution?: string;
}

interface DiscoveryNamed {
  id?: string;
  name?: string;
}

export interface DiscoveryVenue {
  id?: string;
  name?: string;
  city?: { name?: string };
  state?: { name?: string; stateCode?: string };
  country?: { name?: string; countryCode?: string };
  location?: { latitude?: string | number; longitude?: string | number };
  timezone?: string;
}

export interface DiscoveryAttraction {
  id?: string;
  name?: string;
  classifications?: DiscoveryClassification[];
}

export interface DiscoveryClassification {
  primary?: boolean;
  segment?: DiscoveryNamed;
  genre?: DiscoveryNamed;
  subGenre?: DiscoveryNamed;
}

export interface DiscoveryEvent {
  id?: string;
  name?: string;
  url?: string;
  locale?: string;
  images?: DiscoveryImage[];
  dates?: {
    start?: {
      localDate?: string;
      localTime?: string | { hourOfDay?: number; minuteOfHour?: number };
      dateTime?: string;
      dateTBD?: boolean;
      dateTBA?: boolean;
      timeTBA?: boolean;
      noSpecificTime?: boolean;
    };
    timezone?: string;
    status?: { code?: string };
  };
  classifications?: DiscoveryClassification[];
  priceRanges?: { type?: string; currency?: string; min?: number; max?: number }[];
  _embedded?: { venues?: DiscoveryVenue[]; attractions?: DiscoveryAttraction[] };
}

// ---------- URL parsing ----------

export interface TicketmasterUrl {
  host: string;
  /** Discovery-style or legacy id taken from /event/<id> (either order). */
  id?: string;
  /** Human words from the slug, used for a keyword search when no id exists. */
  keyword?: string;
  /** yyyy-mm-dd when the slug carries an unambiguous date. */
  date?: string;
  url: string;
}

const HOST_RE = /(^|\.)(ticketmaster|livenation)\.[a-z]{2,}(\.[a-z]{2})?$/i;

export function isTicketmasterHost(hostname: string): boolean {
  return HOST_RE.test(hostname.toLowerCase());
}

const ID_RE = /^[A-Za-z0-9]{8,24}$/;
// A real id has a digit; this keeps one-word slugs like "thefirehouse" from being read as ids.
const looksLikeId = (s: string) => ID_RE.test(s) && /\d/.test(s);

function slugDate(slug: string): string | undefined {
  const iso = slug.match(/(?:^|-)(20\d{2})-(\d{2})-(\d{2})(?:-|$)/);
  if (iso && +iso[2] >= 1 && +iso[2] <= 12 && +iso[3] >= 1 && +iso[3] <= 31) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dm = slug.match(/(?:^|-)(\d{2})-(\d{2})-(20\d{2})(?:-|$)/);
  if (dm) {
    const a = +dm[1];
    const b = +dm[2];
    if (a > 12 && b >= 1 && b <= 12) return `${dm[3]}-${dm[2]}-${dm[1]}`; // dd-mm-yyyy
    if (b > 12 && a >= 1 && a <= 12) return `${dm[3]}-${dm[1]}-${dm[2]}`; // mm-dd-yyyy
  }
  return undefined;
}

function slugKeyword(slug: string): string | undefined {
  const words = slug
    .toLowerCase()
    .replace(/(?:^|-)(?:20\d{2}-\d{2}-\d{2}|\d{2}-\d{2}-20\d{2})(?:-|$)/g, "-")
    .split("-")
    .filter((w) => w && w !== "tickets" && w !== "ticket" && w !== "event" && !/^\d{5,}$/.test(w));
  const kw = words.join(" ").trim();
  return kw.length >= 3 ? kw : undefined;
}

/** Recognise a Ticketmaster / Live Nation event link. Returns undefined for anything else. */
export function parseTicketmasterUrl(input: URL | string): TicketmasterUrl | undefined {
  let u: URL;
  try {
    u = typeof input === "string" ? new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`) : input;
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(u.protocol) || !isTicketmasterHost(u.hostname)) return undefined;

  let segs: string[];
  try {
    segs = u.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  } catch {
    segs = u.pathname.split("/").filter(Boolean);
  }
  const out: TicketmasterUrl = { host: u.hostname.toLowerCase(), url: u.toString() };

  const ei = segs.findIndex((s) => /^events?$/i.test(s));
  // ticketmaster: /<slug>/event/<id>, /event/<id>; livenation: /event/<id>/<slug>, /event/<slug>-<id>; de/fr: /event/<slug>/<numeric id>
  const around = ei >= 0 ? [segs[ei + 1], segs[ei + 2], segs[ei - 1]] : segs;
  out.id = around.find((s): s is string => !!s && looksLikeId(s));
  if (!out.id && ei >= 0 && segs[ei + 1]) {
    const tail = segs[ei + 1].split("-").pop();
    if (tail && looksLikeId(tail)) out.id = tail; // /event/<slug>-<id>
  }

  const slug = segs.filter((s) => s.includes("-") && s !== out.id && !/^events?$/i.test(s)).sort((a, b) => b.length - a.length)[0];
  if (slug) {
    out.date = slugDate(slug);
    out.keyword = slugKeyword(slug);
  }
  return out;
}

// ---------- Bounded fetch ----------

export type TmFailure = "no-api-key" | "rate-limited" | "bad-api-key" | "not-found" | "timeout" | "api-error" | "bad-response";

async function boundedText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, MAX_BYTES);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type FetchImpl = typeof fetch;
interface RawResult {
  ok: boolean;
  failure?: TmFailure;
  status?: number;
  text?: string;
  json?: unknown;
}

async function discoveryGet(path: string, params: Record<string, string>, apiKey: string, fetchImpl: FetchImpl): Promise<RawResult> {
  const qs = new URLSearchParams({ ...params, apikey: apiKey });
  try {
    const res = await fetchImpl(`${API}/${path}?${qs}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 429) return { ok: false, failure: "rate-limited", status: 429 };
    if (res.status === 401 || res.status === 403) return { ok: false, failure: "bad-api-key", status: res.status };
    if (res.status === 404 || res.status === 400) return { ok: false, failure: "not-found", status: 404 };
    if (!res.ok) return { ok: false, failure: "api-error", status: res.status };
    const text = await boundedText(res);
    try {
      return { ok: true, status: res.status, text, json: JSON.parse(text) };
    } catch {
      return { ok: false, failure: "bad-response", status: res.status };
    }
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, failure: name === "TimeoutError" || name === "AbortError" ? "timeout" : "api-error" };
  }
}

// ---------- Mapping ----------

export interface TmImage {
  url: string;
  ratio?: string;
  width?: number;
  height?: number;
  fallback: boolean;
  /** Discovery's own attribution string when it sends one. Show it wherever the image is shown. */
  attribution?: string;
}

/** Best wide image: ratio 16_9, real (non-fallback) before fallback, then the largest width. */
export function pickImage(images: DiscoveryImage[] | undefined): TmImage | undefined {
  const wide = (images ?? []).filter((i) => typeof i.url === "string" && i.url && i.ratio === "16_9");
  if (!wide.length) return undefined;
  wide.sort((a, b) => Number(!!a.fallback) - Number(!!b.fallback) || (b.width ?? 0) - (a.width ?? 0));
  const best = wide[0];
  return {
    url: String(best.url).replace(/^http:\/\//i, "https://"),
    ratio: best.ratio,
    width: best.width,
    height: best.height,
    fallback: !!best.fallback,
    attribution: typeof best.attribution === "string" && best.attribution ? best.attribution : undefined,
  };
}

const SEGMENT_TYPE: Record<string, EventType> = {
  music: "concert",
  sports: "game",
  "arts & theatre": "show",
  "arts and theatre": "show",
};

export function typeFromSegment(segment: string | undefined): EventType {
  return SEGMENT_TYPE[(segment ?? "").trim().toLowerCase()] ?? "generic";
}

function localTime(t: unknown): string | undefined {
  if (typeof t === "string") return /^\d{2}:\d{2}/.test(t) ? t : undefined;
  const o = t as { hourOfDay?: number; minuteOfHour?: number } | null | undefined;
  if (o && typeof o === "object" && typeof o.hourOfDay === "number") return `${String(o.hourOfDay).padStart(2, "0")}:${String(o.minuteOfHour ?? 0).padStart(2, "0")}:00`;
  return undefined;
}

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export interface TmPrice {
  currency?: string;
  min?: number;
  max?: number;
  type?: string;
}

/** Everything we take from a Discovery event, normalised once and shared by the EventData and package mappers. */
export interface TmFields {
  id?: string;
  name: string;
  url?: string;
  dateISO?: string;
  dateTbd: boolean;
  time?: string; // HH:MM:SS local
  timeTba: boolean;
  timezone?: string;
  startUtc?: string;
  venue?: string;
  city?: string;
  country?: string;
  countryCode?: string;
  latitude?: number;
  longitude?: number;
  headliner?: string;
  supporting: string[];
  segment?: string;
  genre?: string;
  type: EventType;
  statusCode?: string;
  price?: TmPrice;
  image?: TmImage;
}

export function extractFields(ev: DiscoveryEvent): TmFields | undefined {
  const name = nonEmpty(ev.name);
  if (!name) return undefined;
  const start = ev.dates?.start;
  const venue = ev._embedded?.venues?.[0];
  const attractions = (ev._embedded?.attractions ?? []).map((a) => nonEmpty(a.name)).filter((x): x is string => !!x);
  const cls = ev.classifications?.find((c) => c.primary) ?? ev.classifications?.[0];
  const dateOk = !!start?.localDate && /^\d{4}-\d{2}-\d{2}$/.test(start.localDate) && !start.dateTBD && !start.dateTBA;
  const time = localTime(start?.localTime);
  const pr = ev.priceRanges?.find((p) => num(p.min) != null || num(p.max) != null);
  return {
    id: nonEmpty(ev.id),
    name,
    url: nonEmpty(ev.url) && /^https?:\/\//i.test(String(ev.url)) ? String(ev.url) : undefined,
    dateISO: dateOk ? start?.localDate : undefined,
    dateTbd: !dateOk,
    time: !start?.timeTBA && !start?.noSpecificTime ? time : undefined,
    timeTba: !!(start?.timeTBA || start?.noSpecificTime || !time),
    timezone: nonEmpty(ev.dates?.timezone) ?? nonEmpty(venue?.timezone),
    startUtc: nonEmpty(start?.dateTime),
    venue: nonEmpty(venue?.name),
    city: nonEmpty(venue?.city?.name),
    country: nonEmpty(venue?.country?.name),
    countryCode: nonEmpty(venue?.country?.countryCode),
    latitude: num(venue?.location?.latitude),
    longitude: num(venue?.location?.longitude),
    headliner: attractions[0],
    supporting: attractions.slice(1),
    segment: nonEmpty(cls?.segment?.name),
    genre: nonEmpty(cls?.genre?.name),
    type: typeFromSegment(cls?.segment?.name),
    statusCode: nonEmpty(ev.dates?.status?.code),
    price: pr ? { currency: nonEmpty(pr.currency), min: num(pr.min), max: num(pr.max), type: nonEmpty(pr.type) } : undefined,
    image: pickImage(ev.images),
  };
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function formatPrice(p: TmPrice): string {
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: p.currency ?? "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
    } catch {
      return `${p.currency ?? ""} ${n}`.trim();
    }
  };
  if (p.min != null && p.max != null && p.min !== p.max) return `${fmt(p.min)}–${fmt(p.max)}`;
  return fmt((p.min ?? p.max) as number);
}

const PENDING_VALUE = "Not known yet";
const PROBLEM_STATUS = new Set(["cancelled", "canceled", "postponed", "rescheduled"]);

/** Map one Discovery event to our EventData. `confidence` is lower when the event was found by keyword search. */
export function mapDiscoveryEvent(ev: DiscoveryEvent, ctx: { sourceUrl: string; confidence?: number }): { event: EventData; fields: TmFields } | undefined {
  const f = extractFields(ev);
  if (!f) return undefined;
  const url = f.url ?? ctx.sourceUrl;
  const c = ctx.confidence ?? 0.95;
  const base = { source: SOURCE, sourceUrl: url, provenance: "live" as const };
  const pending = (id: string, label: string): Fact => ({ id, label, value: PENDING_VALUE, source: SOURCE, sourceUrl: url, confidence: 0.2, provenance: "pending" });
  const facts: Fact[] = [];

  facts.push(f.dateISO ? { ...base, id: "date", label: shortDate(f.dateISO), value: f.dateISO, confidence: c, kept: true } : pending("date", "Date: pending"));
  if (f.time) {
    const hhmm = f.time.slice(0, 5);
    facts.push({ ...base, id: "time", label: hhmm, value: f.timezone ? `${hhmm} (${f.timezone})` : hhmm, confidence: c });
  } else {
    facts.push(pending("time", "Time: pending"));
  }
  facts.push(f.venue ? { ...base, id: "venue", label: f.venue, value: [f.venue, f.city, f.country].filter(Boolean).join(", "), confidence: c } : pending("venue", "Venue: pending"));
  if (f.supporting.length) {
    facts.push({ ...base, id: "lineup", label: f.supporting.slice(0, 3).join(" · "), value: [f.headliner, ...f.supporting].filter(Boolean).join(", "), confidence: c });
  }
  if (f.genre) facts.push({ ...base, id: "genre", label: f.genre, value: [f.segment, f.genre].filter(Boolean).join(" / "), confidence: c });
  if (f.statusCode && PROBLEM_STATUS.has(f.statusCode.toLowerCase())) {
    facts.push({ ...base, id: "status", label: f.statusCode.charAt(0).toUpperCase() + f.statusCode.slice(1).toLowerCase(), value: `Ticketmaster lists this event as ${f.statusCode}`, confidence: c });
  }
  if (f.price) {
    const label = formatPrice(f.price);
    facts.push({ ...base, id: "price", label, value: `${label} face value${f.price.type ? ` (${f.price.type})` : ""}`, confidence: Math.min(c, 0.8) });
  }

  const concertHeadliner = f.type === "concert" && f.headliner && f.headliner !== f.name;
  const event: EventData = {
    type: f.type,
    title: f.type === "concert" && f.headliner ? f.headliner : f.name,
    subtitle: concertHeadliner ? f.name : undefined,
    venue: f.venue,
    city: f.city,
    dateISO: f.dateISO,
    sourceUrl: url,
    facts,
  };
  return { event, fields: f };
}

// ---------- Lookup ----------

export interface TmLookupOk {
  status: "ok";
  eventId: string;
  event: EventData;
  fields: TmFields;
  image?: TmImage;
  retrievedAt: string;
  /** Raw Discovery response body, for the source content hash in the package. */
  rawText: string;
  matchedBy: "id" | "keyword";
  sourceUrl: string;
}
export interface TmLookupMiss {
  status: "skipped" | "error";
  reason: TmFailure;
  message: string;
}
export type TmLookup = TmLookupOk | TmLookupMiss;

const MESSAGES: Record<TmFailure, string> = {
  "no-api-key": "Ticketmaster lookup skipped: no TICKETMASTER_API_KEY is configured. Read the page instead.",
  "rate-limited": "Ticketmaster lookup skipped: rate limit reached (429). Read the page instead.",
  "bad-api-key": "Ticketmaster lookup skipped: the API key was rejected. Read the page instead.",
  "not-found": "Ticketmaster lookup found no matching event. Read the page instead.",
  timeout: "Ticketmaster lookup timed out. Read the page instead.",
  "api-error": "Ticketmaster lookup failed. Read the page instead.",
  "bad-response": "Ticketmaster sent a response we could not read. Read the page instead.",
};

const miss = (reason: TmFailure): TmLookupMiss => ({ status: reason === "no-api-key" ? "skipped" : "error", reason, message: MESSAGES[reason] });

function eventsOf(json: unknown): DiscoveryEvent[] {
  const list = (json as { _embedded?: { events?: unknown } } | null)?._embedded?.events;
  return Array.isArray(list) ? (list as DiscoveryEvent[]) : [];
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && t !== "tickets");

/**
 * Look an event up from a parsed Ticketmaster / Live Nation link. Never throws.
 * Order: events/{id}, then the id filter on search (legacy ids from the URL), then keyword (+ date) search from the slug.
 */
export async function lookupTicketmaster(
  link: TicketmasterUrl,
  opts: { apiKey?: string; fetchImpl?: FetchImpl; now?: () => Date } = {},
): Promise<TmLookup> {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) return miss("no-api-key");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  try {
    const done = (ev: DiscoveryEvent, raw: RawResult, matchedBy: "id" | "keyword", confidence: number): TmLookupOk | undefined => {
      const m = mapDiscoveryEvent(ev, { sourceUrl: link.url, confidence });
      if (!m) return undefined;
      return {
        status: "ok",
        eventId: m.fields.id ?? link.id ?? "unknown",
        event: m.event,
        fields: m.fields,
        image: m.fields.image,
        retrievedAt: now().toISOString(),
        rawText: raw.text ?? "",
        matchedBy,
        sourceUrl: m.event.sourceUrl ?? link.url,
      };
    };

    if (link.id) {
      const direct = await discoveryGet(`events/${encodeURIComponent(link.id)}.json`, {}, apiKey, fetchImpl);
      if (direct.ok) {
        const hit = done(direct.json as DiscoveryEvent, direct, "id", 0.95);
        if (hit) return hit;
      } else if (direct.failure && direct.failure !== "not-found") {
        return miss(direct.failure);
      }
      // URL ids are often legacy source ids, not Discovery ids: try the search id filter.
      const byId = await discoveryGet("events.json", { id: link.id, size: "1" }, apiKey, fetchImpl);
      if (byId.ok) {
        const ev = eventsOf(byId.json)[0];
        const hit = ev && done(ev, byId, "id", 0.95);
        if (hit) return hit;
      } else if (byId.failure && byId.failure !== "not-found") {
        return miss(byId.failure);
      }
    }

    if (link.keyword) {
      const params: Record<string, string> = { keyword: link.keyword, size: "5", sort: "date,asc" };
      if (link.date) params.localStartDateTime = `${link.date}T00:00:00,${link.date}T23:59:59`;
      const found = await discoveryGet("events.json", params, apiKey, fetchImpl);
      if (found.ok) {
        const want = tokens(link.keyword);
        const ranked = eventsOf(found.json)
          .map((ev) => {
            const hay = new Set(tokens(`${ev.name ?? ""} ${(ev._embedded?.attractions ?? []).map((a) => a.name ?? "").join(" ")}`));
            return { ev, overlap: want.length ? want.filter((t) => hay.has(t)).length / want.length : 0 };
          })
          .filter((x) => x.overlap >= 0.5)
          .sort((a, b) => b.overlap - a.overlap);
        const top = ranked[0];
        // A keyword match is a guess: lower confidence so the studio shows the facts as "unsure".
        const hit = top && done(top.ev, found, "keyword", link.date ? 0.7 : 0.55);
        if (hit) return hit;
      } else if (found.failure && found.failure !== "not-found") {
        return miss(found.failure);
      }
    }
    return miss("not-found");
  } catch {
    return miss("api-error");
  }
}
