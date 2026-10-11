# Collateral handoff and receiver procedure

`v0.1.0-rehearsal` is an internal draft package for concept collateral. It does not grant publication rights, constitute an approved release, or meet the neatHack submission demo requirement. The versioned `package-spec.json` is the source list; `tools/package_collateral.py` binds each selected source/export, copy, alt text, scene, selected claim/CTA, provenance record, brand reference, and evidence file to exact SHA-256 hashes and source commits. The tracked generated manifest predates this final narrative/provenance join and is stale; the packaging worker must rebuild/validate it after canonical gate changes and merge. The committed 150-second silent synthetic rehearsal, SRT/VTT, transcript, HTML and exact author receipt are current inputs, but do not satisfy the absent final product demo at `demo/exports/v1-demo.mp4`. Never insert a guessed path, checksum, approval, or source commit.

## Naming and legacy-file mapping

New package copies use this deterministic form:

```text
{family}-{assetId}-{revision}-{destination}-{dimensions}-{locale}-{variant}.{extension}
```

For example, the existing `demo/recording-checklist.md` source maps to `demo-001-demo-recording-checklist-001-r01-repository-internal-review-text-en-us-rehearsal-recording-plan.md`. A visual source and its export keep the same asset ID but have distinct variants and extensions. A dynamic rehearsal MP4 and its SRT/VTT sidecars receive distinct role and format records, exact hashes, scene references, and receipt checks. The `text` dimension token means dimensions do not apply; raster/video dimensions come from the actual bytes and are never inferred from a filename.

The older working names remain intact and are source paths, not release names:

| Existing source path | Stable package asset ID | Package role |
| --- | --- | --- |
| `demo/diagrams/demo-workflow.svg` and `.png` | `DEMO-WORKFLOW-DIAGRAM-001` | Editable vector and rendered export |
| `demo/screenshots/synthetic-stub-mockup.svg` and `.png` | `DEMO-SCREENSHOT-SET-001` | Clearly labeled fictional concept artwork |
| `demo/deck/concept-overview.html` | `DEMO-DECK-SUPPORT-001` | Responsive concept support page |
| `launch/assets/x-submission-key-visual.svg` and `.png` | `LAUNCH-X-KEY-VISUAL-001` | Draft social concept visual |
| `demo/*.md`, `demo/rehearsal-scenes.json`, and `launch/announcement-copy.md` | IDs in `package-spec.json` | Editable copy, scene, transcript, checklist, and update templates |

Existing release directories and files are retained. The builder copies exact source bytes into `release/{version}/assets/`; an existing target is accepted only when its SHA-256 is identical. A different byte sequence at the same target fails. Increase the asset revision or package version and preserve the prior version; never use a “final-final” suffix or rewrite a legacy source in place. While a package is explicitly `draft_rehearsal_only`, the generated manifest may be refreshed as claims, receipts, or review inputs change; the prior manifest is preserved under `release/{version}/history/manifest-{content-hash}.json` before the draft manifest is replaced. Asset copies remain immutable under their current revision. A non-draft or approved manifest cannot be replaced by this builder; issue a new version through an owner-reviewed release process.

## Receiver verification

Use a clean checkout of the exact source commit named in the manifest. Select an asset by all of its stable fields, not by whichever file looks newest. For example:

```sh
jq '.assets[] | select(.assetId == "DEMO-WORKFLOW-DIAGRAM-001" and .variant == "concept-workflow-presentation-png") | {file, source, packageCopy, accessibleAlternative, sceneIds, claimReferences, provenance, destinations, approval, limitations}' release/v0.1.0-rehearsal/manifest.json
python3 tools/package_collateral.py validate release/v0.1.0-rehearsal/manifest.json
sha256sum release/v0.1.0-rehearsal/assets/<selected-package-filename>
git show <sourceCommitId>:<source-path> | sha256sum
```

Compare both digests with the selected manifest row. Open the exact package copy in a native viewer; compare it with the source/export and inspect its dimensions, crop, concept label, embedded metadata, and readability. Read the linked alt text or transcript, then check the exact selected claims and qualifiers, provenance scope/expiry, permitted destination, brand decision, and reviewer/date in the manifest. A checksum proves byte identity only; it does not prove rights, accessibility, factual support, or approval. Reject any path whose status is missing, modified, stale, pending, expired, revoked, superseded, out of scope, or unjoined.

Reproduce the package from the same committed inputs with `python3 tools/package_collateral.py build --version v0.1.0-rehearsal`. The tool uses Python's standard library plus `ffprobe` to inspect actual video metadata; it makes no network or paid-provider calls. Keep the recorded ffmpeg/ffprobe, Chrome, Node, Python, and Pillow versions with the render receipt. Browser version, OS, font fallback, font rasterization, and glyph metrics can change exported pixels and hashes. Re-rendered bytes are a new revision and require another visual and accessibility inspection; do not treat a matching source SVG or HTML hash as proof that a PNG still matches.

The validator reports integrity separately from readiness. A draft manifest may have matching checksums while its collateral or external submission gate remains `BLOCKED`. Do not override a gate, approve an asset from a model review, upload/post automatically, or treat a rehearsal as product evidence.

## Format and external-use boundary

The official organizer page currently requires a public repository, supporting evidence, and a public X quote-post attaching the official post with team, submitter/name, project, repository, and demo link. It requires a demo of three minutes or less covering architecture, implementation, runtime, reasoning, and result for each of neatlogs, Entire, and cfo.ai; the final cutoff is announced on Discord. The checked record does not specify a video aspect ratio, file-size maximum, official post URL, or final cutoff. Refresh [neatHack's official page](https://neatlogs.com/hackathon) immediately before submission.

The standard X post limit recorded here is 280 characters; recount the fully filled post in the current composer. The optional single-image full-display range is 2:1 through 3:4. The 1200×675 draft image is a local design choice, not a video or upload constraint. Verify the final crop in the current composer. These format notes are recorded in `review/official-format-sources.json` with the check date and source URLs: [X post instructions](https://help.x.com/en/using-x/how-to-post) and [X photo/GIF instructions](https://help.x.com/en/using-x/posting-gifs-and-pictures).

## Current disposition

All included art remains synthetic concept work. The current product source pin, [`getticketstub.com` README at `7f59d339`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/7f59d33922a0585205547d490b288b49eed32419/README.md), records an existing Next.js App Router preview runtime integrated by [PR #22](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/22). That preview defaults to demo fixtures and simulated art/agent responses; the README says no live provider calls were made to validate the deployment fix. This source does not establish a deployed customer journey, the required versioned product-capability manifest, product-release acceptance, live sponsor integration, authentic sponsor evidence, or measured results; no savings claim is supported. The older `5a298645` product ownership pin remains only as historical context for the rehearsal source snapshot and is not the current product implementation pin. The pinned brand-kit reference has no owner-approved subset. The current candidate has exact path-level inventory/checksum/provenance joins and a scene/caption/HTML copy map. Asset-specific public rights, selected wording/CTA review, independent review and producer approvals remain pending; no separate receiving reviewer has approved these bytes. The MP4 and both caption sidecars match the UI source receipt as generated; the narration/transcript source changes in this candidate require the UI owner to refresh that receipt. The receipt pins the exact storyboard, scenes, narration, transcript, HTML, browser output, render plan, tool versions, caption sidecars and inspected frames. The receipt records author checks on 17 cue frames and 20 decoded scene boundaries, not continuous playback or independent approval. The package manifest itself must be regenerated after this metadata join and canonical merge. The silent rehearsal is only an internal concept rehearsal. Both collateral-package readiness and external-submission readiness remain separate decisions and must remain `BLOCKED` until their own exact-asset and evidence criteria pass.
