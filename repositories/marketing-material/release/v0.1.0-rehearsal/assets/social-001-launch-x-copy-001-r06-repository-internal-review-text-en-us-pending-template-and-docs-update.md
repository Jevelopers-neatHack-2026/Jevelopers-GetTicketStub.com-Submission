# Announcement copy — editable draft set

**Assets:** `LAUNCH-X-COPY-001`, `LAUNCH-X-CTA-001` · **Families:** `FAM-ANNOUNCEMENT-001`, `FAM-SOCIAL-001`
**Status:** draft only. No automatic posting, scheduling, external submission, or approval is recorded.

## A. Required official X quote-post — field template

The organizer's current requirement is one public quote-post of its official neatlogs submission post, carrying the team, name, project, public repository, and demo link; the owner's issue 22 entry-contents list also requires the business plan to be included. The official page checked **2026-10-11 UTC** says the final cutoff will be announced on Discord. The official post URL, confirmed cutoff, submitter name, public demo URL, and submitter authorization are unresolved here. The team, project, repository, and business-plan values below come from the owner's marketing-material issue 22 entry-contents list (source snapshot issue updated_at 2026-10-11T20:21:44Z (GitHub activity metadata, not proof of the last body edit; body SHA-256 c8b8607cf7ecc8992f6516843c720e93f16d38c17e64c1397b86ea25d58a652f; later comments do not change the four known fields)) through four pending ledger rows (`CLAIM-X-DEST-TEAM-001`, `-PROJECT-001`, `-REPO-001`, `-PLAN-001`); they are draft field values, not approved external copy. Do not invent or leave any pending field looking final.

**Attach/quote target outside the copy body:** `[OFFICIAL NEATLOGS SUBMISSION POST — not yet published or supplied]`
**Final cutoff:** `[PENDING — check the official Discord announcement]`

```text
Team: Jevelopers · Name: [SUBMITTER_NAME_PENDING] · Project: TicketStub · Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com · Demo: [PUBLIC_DEMO_URL_PENDING] · Business plan: https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2 #neatHack
```

Filled fields (each row is `state: planned`, `reviewStatus: pending`; none is approved):

- `Team: Jevelopers` — `CLAIM-X-DEST-TEAM-001`.
- `Project: TicketStub` — `CLAIM-X-DEST-PROJECT-001`. Required qualifier: “Project name only; product availability is unverified.” Keep that qualifier in review notes or accompanying text; the field itself does not state availability. This row does not extend `CLAIM-PRODUCT-NAME-001`, which stays scoped to concept artwork.
- `Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com` — `CLAIM-X-DEST-REPO-001`. Qualifier: repository locator only; not a product route, transaction, or availability statement. The getticketstub.com route owner has not confirmed the locator for this use, and marketing did not verify the repository's visibility, contents, or hackathon-dated commits.
- `Business plan: https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2` — `CLAIM-X-DEST-PLAN-001`. Required by issue 22 (not optional). Qualifier: locator only; not Finance approval; `CFO-R2-001` is unresolved. It carries no figures, math, or sponsor approval; do not add any alongside it, and do not replace the URL with a placeholder.

Still bracketed and pending: `[SUBMITTER_NAME_PENDING]`, `[PUBLIC_DEMO_URL_PENDING]`, the official post attachment, and the Discord cutoff. The business-plan locator is filled, but its wording review is pending. The submitter must supply their own name and authorization, and the quote-post is submitted from their own account. The demo link must be a publicly accessible project demo; the marketing-material documentation URL is not a substitute for the project repository or demo.

### 280-character fit

The ordinary X post limit recorded from [X Help: How to Post](https://help.x.com/en/using-x/how-to-post) is **280 characters**, checked **2026-10-11 UTC**. This package does not assume a longer-post subscription. Keep the official post attached as a quote-post. No X draft was created and no post was sent.

**Count method (reproducible).** Raw = Python `len()` of the text block. Weighted = a bounded local estimate, `x_weighted_length()` in `tests/test_narrative_handoff.py`, which applies the official twitter-text configuration ([`config/v3.json` at pinned commit `30e2430d`](https://github.com/twitter/twitter-text/blob/30e2430d90cff3b46393ea54caf511441983c260/config/v3.json)): maximum weighted length 280; each known `https://` URL counts 23 regardless of length; characters in the configured Latin/punctuation ranges (including the middle dot `·`) count 1. The helper's exact behavior: it raises on a literal `http://` and on characters outside the configured ranges (emoji, CJK, other Unicode). It does not detect every other schemeless or non-HTTPS URL; for example `example.org` and `ftp://example.org` remain ASCII plaintext and are counted character by character, not as URLs. Any other URL or Unicode case therefore requires the human composer. It is not a full URL parser and does not validate generic URL scope; it is not the full X parser, and no parser library is installed or claimed.

The template now contains the complete plan URL, so its raw length is above 280 while its weighted estimate is within 280. The test guard therefore checks the weighted estimate (and keeps a negative case that rejects plain text over 280); it does not skip or relax the limit. Stand-in demo URL used below: `https://demo.example.org/ticketstub`.

| Body variant | Raw characters | Weighted (URL = 23) | Fits 280 |
| --- | --- | --- | --- |
| Template as shown (name and demo left as brackets) | 346 | 194 | Yes (brackets are not final values) |
| Name left as `[SUBMITTER_NAME_PENDING]`; stand-in demo URL | 356 | 192 | Yes (placeholder name is not final) |
| Empty name; stand-in demo URL | 332 | 168 | Yes |
| Name `Sam Lee`; stand-in demo URL | 339 | 175 | Yes |
| Name `Alexandria Montgomery-Featherstonehaugh`; stand-in demo URL | 371 | 207 | Yes |
| Build-in-public shell (section B) | 118 | 118 | Yes (the bracket slot is not a final count) |

- **Name and demo budget:** these counts include the plan URL. With the demo link as a 23-weight URL, 112 weighted characters remain for the submitter name (280 minus 168 for the empty-name variant), counted with the plan locator in place. The raw repository URL is 61 characters and the raw plan URL is 137; each weighs 23.
- **Method limits:** the weighting rule is read from the pinned official configuration, not from a live X composer, so it can differ from what X applies. The demo URL is a stand-in; a demo URL without a scheme may not be treated as a link and could weigh its full length. The real submitter name, any non-ASCII characters in it, and any change to the field order or separators change the count; unknown Unicode and URL cases are for the human composer.
- **Human composer check: pending.** A person must paste the completed body into X's composer, confirm the character indicator, and confirm the quote-post attachment before anything is submitted. This count is not a substitute for that check.

## B. Reusable build-in-public update — documentation CTA only

Use only after replacing the bracket with a real, dated, source-linked activity. Keep the CTA exactly as listed in the ledger. Do not turn the placeholder into an unverified product, sponsor, feature, performance, or financial statement.

```text
Build-in-public update: [DATED, SOURCE-LINKED ACTIVITY THAT ACTUALLY OCCURRED]. Explore the repository docs. #neatHack
```

- `#neatHack` is required by the organizer's current build-in-public guidance.
- **CTA:** `CTA-REPOSITORY-DOCS-001` — “Explore the repository docs.” — <https://github.com/Jevelopers-neatHack-2026/marketing-material/blob/05ed6ca6db94b6384fa9ef7ee965271be071264b/README.md>.
- CTA destination is pinned public repository documentation only; the ledger records its exact wording as approved and its route as confirmed for repository docs only (2026-10-11), for this same pinned target. No product or landing-page route is implied.
- Check the completed text against the ordinary 280-character X limit and the current composer before use. No scheduled or automatic publication is part of this deliverable.

## Visual and accessible alternative

The companion candidates are `launch/assets/x-submission-key-visual.svg` (`LAUNCH-X-KEY-VISUAL-001`) and `launch/assets/x-submission-alt-text.md` (`LAUNCH-X-ALT-TEXT-001`). They remain synthetic concept/draft assets with brand, rights, visual, and accessibility review pending. Their alt text must be reviewed against the final rendered PNG and crop; do not copy a pending description as approved alternative text.

X Help currently says one image with standard ratios between 2:1 and 3:4 displays in full. The current local PNG is 1200×675, a local 16:9 selection within that range, not a mandated dimension. Inspect the final composer crop and retain the full synthetic-concept and availability qualifiers. The video export's aspect ratio and file-size limit remain unspecified by the checked organizer source.

## Copy map and release status

| Text | Source/ledger reference | Review state |
| --- | --- | --- |
| “Explore the repository docs.” | `CTA-REPOSITORY-DOCS-001`; pinned README target above | Wording approved and route confirmed for repository docs only, per ledger (same pinned target) |
| `#neatHack` | Official event page, checked 2026-10-11 UTC | Organizer-required tag; refresh before use |
| Field set (team/name/project/repository/demo) | Official event page, checked 2026-10-11 UTC | Required fields per organizer; submitter name and demo value pending |
| `Business plan: https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2` | `CLAIM-X-DEST-PLAN-001`; source: issue 22 entry contents (source snapshot issue updated_at 2026-10-11T20:21:44Z (GitHub activity metadata, not proof of the last body edit; body SHA-256 c8b8607cf7ecc8992f6516843c720e93f16d38c17e64c1397b86ea25d58a652f; later comments do not change the four known fields)). Qualifier: locator only; not Finance approval; `CFO-R2-001` unresolved | planned / review pending; not approved; no figures or sponsor approval |
| `Team: Jevelopers` | `CLAIM-X-DEST-TEAM-001`; source: marketing-material issue 22 entry contents (mutable issue text, not a commit) | planned / review pending; not approved |
| `Project: TicketStub` | `CLAIM-X-DEST-PROJECT-001`; qualifier “Project name only; product availability is unverified.” | planned / review pending; not approved; separate from `CLAIM-PRODUCT-NAME-001` (concept artwork only) |
| `Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com` | `CLAIM-X-DEST-REPO-001`; locator only, not a product route | planned / review pending; route-owner confirmation pending |
| Submitter name, demo URL | None. No ledger row | Pending; no value supplied |
| Official post and cutoff fields | Official event page says final cutoff is announced on Discord; exact post/cutoff not supplied | Pending; must be refreshed before submission |

Source references: the four `CLAIM-X-DEST-*` rows (`TEAM`, `PROJECT`, `REPO`, `PLAN`) are in `messaging/claims.json` at the current bound source revision, each `planned` / review pending. Exact review of this copy against those rows is pending; nothing here states that the release is ready.

Product and sponsor capability/results copy remains blocked. The exact ledger keeps Neatlogs, Entire, CFO.ai, comparison, product-runtime, and route evidence separate. Do not infer any of them from the rehearsal or announcement draft.
