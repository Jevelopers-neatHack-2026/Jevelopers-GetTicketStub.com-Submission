# LP-06: current provisional brand consumption

Refs [LP-06 #8](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/8).
The landing page has existing inline identity, local token aliases and illustrations.
They are retained for local review. **No approved brand distribution is consumed and
this inventory grants no publication or visual acceptance.**

The [local inventory](../review/brand-inventory.json) binds the observed brand portion
of landing source `034785cb30aca697af13b5e47cbeea6cb7a9c158` to its actual Git objects.
The original page SHA-256 is
`2bc1c248336d17ee0beb402882cc697925721a42f94b6e8f2fa187da36227a92`.
Unrelated page edits can leave this brand projection unchanged; this is not a
whole-page acceptance receipt. Copy, privacy, scrolling and final build evidence
retain their separate validators and owner reviews.

## Upstream source and permission boundary

The read-only source observation is brand-kit
[`3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`](https://github.com/Jevelopers-neatHack-2026/brand-kit/tree/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4).
Its [publication allowlist](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4/provenance/allowlist.json)
is empty. The small [captured policy](../review/brand/upstream-allowlist.json)
retains the exact observed bytes, SHA-256 and Git blob identity in the inventory.
Its internal `source_revision: 91157ac` is upstream historical text; it is not the
current observation pin. Review files are excluded from the public artifact.

The inventory records immutable URLs and observed byte hashes for the canonical
token JSON, generated CSS, explicit Google Fonts opt-in, and logo/imagery guidance.
Token value excerpts describe the comparison; they are not a second master source.
Only the empty policy is retained as a complete upstream snapshot. The offline
validator checks that snapshot against its observed hashes but does not independently
query GitHub or prove owner authority. The other upstream source hashes record the
read-only observation, not a future freshness check or distribution approval.

`importedBrandFiles` is empty. No new logos, images, font binaries, CSS packages or
runtime dependencies were imported. Brand-kit remains the owner of canonical token
values, generated outputs and logo masters. This change does not choose a license,
ratify the identity or change a foreign contract.

## What the current page consumes

| Existing surface | Observed source relationship | Remaining decision |
|---|---|---|
| Six base colours, foil gradient and motion values | Local declarations correspond to recorded canonical values; the inventory covers every one of the 25 root declarations. | Replace manual copies with approved consumer aliases/imports only after an accepted distribution contract. Matching values do not prove approval. |
| `--serif` and `--body` | Fraunces and Inter Tight fallback lists/order differ from the canonical family lists. | Brand/type reviewer must accept the adaptation or supply the required change. |
| `--display`, `--cond`, `--mono`, `--stock-2`, `--wall`, `--gutter` | Existing landing-specific typography, colours and spacing. No canonical match is claimed. | Review intentional consumer adaptations; the primary Archivo display treatment differs from canonical Fraunces guidance. |
| `tsStamp` and `tsWordmark` | Existing inline symbol bytes and all symbol references are inventoried. Upstream logo paths are review pointers. | Exact upstream derivation/permission and rendered placement have not been verified. The suite cannot promote a pointer into logo provenance. |
| Ten local WebP/JSON assets | Existing landing file set, asset digests and actual pinned Git bytes agree. | Rights, sanitization and imagery acceptance remain pending under LP-04 and brand review. No asset becomes permissioned through its hash. |
| External fonts and animation dependencies | Exact link/script/import-map URL declarations and attributes are inventoried. | The fetched CSS/script/font responses and any transitive URLs are unmeasured; declaration pinning is not response integrity or privacy approval. |

The page requests six Google Fonts families: Archivo, Big Shoulders Display, IBM
Plex Mono, Abril Fatface, Fraunces and Inter Tight. The upstream explicit opt-in CSS
requests only Fraunces and Inter Tight, with different axes/weights. The exact URLs
are recorded rather than silently treating them as the same contract. Motion
`11.11.17` and Three `0.160.0` URL declarations likewise name versions but supply
no independently captured response digest here.

The [current upstream owner relay](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14#issuecomment-6118157033)
requires **no self-hosted fonts**. Existing system fallback stacks stay in place.
No font conversion or font download was performed. The suite rejects new public
font files and `@font-face`/`@import` declarations in the inspected styles. A future
font-provider, family, axes, network/CSP or fallback change requires the actual
font/brand and privacy-owner decision. These source checks do not simulate font
loading or measure fallback layout.

Logo-size/clear-space and imagery rules still need actual rendered review. For
example, the existing `.logo-stamp` source is 17 by 21 CSS pixels, while upstream
logo guidance specifies a 24-pixel minimum stamp height. Existing performer imagery
also needs explicit review against the imagery guidance. Neither example is
silently approved or redesigned by this inventory work.

## Executable local validation

Use the repository's documented Node **24.15.0** runtime:

```sh
node --test tests/brand.test.mjs
node scripts/validate-landing --suite brand --mode draft
node scripts/validate-landing --suite brand --mode release
```

The [retained run record](../review/brand/validation/ec3d2d2/commands.json) binds
actual execution to implementation commit
`ec3d2d29f4acb7ffb4b55d51b657d5cfa2016c3d`: 29 brand tests and 164 complete repository
tests passed with zero failures or skips on Node 24.15.0. Brand draft returned 0;
brand release returned 1 with its missing-prerequisite message preserved. Adjacent
raw logs and the built artifact manifest have recorded hashes. Those results
describe this exact source, not a later combined candidate or deployed host.

The dispatcher builds the real static artifact before checking it. Draft mode
checks the current token declarations, font declarations, inline symbol hashes and
references, dependency URL/attribute inventory, retained local file set and hashes,
immutable landing source, captured upstream policy, pending permission states, and
freshness/withdrawal records. It also runs the shared source/artifact comparison.
It returns `PASS_DRAFT` only for the scoped local consistency result.

Release returns exit **1** while the upstream publishable subset is empty and the
distribution/font decision, consumer contract and actual brand/publication/visual
acceptance are missing. Merely changing an approval string, filling an artifact
field or inserting a synthetic upstream entry is rejected. A future real approved
distribution needs a reviewed consumer implementation, not a flag that bypasses
this blocked boundary.

Tests mutate actual source copies to reject changed palettes, missing type
fallbacks, replaced inline marks, changed CDN URLs, new stylesheets, duplicated
resource attributes, copied assets, self-hosted fonts and asset rehashing that
disagrees with the source pin. Other cases cover stale/future audits, missing alias
coverage, fake approval/provenance and source/build drift. They perform no external
request. These are source/fixture checks, not a browser, accessibility, licence or
visual-conformance test.

## Update, withdrawal and rollback

Before changing the selected brand input, obtain the exact immutable approved
artifact, allowlist, notices/rights and accepted import contract from
[BK-03B #14](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14) and
[BK-09 #15](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/15).
Their full repository release gates are not prerequisites; these narrow consumer
inputs are. Until they exist, keep current content provisional and release blocked.

1. Preserve the current source commit, brand inventory, upstream policy observation,
   build manifest and previous test results in Git. Record the new source and why
   each local adaptation/import is retained, changed or removed. Never use a moving
   branch link as the evidence identity or infer rights from repository visibility.
2. On the reviewed implementation branch, update only the authorized consuming
   source/imports. Review every new URL, file, font family and output hash. The
   build must continue excluding archives, working files and evidence snapshots.
3. For withdrawal, remove the affected source declaration/file and its rendered
   use; record its path/URL in `withdrawn`. Rebuild before validation. Changing a
   status field alone cannot remove a served resource. Coordinate remaining
   references and fallback behavior with LP-04/LP-05/LP-07 rather than marking them
   passed from this static inventory.
4. Bind the reviewed new projection and retained asset records to an immutable
   source commit. Re-run the brand tests/draft suite and all affected consumer
   checks; obtain exact rendered brand approval. Recheck on source changes, a brand
   release/revocation, a font policy change and before publication. The current
   draft audit expires on its recorded `recheckBy`; that is an author recheck
   deadline, not an upstream permission term or evidence-retention policy.
5. Roll back by restoring the previous complete source plus matching inventory and
   upstream policy snapshot, rebuilding and comparing the prior manifest/hash.
   Never restore an actually revoked asset/permission as part of rollback. The
   host owner separately controls deployed cache invalidation, serving and rollback.

The executable withdrawal/rollback drill uses an isolated temporary Git repository
and the actual landing build: it removes the Google Fonts link declarations,
records their withdrawal, binds the changed source, verifies their absence from the
artifact, then restores the prior local source/inventory and reproduces the exact
old build-manifest digest. This is a **synthetic policy exercise**. It grants no
font withdrawal, brand version acceptance, live host result or deployment permission.

## Outstanding acceptance and owners

LP-06.A remains blocked on the approved subset and permission records. LP-06.B
remains partial because manual local values and adaptations are inventoried, not
converted to an approved canonical import, and type/logo fallback behavior needs
rendered review. LP-06.C gains a tested local file/URL boundary and synthetic
withdrawal/rollback procedure; an actual approved version upgrade and consumer ACK
remain absent. LP-06.D requires the actual brand reviewer to accept representative
mobile/desktop screenshots and adaptations. Product/frontend, the brand-kit
maintainer and the applicable publication/privacy owners retain those decisions.
No local or global issue is closed by this check.
