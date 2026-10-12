# Local distribution proposal and review archives

**Status: proposal and offline tooling only.** No approved brand version, registry
package, released asset subset or font provider has been selected. BK-03B
[#14](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14) remains blocked
on the actual rights and exact-candidate decisions. A review ZIP is explicitly
unapproved. Its integrity does not establish ownership, permission or release readiness.

## Proposed delivery contract

Build a deterministic `ZIP_STORED` archive from a **clean full Git commit**. Record
the complete source SHA, tree SHA, token-profile version, ordered file paths,
lengths, SHA-256 hashes and available provenance references in `brand-kit/MANIFEST.json`.
The separate SHA-256 printed by the builder pins the entire ZIP, including its
manifest. The manifest has no recursive self-hash. ZIP entries have fixed timestamp,
mode and order, and no compression-version variability.

The proposed locator is an owner-supplied local archive plus its separately
reviewed source/digest pin. No network download, registry name, release URL, tag or
publication is assumed. A Git checkout or whole-repository archive is source
material, not the allowlisted consumer artifact. The full source SHA records the
code used to build; it does not itself approve any contained file.

The proposed [path set](../distribution/proposal.json) preserves `logo/` and
`tokens/` import names. It includes all 14 existing SVG variants, token data and
generated CSS/Tailwind outputs, and four guides. It excludes `references/`, font
binaries, the brand board, development code and repository history. Source guides
without a provenance record are represented by a null provenance entry in review
archives; this prevents their unknown rights from becoming an implied approval.
Production packaging requires every shipped file, including a guide or required
notice, to be recorded and explicitly allowlisted through BK-06. Existing font
notices remain source-only unless an eligible non-font output genuinely requires
them and receives its own reviewed allowlist entry.

## Commands

Python 3.9+ standard library is sufficient for package mechanics. The actual Python
version is recorded in `check` output; no dependency install or provider call occurs.
Run on a clean committed candidate; outputs must be outside the checkout or in an
ignored output directory, and each output filename must be new.

```sh
# This temporary path is a local artifact destination, not a release version.
candidate_dir=$(mktemp -d)
python3 -I tools/build_distribution.py build --mode review --out "$candidate_dir/brand-review.zip"
python3 -I tools/build_distribution.py check

# Default approved mode intentionally fails while the allowlist/decisions are absent.
python3 -I tools/build_distribution.py build --out "$candidate_dir/brand-approved.zip"
```

For a received archive, use the **actual** full SHA and SHA-256 from an independently
reviewed receipt; never copy placeholders as evidence:

```sh
python3 -I tools/build_distribution.py verify /absolute/path/brand-review.zip \
  --source "$REVIEWED_BRAND_COMMIT" --sha256 "$REVIEWED_ARCHIVE_SHA256"
```

`verify` refuses moving refs, checksum mismatches, missing/extra/duplicated members,
unsafe paths, directories/symlinks, compressed/encrypted entries, font binaries,
references and inconsistent file lengths/hashes. It checks integrity only. The
consumer smoke additionally reconstructs the complete expected manifest and file set
from the pinned local Git tree before loading a preset. This includes packaging
mode, source provenance and allowlist eligibility, rights/approval summaries, font
policy, decision receipts, profile, paths and bytes. An internally consistent,
resealed manifest cannot promote an unapproved source to an approved subset.
Provenance validation uses an inert temporary copy of the pinned tree, capped at
4,096 regular files and 64 MiB, and rejects symlinks/submodules and ambiguous paths.
It does not execute copied source or rely on a different working-tree revision.
Do not execute an archive from an untrusted sender merely because that sender also
supplied a checksum. Source comparison still does not authenticate a reviewer's
identity, authority or linked decision.

## Font decision to review

The owner explicitly requires **no self-hosted fonts**:
[#8 decision receipt](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8#issuecomment-6116787775).
Existing local TTF files remain source inputs to logo generation and are never
packaged for consumer font serving. `tokens.css` makes no font/network request.
The default smoke uses the existing platform fallbacks: Fraunces → Iowan Old Style,
Palatino Linotype, Georgia, serif; Inter Tight → Segoe UI, system-ui, -apple-system,
sans-serif. Different installed fonts can change text metrics and need visual review.

The separately imported `tokens/external-fonts-google.css` preserves an existing
**pending external-provider proposal**, not an approved strategy. Its exact requested
families/axes come from `tokens/profile.json`: Fraunces `opsz` 9–144, `wght` 300–800,
`SOFT` 0–100, `WONK` 0–1; Inter Tight `wght` 400–600, with `display=swap`.
If selected, the browser would contact `fonts.googleapis.com` for CSS and
`fonts.gstatic.com` for font files. Review CSP `style-src`/`font-src` additions,
visitor IP/page-context disclosure, service availability, fallback/reflow and the
provider's version/notice requirements. The existing CSS URL is not an immutable
font-binary pin; a review archive hash cannot guarantee the provider's future bytes.
Do not add preconnect or the opt-in import before the actual owner decision.

No external font request is made by these checks. Both available-provider and
unavailable-provider browser evidence remain required for BK-03B.4/.5; offline
fallback inspection cannot turn either case into a pass. Product's Next font delivery
and landing's existing external loading remain consumer-owned reconciliation work.
The consumer report records this invocation as `font_provider_checks.status=not_run`
with `performed_this_run=false`. Required external evidence is a separate field:
`external_font_evidence` stays `blocked` when missing or stale, and becomes
`recorded_unverified` only with a complete receipt bound to the exact file set.
Receipt validation can satisfy the normal command's record checks; it never claims
the provider was exercised here or authenticates the recorded browser outcomes.

## Version, deprecation and rollback proposal

`brand_version` is null until the owner selects it. Full commit + archive SHA-256
identify review candidates now. SemVer is a possible future policy, not an assigned
version. Public paths, CSS variable names and Tailwind mappings are proposed stable
interfaces. Any value change requires consumer-impact review; removal/rename is a
breaking change requiring explicit migration. Compatible additions require the
governance review for their change class. A deprecation interval and release cadence
are still owner decisions, and no public token is removed by this tooling.

Retain the old pin and bytes until the new exact candidate is accepted. Never track
`main` or assume a moving tag is immutable. The [consumer guide](consumers.md) maps
the original file baseline to the present source behavior. A prior archive may be
restored only after its current rights and approval are checked; revoked or expired
approval cannot be revived by replaying an old checksum. The local missing-import
recovery test is not an approved historical release rollback.

## Recording decisions without manufacturing them

[acceptance.json](../distribution/acceptance.json) is a deliberately empty local
receipt index. It does not replace the [governance decision](brand-governance.md).
For `distribution`, `font_delivery`, each consumer, each required leaf, each manual
evidence item, and `release_review`, a future actual decision record has exactly these keys:

```json
{
  "status": "approved",
  "reviewer": null,
  "reviewed_on": null,
  "evidence_url": null,
  "evidence_sha256": null,
  "files_digest": null
}
```

This example is **invalid and non-approving** until each null is replaced from an
actual named dated decision, specific GitHub review/comment permalink, content
digest and exact exported file-set digest. The containing `source_sha` identifies
the actual reviewed source revision, whose exported bytes must still match. The
receipt itself may be committed later, avoiding an impossible recursive source pin.
Local tools validate the record shape and binding; a human must authenticate the
linked decision and authority. No agent may fill another person's acknowledgment.

## BK-10 gate and evidence

`python3 -I tools/check_brand_release.py` creates a fresh temporary run directory,
executes all required Make leaf commands, and preserves each command, mode, runtime,
exit code and sanitized output digest, including failures and later checks. Supply
`--out /absolute/fresh/path` outside the checkout to choose the destination. Existing evidence paths are
never overwritten. Missing Make/browser dependencies fail, rather than becoming
passes. Required font, visual, rights, claims, sanitization, migration and named
consumer/release evidence stay blocking while null. The report cannot publish,
close an issue or change ART-05/EVAL-04/global acceptance; their actual owners retain
those decisions. Review the original-source history separately for BK-10.5.
