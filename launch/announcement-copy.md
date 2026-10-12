# Announcement copy — editable draft set

**Assets:** `LAUNCH-X-COPY-001`, `LAUNCH-X-CTA-001` · **Families:** `FAM-ANNOUNCEMENT-001`, `FAM-SOCIAL-001`
**Status:** draft only. No automatic posting, scheduling, external submission, or approval is recorded.

## A. Required official X quote-post — field template

The organizer's current requirement is one public quote-post of its official neatlogs submission post, carrying the team, name, project, public repository, and demo link. The official page checked **2026-10-11 UTC** says the final cutoff will be announced on Discord. The official post URL, confirmed cutoff, submitter name, public demo URL, and submitter authorization are unresolved here. The team, project, and repository values below come from the owner's marketing-material issue 22 entry-contents list through three pending ledger rows; they are draft field values, not approved external copy. Do not invent or leave any pending field looking final.

**Attach/quote target outside the copy body:** `[OFFICIAL NEATLOGS SUBMISSION POST — not yet published or supplied]`
**Final cutoff:** `[PENDING — check the official Discord announcement]`

```text
Team: Jevelopers · Name: [SUBMITTER_NAME_PENDING] · Project: TicketStub · Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com · Demo: [PUBLIC_DEMO_URL_PENDING] #neatHack
```

Filled fields (each row is `state: planned`, `reviewStatus: pending`; none is approved):

- `Team: Jevelopers` — `CLAIM-X-DEST-TEAM-001`.
- `Project: TicketStub` — `CLAIM-X-DEST-PROJECT-001`. Required qualifier: “Project name only; product availability is unverified.” Keep that qualifier in review notes or accompanying text; the field itself does not state availability. This row does not extend `CLAIM-PRODUCT-NAME-001`, which stays scoped to concept artwork.
- `Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com` — `CLAIM-X-DEST-REPO-001`. Qualifier: repository locator only; not a product route, transaction, or availability statement. The getticketstub.com route owner has not confirmed the locator for this use, and marketing did not verify the repository's visibility, contents, or hackathon-dated commits.

Still bracketed and pending: `[SUBMITTER_NAME_PENDING]`, `[PUBLIC_DEMO_URL_PENDING]`, the official post attachment, and the Discord cutoff. The submitter must supply their own name and authorization. The demo link must be a publicly accessible project demo; the marketing-material documentation URL is not a substitute for the project repository or demo.

### 280-character fit

The ordinary X post limit recorded from [X Help: How to Post](https://help.x.com/en/using-x/how-to-post) is **280 characters**, checked **2026-10-11 UTC**. This package does not assume a longer-post subscription. Keep the official post attached as a quote-post. No X draft was created and no post was sent.

Counts below are my own computation with a local script that applies the documented X weighting as I understand it: a URL with an `https://` scheme counts as 23 characters regardless of its length, and characters in the Latin and punctuation ranges (including `·`) count as 1. Emoji and CJK count as 2 under that rule and are not used in the template.

| Body variant | Raw characters | Weighted (URL = 23) | Fits 280 |
| --- | --- | --- | --- |
| Previous all-placeholder shell | 190 | 190 | Yes (not a final count) |
| Known fields; submitter name left as `[SUBMITTER_NAME_PENDING]`; demo as a stand-in `https://` URL | 194 | 151 | Yes (placeholder name is not final) |
| Known fields; empty name; demo as a stand-in `https://` URL | 170 | 127 | Yes |
| Build-in-public shell (section B) | 118 | 118 | Yes (the bracket slot is not a final count) |

- **Name and demo budget:** with the demo link as a 23-weight URL, roughly 150 weighted characters remain for the submitter name (the script's margin was 153 with an empty name field; 150 is the conservative figure). The raw repository URL is 61 characters but weighs 23.
- **Method limits:** the weighting rule is taken from public X documentation of how links count and is not read from a live X composer, so it can differ from what X actually applies. The demo URL is a stand-in; a demo URL without a scheme may not be treated as a link and could weigh its full length. The real submitter name, any non-ASCII characters in it, and any change to the field order or separators change the count. The script's URL matching is simple and does not reproduce X's full parser.
- **Human composer check: pending.** A person must paste the completed body into X's composer, confirm the character indicator, and confirm the quote-post attachment before anything is submitted. This count is not a substitute for that check.

## B. Reusable build-in-public update — documentation CTA only

Use only after replacing the bracket with a real, dated, source-linked activity. Keep the CTA exactly as listed in the ledger. Do not turn the placeholder into an unverified product, sponsor, feature, performance, or financial statement.

```text
Build-in-public update: [DATED, SOURCE-LINKED ACTIVITY THAT ACTUALLY OCCURRED]. Explore the repository docs. #neatHack
```

- `#neatHack` is required by the organizer's current build-in-public guidance.
- **CTA:** `CTA-REPOSITORY-DOCS-001` — “Explore the repository docs.” — <https://github.com/Jevelopers-neatHack-2026/marketing-material/blob/05ed6ca6db94b6384fa9ef7ee965271be071264b/README.md>.
- CTA destination is pinned public repository documentation only; its exact wording review remains pending. No product or landing-page route is implied.
- Check the completed text against the ordinary 280-character X limit and the current composer before use. No scheduled or automatic publication is part of this deliverable.

## Visual and accessible alternative

The companion candidates are `launch/assets/x-submission-key-visual.svg` (`LAUNCH-X-KEY-VISUAL-001`) and `launch/assets/x-submission-alt-text.md` (`LAUNCH-X-ALT-TEXT-001`). They remain synthetic concept/draft assets with brand, rights, visual, and accessibility review pending. Their alt text must be reviewed against the final rendered PNG and crop; do not copy a pending description as approved alternative text.

X Help currently says one image with standard ratios between 2:1 and 3:4 displays in full. The current local PNG is 1200×675, a local 16:9 selection within that range, not a mandated dimension. Inspect the final composer crop and retain the full synthetic-concept and availability qualifiers. The video export's aspect ratio and file-size limit remain unspecified by the checked organizer source.

## Copy map and release status

| Text | Source/ledger reference | Review state |
| --- | --- | --- |
| “Explore the repository docs.” | `CTA-REPOSITORY-DOCS-001`; pinned README target above | Route scoped to docs; exact wording review pending |
| `#neatHack` | Official event page, checked 2026-10-11 UTC | Organizer-required tag; refresh before use |
| Field set (team/name/project/repository/demo) | Official event page, checked 2026-10-11 UTC | Required fields per organizer; submitter name and demo value pending |
| `Team: Jevelopers` | `CLAIM-X-DEST-TEAM-001`; source: marketing-material issue 22 entry contents (mutable issue text, not a commit) | planned / review pending; not approved |
| `Project: TicketStub` | `CLAIM-X-DEST-PROJECT-001`; qualifier “Project name only; product availability is unverified.” | planned / review pending; not approved; separate from `CLAIM-PRODUCT-NAME-001` (concept artwork only) |
| `Repository: https://github.com/Jevelopers-neatHack-2026/getticketstub.com` | `CLAIM-X-DEST-REPO-001`; locator only, not a product route | planned / review pending; route-owner confirmation pending |
| Submitter name, demo URL | None. No ledger row | Pending; no value supplied |
| Official post and cutoff fields | Official event page says final cutoff is announced on Discord; exact post/cutoff not supplied | Pending; must be refreshed before submission |

Binding note: the three `CLAIM-X-DEST-*` rows were added to `messaging/claims.json` by the ledger lease (uncommitted at the time of this edit). Checksum and provenance bindings for the changed ledger and this copy are not refreshed here; the later package lifecycle handles that.

Product and sponsor capability/results copy remains blocked. The exact ledger keeps Neatlogs, Entire, CFO.ai, comparison, product-runtime, and route evidence separate. Do not infer any of them from the rehearsal or announcement draft.
