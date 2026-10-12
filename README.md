<a href="https://github.com/Jevelopers-neatHack-2026/marketing-material">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="marketing-material — Collateral, claims and provenance. TicketStub banner showing layered flyers with a small provenance tag on a string." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# marketing-material

The words, examples and presentation material that explain TicketStub, with every claim and asset tied to its evidence and provenance.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: synthetic draft collateral" src="https://img.shields.io/badge/status-synthetic%20drafts-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="review/release-checklist.md"><img alt="Publication: blocked, no asset approved" src="https://img.shields.io/badge/publication-blocked-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="#checks"><img alt="Checks: Python unittest and collateral validators" src="https://img.shields.io/badge/checks-python3%20unittest-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Claims and provenance](#claims-and-provenance) · [What's here](#whats-here) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

The repository holds maintained policy and navigation documents and a **draft synthetic collateral bundle**:

- a conceptual [workflow diagram](demo/diagrams/demo-workflow.svg) and a [fictional ticket mockup](demo/screenshots/synthetic-stub-mockup.svg)
- a static [HTML concept support page](demo/deck/concept-overview.html)
- a generated [150-second silent synthetic rehearsal](demo/exports/silent-synthetic-rehearsal.mp4) with an [accessible transcript](demo/rehearsal-transcript.md) and [SRT](demo/captions/silent-rehearsal.srt) / [WebVTT](demo/captions/silent-rehearsal.vtt) captions
- a draft [X key visual](launch/assets/x-submission-key-visual.svg)
- scoped author render, accessibility and synthetic redaction evidence under [`review/visual/`](review/visual/verification.md) and [`examples/synthetic/`](examples/synthetic/)

> [!IMPORTANT]
> **None of this is a product screenshot or product evidence, and none of it is approved for publication.** The rehearsal is an internal concept rehearsal; it does not replace the required final product demo, which is still absent at `demo/exports/v1-demo.mp4`. No application workflow, provider connection, sponsor integration, product result or licence is implied. Repository visibility (public) does not grant permission to publish any individual file.

Collateral package readiness and external submission readiness are separate decisions, and both are `BLOCKED` until their exact asset and evidence criteria pass ([release checklist](review/release-checklist.md), [review record](review/releases/v0.1.0-rehearsal.md)). Author checks are recorded. The scoped independent review of the `235697a` rehearsal is complete for that exact tree only. The README banners added afterwards have only a bounded delta review of their bytes; no independent approval of the banners, and no source-owner rights, brand approval, public-use or destination approval, has been given. Those remain pending.

Work is tracked under [MM-EPIC #1](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/1). MM-01 inventory ([#4](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/4)), MM-05 provenance ([#6](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/6)) and MM-08 accessibility ([#8](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/8)) are closed. Messaging (MM-02 [#5](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/5)), the demo set (MM-03 [#9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9)), announcements (MM-04 [#10](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/10)), brand consumption (MM-06 [#7](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/7)), packaging (MM-07 [#11](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/11)) and the v1 gate (MM-09 [#3](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/3)) are open.

## Claims and provenance

- **Claims.** Every public sentence or call to action needs a row in the exact-copy [claim ledger](messaging/claims.json), with its source, evidence class and qualifier. Capability, automation, live integration, sponsor, comparative, savings and financial claims stay blocked until their evidence and owner review are recorded. The rules and what can be said now are in the [messaging policy](messaging/README.md).
- **Evidence labels.** Keep the EVAL-03 labels (simulated, sandbox, live, estimated, pending). Never describe a simulation, mock or plan as a live result. Neatlogs, Entire and CFO.ai evidence classes stay separate.
- **Provenance.** Each source, export, accessible alternative and evidence file has a path, checksum and rights record in the [provenance register](review/provenance.json), governed by the [publication safety policy](review/publication-safety.md). Changed bytes need refreshed provenance and review. Unknown, expired or revoked permission means reject or replace with clearly synthetic content.
- **Passing validation is not approval.** A checksum proves byte identity only; it does not prove rights, accessibility, factual support or approval.

## What's here

| Folder | Contents |
|---|---|
| [`demo/`](demo/) | Draft product explanation, storyboard, narration, recording checklist and submission narrative; workflow diagram, fictional mockup, HTML pages, rehearsal video, scene map, transcript and captions |
| [`docs/`](docs/collateral-organization.md) | Collateral organization guide, machine-readable [inventory](docs/collateral-inventory.json), [handoff and receiver procedure](docs/collateral-handoff.md), architecture views |
| [`examples/`](examples/synthetic/) | Controlled synthetic redaction fixtures (before/after, canaries); test fixtures only |
| [`launch/`](launch/) | Draft announcement copy, deliverable briefs, X key visual and its text alternative |
| [`messaging/`](messaging/README.md) | Messaging policy and the exact-copy claim ledger |
| [`release/`](release/v0.1.0-rehearsal/manifest.json) | Draft `v0.1.0-rehearsal` internal package: current manifest, package spec, immutable current r06 asset copies with retained prior r01/r02/r03/r04/r05 copies, and retained historical draft manifests under `history/`. A draft manifest may be refreshed only by the documented build and bind workflow ([handoff](docs/collateral-handoff.md#receiver-verification)), which archives the prior manifest unchanged. Do not edit package bytes in place; an approved or non-draft release needs a new version. |
| [`review/`](review/publication-safety.md) | Publication safety, provenance, accessibility, messaging and release checklists; visual, browser, contrast and rehearsal receipts |
| [`tests/`](tests/) | Python `unittest` suites for validation, packaging, narrative handoff and visual evidence |
| [`tools/`](tools/) | `validate_collateral.py`, `package_collateral.py`, and the render recipes `render_collateral.mjs`, `render_rehearsal.py`, `render_rehearsal.mjs` |

## Checks

Run from the repository root. There is no CI workflow; these run locally and make no network or paid-provider calls. The tests need Pillow, and the rehearsal test and package validator need `ffprobe`. The recorded environment, Python 3.9.6 with Pillow 11.3.0, is required for package validation as well as rendering ([handoff](docs/collateral-handoff.md#receiver-verification)); on the maintainer's machine that is `/usr/bin/python3`, and other interpreters may lack Pillow or differ.

```sh
python3 tools/validate_collateral.py --mode draft            # claims, provenance pins, copy joins, tracked-file inventory
python3 -m unittest discover -s tests                        # all suites (several minutes)
python3 -m unittest discover -s tests -p 'test_visual_*.py'  # visual and accessibility evidence only (fast)
```

The scoped independent review of the rehearsal covers the historical delivery at commit `235697a`, which stays reproducible from its own recorded source snapshot; it fails package validation against the current, changed inventory and provenance by design, and that expected rejection is not a valid current candidate. Package integrity (`package_collateral.py validate`) must pass on the current refreshed delivery commit, using the recorded Python 3.9.6 environment, so a stale current package is a defect to refresh rather than an excuse. The current delivery is produced by the draft refresh workflow in the [handoff](docs/collateral-handoff.md#receiver-verification).

Readiness modes are expected to exit non-zero and report `BLOCKED` today:

```sh
python3 tools/validate_collateral.py --mode selected --select DEMO-SCREENSHOT-SET-001
python3 tools/validate_collateral.py --mode submission --select LAUNCH-X-KEY-VISUAL-001
```

The full validation sequence is in the [organization guide](docs/collateral-organization.md#mm-02-and-mm-05-policy-validation); package reproduction and receiver steps are in the [handoff](docs/collateral-handoff.md#receiver-verification). The render recipes (`node tools/render_collateral.mjs`, `python3 tools/render_rehearsal.py`) rewrite tracked evidence and need local Chrome, Node 22 or later and ffmpeg; see [visual verification](review/visual/verification.md) and [rehearsal verification](review/visual/rehearsal/verification.md).

## Docs

- Organization and inventory: [collateral organization](docs/collateral-organization.md) · [inventory](docs/collateral-inventory.json) · [handoff](docs/collateral-handoff.md)
- Claims: [messaging policy](messaging/README.md) · [claim ledger](messaging/claims.json) · [messaging checklist](review/messaging-checklist.md)
- Provenance and safety: [publication safety](review/publication-safety.md) · [provenance records](review/provenance.json) · [brand consumption](review/brand-consumption.md)
- Visual drafts: [workflow diagram](demo/diagrams/demo-workflow.svg) ([text equivalent](demo/diagrams/demo-workflow-alt-text.md)) · [fictional mockup](demo/screenshots/synthetic-stub-mockup.svg) ([description](demo/screenshots/synthetic-stub-alt-text.md)) · [support page](demo/deck/concept-overview.html) · [X key visual](launch/assets/x-submission-key-visual.svg) ([text alternative](launch/assets/x-submission-alt-text.md))
- Rehearsal: [video](demo/exports/silent-synthetic-rehearsal.mp4) · [scene map](demo/rehearsal-scenes.json) · [transcript](demo/rehearsal-transcript.md) · [author-only verification](review/visual/rehearsal/verification.md)
- Review: [visual verification and copy mapping](review/visual/verification.md) · [asset handoff](review/visual/asset-handoff.json) · [accessibility guide](review/accessibility.md) · [accessibility checklist](review/accessibility-checklist.md) · [release checklist](review/release-checklist.md) · [rehearsal review record](review/releases/v0.1.0-rehearsal.md)
- Architecture: [responsibilities](docs/architecture/OWNERSHIP.md) · [acceptance view](docs/architecture/ACCEPTANCE.md) · [architecture kit](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

## Related repositories

- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): identity, vocabulary and visual assets (consumed, never redefined here)
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): product behavior, the source for any product claim
- [landing-page-repo](https://github.com/Jevelopers-neatHack-2026/landing-page-repo): page composition and runtime; receives approved copy from `launch/`
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): acceptance checklist and sponsor/integration evidence
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): financial definitions and actuals

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md) and the [messaging checklist](review/messaging-checklist.md) before adding any public sentence. Update the [inventory](docs/collateral-inventory.json) and [provenance register](review/provenance.json) when tracked bytes change, then re-run the checks. No licence is declared for this repository.
