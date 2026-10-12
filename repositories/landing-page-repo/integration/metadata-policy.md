# Actual-page metadata baseline (LP-08 draft)

Scope: the existing `site/index.html` homepage `/` from base `6d47c94` (full base in the PR receipt), aligned with [site-map.md](site-map.md). Section anchors and `/index.html` are not additional indexable pages; no app/account/private route belongs in this inventory. This is a local draft baseline, not release acceptance or hosting authorization. Product/marketing copy, LP-06 social asset rights, app-owner origin/indexing and host integration remain pending.

## Static source and inventory

The title, description, language, OG type/title/description and Twitter summary/title/description exist in the actual HTML head before body. The premature head/body boundary was moved after the existing stylesheet; styles, illustrations, scripts, motion and scroll behavior retain their bytes. `src/content/metadata.json` records the policy; `src/content/copy.json` records each reused or proposed metadata value as `PENDING` with immutable base provenance. The base supplies existing identity/description; technical metadata fields are explicitly a new author proposal, not facts reviewed at that base. Both whole-page review hashes were refreshed; the visible-text hash is unchanged.

| Field | Current preview decision | Production prerequisite |
|---|---|---|
| Route/language | `/`, `en` | Confirm actual homepage mount with app owner |
| Title | `getticketstub.com` (existing draft identity) | Product/marketing approval; text is not origin evidence |
| Description and social descriptions | Existing illustrative digital preview copy; physical printing, prices and delivery pending | Product/marketing approval tied to demonstrated behavior |
| Robots meta | `noindex,nofollow` | Approved `index` or `noindex` decision |
| OG/Twitter | Text-only website/summary, matching title and description | Brand/marketing review of copy and fallback |
| Canonical / `og:url` | Omitted; no public origin supplied | Exact HTTPS production origin and app-owner receipt |
| Social image / dimensions / alt | Omitted pending publication rights and approved art, alt, dimensions and asset origin | LP-06/LP-04 permission receipt and local/host asset validation |
| Structured data | Explicitly omitted: provisional visible content adds no supported production facts | Owner review of omission or evidence-backed schema; no invented offers, reviews, ratings, awards or endorsements |
| Sitemap | Omitted: no actual indexable route in preview | Only approved indexable `/`; no anchors, aliases or app/private paths |

Image rendering, dimensions, alt text and card screenshot are **not validated** by a text-only fallback. Existing illustration assets are retained without inventing a publishable social image. LP-08.C remains incomplete. JSON-LD omission is intentional; no commerce, rating or organization facts are fabricated.

## Environment contract and fixtures

`environmentOutput` in `scripts/suites/metadata.mjs` is an offline policy evaluator for the actual metadata suite and synthetic production/preview/demo/staging fixtures. The existing build remains a byte-identical static copy: this evaluator does **not** rewrite HTML, publish, emit robots/sitemap files into `dist`, or enable production from a shell variable. Draft source is explicitly `preview`; all three nonproduction environments require `noindex,nofollow`, no canonical, no `og:url` and no sitemap, even when a production fixture exists.

Production policy evaluation requires an exact HTTPS origin, an explicit indexing choice and separate pinned owner receipts for origin, indexing, copy, social fallback and structured-data omission. Reject credentials, query/fragment/path/port, local/IP/private hosts, known preview hosts and nonproduction labels. Test origin `https://public.example.org` and `SYNTHETIC_OWNER_FIXTURE` receipts are synthetic fixtures, never real owner approvals or proposed domains. `/` is the only route admitted by the fixture evaluator.

Approved index fixtures yield canonical/OG URL `<approved origin>/`, `index,follow`, robots guidance allowing `/` with the matching sitemap URL, and one sitemap homepage entry. Approved noindex fixtures yield `noindex,nofollow`, no sitemap, and robots guidance `Disallow: /`. These outputs are tested strings for the host handoff, not deployed files. Robots/sitemaps are indexing guidance, **not access control**; the host still owns authentication and route isolation. Keeping a preview private requires host access controls.

The app/hosting owner under GT-01 #7 must supply origin and route-boundary receipts and agree how the static head and any robots/sitemap are integrated. Production source generation/adapter and real host validation remain required work after those receipts exist. The suite deliberately cannot promote the current preview artifact to a public release merely because a synthetic fixture passes. No hosting, cross-repo, settings or central acceptance state changes are made here.

## Executable evidence and remaining gates

Run with pinned Node 24.15.0 and no package/provider install:

```sh
./scripts/validate-landing --suite metadata --mode draft
./scripts/validate-landing --suite metadata
node --test tests/metadata.test.mjs
./scripts/validate-landing --suite content --mode draft
./scripts/validate-landing --suite proof --mode draft
./scripts/validate-landing --suite foundation
node --test tests/scroll.test.mjs
```

Draft metadata returns `PASS_DRAFT` only after validating both source and built static HTML, copy inventory/hash and negative fixtures. Default release must fail because production origin/owner receipts and actual integration are pending. Tests cover missing/duplicate/out-of-head fields, canonical/preview leakage, unsupported image/structured output, unknown environments, private routes and invalid production origins/receipts. Loopback HTTP verifies static served metadata and 404s for sitemap/robots/private routes. Any required missing suite in the shared dispatcher continues to fail; a local metadata pass grants no release exemption.

Local head/HTTP checks cannot establish an external social card renderer, crawler indexing, public image render or production host behavior. Required closure evidence still includes named owner receipts, approved publishable assets or accepted fallback, production adapter/source and host checks, source/head capture, social preview screenshot and final structured-data decision. LP-08.A/B/C/D and EVAL-03/EVAL-04 remain partial/pending, not centrally passed by this draft.
