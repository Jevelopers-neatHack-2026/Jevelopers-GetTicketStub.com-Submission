// Ticketmaster facts in event-intelligence's EventIntelligencePackage shape (schema_version 1.1, the normalized
// shape in creative-engine@65b8036 src/contracts/creative/v1.d.mts). Additive: the route returns it next to EventData
// so the event-intelligence module can replace this producer later. See docs/integration/event-intelligence.md.
import { createHash } from "node:crypto";
import type { TmFields, TmLookupOk } from "./ticketmaster";

export const PACKAGE_SCHEMA_VERSION = "1.1";
export const PRODUCER = "getticketstub-research/ticketmaster-discovery-v2";

/** Envelope values the studio cannot know yet. They are fabricated stand-ins, listed in `ticketstub_placeholders`. */
export const PLACEHOLDER = {
  tenant_id: "placeholder-tenant",
  project_id: "placeholder-project",
  correlation_id: "placeholder-correlation",
} as const;

export type PackageFactStatus = "verified" | "conflicting" | "unknown";

export interface PackageFact {
  fact_id: string;
  key: string;
  status: PackageFactStatus;
  value?: unknown;
  provenance: { source_id: string; retrieved_at: string; evidence_ref?: string }[];
  /** Additive (allowed by the schema's open fact shape): 0..1, same number the studio Fact carries. */
  confidence: number;
}

export interface EventIntelligencePackage {
  contract: "EventIntelligencePackage";
  schema_version: typeof PACKAGE_SCHEMA_VERSION;
  event_id: string;
  tenant_id: string;
  project_id: string;
  correlation_id: string;
  producer: string;
  occurred_at: string;
  ingested_at: string;
  environment: "development" | "test" | "production";
  billing_mode: "live" | "sandbox" | "simulated";
  source_refs: string[];
  package_id: string;
  source_identity: { source_id: string; uri: string; retrieved_at: string; content_hash: string }[];
  facts: PackageFact[];
  assets: { presence: "absent" | "unknown"; items: [] };
  preferences: { presence: "absent"; items: [] };
  interpretations: { presence: "absent"; items: [] };
  permissions: { presence: "unknown"; items: [] };
  locks: { presence: "absent"; items: [] };
  /** Additive. Names every envelope field above that holds a placeholder rather than a real id. */
  ticketstub_placeholders: string[];
  /** Additive. Image candidates are NOT package assets: no bytes were fetched, so no content_hash exists, and
   *  public Discovery data does not grant reproduction permission (permissions stays "unknown"). */
  ticketstub_asset_candidates: { url: string; ratio?: string; width?: number; height?: number; attribution?: string; fallback: boolean; source_id: string }[];
}

const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

export function buildEventIntelligencePackage(lookup: TmLookupOk, opts: { environment?: EventIntelligencePackage["environment"] } = {}): EventIntelligencePackage {
  const f: TmFields = lookup.fields;
  const sourceId = `ticketmaster-event-${lookup.eventId}`;
  const retrievedAt = lookup.retrievedAt;
  // A keyword match is a guess, so every fact is as unsure as the studio's own facts say.
  const confidence = lookup.matchedBy === "keyword" ? 0.6 : 0.95;
  const ref = (pointer: string) => `source:${sourceId}#${pointer}`;

  const facts: PackageFact[] = [];
  const add = (key: string, value: unknown, pointer: string, c = confidence) => {
    const known = value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
    facts.push(
      known
        ? { fact_id: `tm-${key}`, key, status: "verified", value, provenance: [{ source_id: sourceId, retrieved_at: retrievedAt, evidence_ref: ref(pointer) }], confidence: c }
        : { fact_id: `tm-${key}`, key, status: "unknown", provenance: [], confidence: 0.2 },
    );
  };

  add("event_name", f.name, "/name");
  add("event_date", f.dateISO, "/dates/start/localDate");
  add("event_start_time", f.time, "/dates/start/localTime");
  add("event_timezone", f.timezone, "/dates/timezone");
  add("venue", f.venue, "/_embedded/venues/0/name");
  add("venue_city", f.city, "/_embedded/venues/0/city/name");
  add("venue_country", f.country, "/_embedded/venues/0/country/name");
  if (f.latitude != null && f.longitude != null) add("venue_location", { latitude: f.latitude, longitude: f.longitude }, "/_embedded/venues/0/location");
  add("headliner", f.headliner, "/_embedded/attractions/0/name");
  add("supporting_acts", f.supporting, "/_embedded/attractions");
  add("event_segment", f.segment, "/classifications/0/segment/name");
  add("event_genre", f.genre, "/classifications/0/genre/name");
  add("event_status", f.statusCode, "/dates/status/code");
  // Price ranges only when Discovery sent them; absence is not an "unknown" worth printing.
  if (f.price) add("price_range", f.price, "/priceRanges/0", Math.min(confidence, 0.8));

  const now = lookup.retrievedAt;
  const packageId = `tm-${lookup.eventId}`;
  const eventId = `ticketstub-research-${createHash("sha256").update(`${packageId}|${retrievedAt}`).digest("hex").slice(0, 16)}`;

  return {
    contract: "EventIntelligencePackage",
    schema_version: PACKAGE_SCHEMA_VERSION,
    event_id: eventId,
    ...PLACEHOLDER,
    producer: PRODUCER,
    occurred_at: retrievedAt,
    ingested_at: now,
    environment: opts.environment ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
    billing_mode: "live",
    source_refs: [`source:${sourceId}`],
    package_id: packageId,
    source_identity: [{ source_id: sourceId, uri: lookup.sourceUrl, retrieved_at: retrievedAt, content_hash: sha256(lookup.rawText) }],
    facts,
    assets: { presence: lookup.image ? "unknown" : "absent", items: [] },
    preferences: { presence: "absent", items: [] },
    interpretations: { presence: "absent", items: [] },
    permissions: { presence: "unknown", items: [] },
    locks: { presence: "absent", items: [] },
    ticketstub_placeholders: ["tenant_id", "project_id", "correlation_id"],
    ticketstub_asset_candidates: lookup.image
      ? [{ url: lookup.image.url, ratio: lookup.image.ratio, width: lookup.image.width, height: lookup.image.height, attribution: lookup.image.attribution, fallback: lookup.image.fallback, source_id: sourceId }]
      : [],
  };
}
