# Event intelligence: what the studio built, and how your module replaces it

For the event-intelligence owner. The studio's `/api/research` now looks Ticketmaster and Live Nation links up through the Ticketmaster Discovery API v2 and returns the result in your `EventIntelligencePackage` shape, next to the EventData the studio already uses. Nothing here is a canonical schema; it follows the only concrete target that exists today (see "Which shape we matched").

## What we built

| Piece | File |
| --- | --- |
| URL parser, bounded Discovery fetch, mapper to `EventData` + `Fact` | `src/customer/studio/research/ticketmaster.ts` |
| Package builder (`EventIntelligencePackage` 1.1) | `src/customer/studio/research/ticketmasterPackage.ts` |
| Route wiring and fallbacks | `src/app/api/research/route.ts` |
| Smoke test on a saved sample response | `scripts/smoke-ticketmaster.mjs`, `scripts/fixtures/ticketmaster-discovery-event.json` |

Run the smoke test with `node scripts/smoke-ticketmaster.mjs`. It needs no key and no network. The sample is written from the documented Discovery schema; no live key has been used yet, so the live path is untested against the real API.

### Behaviour

- **Key:** `TICKETMASTER_API_KEY` only. No OAuth. The key never leaves the server, and `sourceUrl` is always the public event URL, never the API URL.
- **Which links:** any `ticketmaster.<tld>` or `livenation.<tld>` host (`.com`, `.co.uk`, `.ca`, `.ie`, `.com.au`, ...). Id forms read: `/<slug>/event/<id>`, `/event/<id>`, `/event/<id>/<slug>`, `/event/<slug>-<id>`. An id needs at least one digit, so a one-word slug is not mistaken for an id.
- **Lookup order:** `GET /discovery/v2/events/{id}.json`; then the search `id` filter (URL ids are often legacy source ids, not Discovery ids); then, for slug-only links, a keyword search with `localStartDateTime` when the slug carries an unambiguous date. A keyword hit must share at least half of the slug words with the event or attraction name, and its facts carry lower confidence (0.7 with a date, 0.55 without).
- **Bounds:** 8 s timeout, 1.5 MB response cap, one to three requests per lookup.
- **Fallbacks, never a crash:** no key, 401/403, 429, other HTTP errors, timeouts and unreadable bodies all fall back to the existing page parse. If the page cannot be read either (Ticketmaster often refuses bots), the title comes from the slug and date and venue are `pending` ("Not known yet"). The response always says what happened in the `ticketmaster` field.

### Response (additive fields)

```jsonc
{
  // ...EventData exactly as before (type, title, subtitle, venue, city, dateISO, sourceUrl, facts)...
  "ticketmaster": {
    "status": "ok",                 // "ok" | "skipped" (no key) | "error" (API failed, 429 included)
    "eventId": "vvG1ZZ0Sample1Aa",
    "matchedBy": "id",              // "id" | "keyword"
    "retrievedAt": "2026-10-10T12:00:00.000Z",
    "image": { "url": "https://...", "ratio": "16_9", "width": 2048, "height": 1152, "fallback": false, "attribution": "..." }
    // on skipped/error instead: "reason": "no-api-key" | "rate-limited" | "bad-api-key" | "not-found" | "timeout" | "api-error" | "bad-response", "message": "..."
  },
  "eventIntelligencePackage": { /* only when status is "ok"; see below */ }
}
```

`seat` is never set; Discovery does not know it, so the fan fills it in.

### Studio fact mapping

Every fact is `provenance: "live"`, `source: "Ticketmaster"`, `sourceUrl` = the event URL, with a confidence (0.95 by id; price is capped at 0.8). Unknown ones are `pending`, value "Not known yet".

| Studio fact id | Discovery field | Notes |
| --- | --- | --- |
| `date` | `dates.start.localDate` | pending when `dateTBD` or `dateTBA` |
| `time` | `dates.start.localTime`, `dates.timezone` | pending when `timeTBA` or `noSpecificTime` |
| `venue` | `_embedded.venues[0].name`, `city.name`, `country.name` | pending when absent |
| `lineup` | `_embedded.attractions[1..]` | supporting acts; the first attraction becomes the title for concerts |
| `genre` | `classifications[primary].segment/genre` | |
| `status` | `dates.status.code` | only for cancelled, postponed or rescheduled |
| `price` | `priceRanges[0]` | only when present |

`EventData.type` comes from `classifications[].segment.name`: Music is `concert`, Sports is `game`, Arts & Theatre is `show`, anything else is `generic`. The image is the widest non-fallback `ratio: "16_9"` entry from `images[]`, forced to https. Its `attribution` is kept so whatever shows the image can credit it. It is a candidate only: Discovery data does not grant permission to reproduce the image on a printed product.

## Which shape we matched

Your `main` and the `impl/ei-*` branches do not define an `EventIntelligencePackage` wire schema. `docs/contracts/research-contract-handoff.md` says so explicitly, and the shared-contracts catalog lists it only as a proposed contract with a common envelope. The one concrete shape is the creative-engine proposal at commit `65b8036194b3b962e1fd34f7193d54791cf07c88` (`src/contracts/creative/v1.d.mts`, normalized `schema_version` `"1.1"`), which your handoff doc names as "a useful compatibility target". We matched that, and we ran our output through that commit's `validateResearchPackage` and `assessResearchReadiness` (result: valid, `ready`). Key names for facts reuse your review-history fields where they exist: `event_name`, `event_date`, `venue`, `event_status`.

If your canonical schema lands differently, only `ticketmasterPackage.ts` changes.

## Package mapping

| Package field | Value we send | Real or placeholder |
| --- | --- | --- |
| `contract` | `"EventIntelligencePackage"` | real |
| `schema_version` | `"1.1"` | real (constant `PACKAGE_SCHEMA_VERSION`) |
| `event_id` | `ticketstub-research-<16 hex>`, a hash of package id and retrieval time | real, stable for redelivery of the same observation |
| `tenant_id` | `placeholder-tenant` | **placeholder**: the studio has no tenant concept yet |
| `project_id` | `placeholder-project` | **placeholder** |
| `correlation_id` | `placeholder-correlation` | **placeholder** |
| `producer` | `getticketstub-research/ticketmaster-discovery-v2` | real (no build revision yet) |
| `occurred_at`, `ingested_at` | time of the Discovery response | real (the same instant, because we ingest as we fetch) |
| `environment` | `production` when `NODE_ENV` is production, else `development` | real |
| `billing_mode` | `"live"` | real (Discovery is a live, unbilled call) |
| `source_refs` | `["source:ticketmaster-event-<id>"]` | real |
| `package_id` | `tm-<event id>` | real |
| `source_identity[0]` | `source_id: ticketmaster-event-<id>`, `uri` = event URL, `retrieved_at`, `content_hash` = `sha256:` of the raw response body | real |
| `facts[]` | see below | real |
| `assets` | `absent`, or `unknown` when an image candidate exists; `items` always `[]` | real |
| `permissions` | `unknown`, `items: []` | real: public discovery does not establish reproduction permission |
| `preferences`, `interpretations`, `locks` | `absent`, `items: []` | real |

The three placeholders are also listed in the additive top-level field `ticketstub_placeholders`, so a consumer can refuse or overwrite them. Workflow, run, order and attempt ids are omitted, as the catalog asks for unavailable ids.

Facts (`status` is `verified` with a `value`, or `unknown` with no value and an empty `provenance`; each fact also carries an additive `confidence`):

| `key` | Discovery path (used as `evidence_ref` after `source:<source_id>#`) |
| --- | --- |
| `event_name` | `/name` |
| `event_date` | `/dates/start/localDate` |
| `event_start_time` | `/dates/start/localTime` |
| `event_timezone` | `/dates/timezone` |
| `venue`, `venue_city`, `venue_country` | `/_embedded/venues/0/name`, `.../city/name`, `.../country/name` |
| `venue_location` | `/_embedded/venues/0/location`, a `{latitude, longitude}` object, present only when both exist |
| `headliner` | `/_embedded/attractions/0/name` |
| `supporting_acts` | `/_embedded/attractions`, an array of names |
| `event_segment`, `event_genre` | `/classifications/0/segment/name`, `.../genre/name` |
| `event_status` | `/dates/status/code` |
| `price_range` | `/priceRanges/0`, only when present |

Two additive top-level fields go beyond schema 1.1; the schema's open shape allows them:

- `ticketstub_placeholders`, described above.
- `ticketstub_asset_candidates`: `{ url, ratio, width, height, attribution, fallback, source_id }`. These are not package assets, because no image bytes were fetched, so there is no `content_hash` to bind, and `permissions` stays `unknown`. Your safe-asset flow should fetch, hash and permission-check an image before it becomes a real asset.

## How your module replaces ours

1. Keep the route and the studio untouched. In `src/app/api/research/route.ts`, `finishTicketmaster` and the page-parse path are the only producers.
2. Call your engine for every research request, not only Ticketmaster links, with the trusted tenant and project from the session. Fill `tenant_id`, `project_id` and `correlation_id` with real values; the placeholders then disappear.
3. Return your package in `eventIntelligencePackage`, and derive `EventData` and its `facts` from the package, one studio fact per package fact. The mapping table above is the inverse of that: `event_date` to `date`, `venue` to `venue`, `supporting_acts` to `lineup`, and so on. Package `unknown` becomes studio `pending`. `provenance` maps from your evidence status: sourced to `live`, inferred to `estimated`, nothing found to `pending`.
4. Delete `ticketmaster.ts` and `ticketmasterPackage.ts`, or keep `parseTicketmasterUrl` and `lookupTicketmaster` as a Discovery source adapter feeding your evidence store. `lookupTicketmaster` already returns the raw response text (`rawText`) and `retrievedAt` for evidence ingestion.
5. Keep the `ticketmaster` status field, or replace it with your typed errors (`UNSUPPORTED_SCHEMA` and so on). The client only reads the studio fields today.
6. Update `scripts/smoke-ticketmaster.mjs` to feed the saved sample through your engine and compare the package.

## Open points

- Discovery ids and the ids in ticketmaster.com URLs are not always the same. The id-filter fallback is our best guess at resolving legacy ids; verify it with a real key.
- The documented swagger lists `dates.start.localTime` as an object, while the live API returns an `HH:MM:SS` string. The mapper accepts both.
- The swagger's event response does not list `priceRanges`; the mapper reads `priceRanges[].{type,currency,min,max}` from the field the live API is known to send, and treats it as optional.
- Rate limits: the default Discovery quota is 5,000 calls per day and 5 per second. Each research request costs one to three calls and nothing is cached yet. Your cache layer is the natural place for that.
