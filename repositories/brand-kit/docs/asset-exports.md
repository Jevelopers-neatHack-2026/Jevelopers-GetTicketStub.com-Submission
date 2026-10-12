# Canonical logo builds and local raster review

**BK-04 status: implemented tooling, pending identity/rights/accountable visual acceptance.**
There are no approved exports. These commands create **local review-only artifacts**,
never a release package. Every build manifest records `release_eligible: false` and
`approval_reference: null`. The [governance rules](brand-governance.md),
[BK-02 identity decision](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9),
[BK-06 provenance review](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/7)
and [BK-04 visual acceptance](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/11)
remain required. A green build records neither permission nor approval.

## Canonical inputs and compatibility

The existing 14 files in `logo/` remain canonical. `tools/build_logos.py` shapes the
bundled Fraunces font with HarfBuzz and emits closed glyph outlines. The builder
regenerates them into a temporary directory and requires an exact byte match with
`logo/` before any PNG is produced. It does not accept screenshots, low-resolution
references, mockups, resized photographs or previously rasterized marks as inputs.
Screenshots and review sheets are QA captures only; they cannot replace canonical
vectors, source provenance or a dated approval record.

The source font is `fonts/Fraunces[SOFT,WONK,opsz,wght].ttf`, SHA-256
`177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb`.
Its existing notice is [Fraunces-OFL.txt](../fonts/Fraunces-OFL.txt). This is a
source-only use to build outlines. The review outputs contain no TTF/WOFF or other
font binaries, and add no self-hosted font delivery.

The generator preserves the original palette literals to avoid changing existing
SVG bytes, but now checks every used color against `tokens/tokens.json` before
writing: `orange`, `copper`, `cyan`, `cream` and `ink`. A changed font hash, package
version or palette mismatch stops the build. This checks parity with the current
palette; the palette still requires the accountable identity decision.

No tracked logo filename, content, size rule, consumer path or export approval is
changed by this tooling. New outputs live under `build/asset-review/`; they are not
consumer pins or entries in the production allowlist. The provenance/distribution
owner must assess exact proposed files and hashes separately before any release.

## Pinned setup

The tested build profile is Python **3.12.14**, **Linux x86_64**, and **Inkscape
1.2.2 (b0a8486541, 2022-12-01)**. [toolchain.json](../tools/assets/toolchain.json)
is the executable version declaration; a mismatch fails with a nonzero exit.
[requirements.txt](../tools/assets/requirements.txt) pins and hashes the Python
3.12 Linux wheels. The build itself performs no network requests.

```sh
python3.12 -m venv .venv-assets
.venv-assets/bin/python -m pip install --only-binary=:all: --require-hashes -r tools/assets/requirements.txt
inkscape --version
make build-assets PYTHON=.venv-assets/bin/python
make check-assets PYTHON=.venv-assets/bin/python
```

Provision the exact Inkscape version through the local development environment;
the scripts never install or silently upgrade native software. On another OS,
architecture, Python patch or native renderer stack, reproduce the outline and
pixel comparisons in a separate proposed profile before changing the lock. Do not
delete dependency hashes to make a different environment appear tested.

| Build dependency | Pin | Existing package license metadata / use |
|---|---|---|
| fonttools | 4.66.1 | MIT; variable font instancing and outline/bounds handling |
| uharfbuzz | 0.56.3 | Apache License 2.0; glyph shaping (bundled HarfBuzz reports 14.6.0) |
| Pillow | 12.3.0 | MIT-CMU; PNG metadata normalization and synthetic QA sheets |
| Inkscape | 1.2.2, exact build string above | GPL-2.0-or-later; local vector rasterization, not redistributed by this repository |

The manifest also records the actual Inkscape executable SHA-256, its
`--debug-info` library/OS report and Python's zlib runtime version. The tested
native report identifies Cairo 1.18.0 on Ubuntu 24.04.3 LTS. The renderer version
is locked, while native binary/library fingerprints are recorded for comparison;
this does **not** claim identical output across arbitrary native builds carrying
the same version number.

## Commands and exit semantics

```sh
# Legacy canonical SVG rebuild, now guarded by palette/font/package pins.
.venv-assets/bin/python tools/build_logos.py
git diff --exit-code -- logo

# Underlying commands for the stable Make targets.
.venv-assets/bin/python -I tools/build_assets.py build
.venv-assets/bin/python -I tools/build_assets.py check
.venv-assets/bin/python -m unittest tools/tests/test_assets.py -v

# Validate individual review files. Invalid input exits 1; usage errors exit 2.
.venv-assets/bin/python -I tools/check_asset.py svg logo/ts-stamp.svg
.venv-assets/bin/python -I tools/check_asset.py png build/asset-review/png/app-icon-1024.png --width 1024 --height 1024 --alpha opaque
```

`build-assets` builds into `build/asset-review/`. It reuses an existing destination
only if the entire generated file set and every byte are identical; it never
overwrites a stale candidate or someone's additional files. Preserve that
candidate and choose a fresh destination with `--output-dir` after source changes.
Temporary staging is cleaned up if a build fails; preserve the failure transcript.

`check-assets` builds twice in independent temporary directories and compares the
complete file lists and SHA-256 hashes, including QA sheets and the manifest. It
also runs the negative-fixture unit tests through the Make target. A zero exit
means these stated **offline structural/reproducibility checks** passed. Missing
dependencies, source drift, invalid SVG/PNG or unequal builds return nonzero.
Required owner approval and physical print proof remain pending regardless of
the exit code; this target does not replace the fail-closed production provenance
check.

Each manifest pins the source commit, every input file hash and any input changes
in the working tree. It records generator, validator, test, matrix, dependency
lock, token, font/notice and canonical SVG inputs. A source change during a build
fails the run. Use a clean candidate checkout for acceptance; a dirty working-tree
run is development evidence only. The manifest contains hashes of its output
files but not a recursive hash of itself; the command prints its manifest hash.

## Supported output matrix

The machine-readable [export matrix](../tools/assets/export-matrix.json) must cover
the canonical SVG inventory exactly. **All entries below are unapproved local
review candidates.** The matrix does not change the permitted-use guidelines.

The validator binds each canonical filename to its required review role,
contrasting backgrounds and knockout/currentColor expectations. Relabeling a
stamp cannot silently remove its 24 px/8 mm checks, and deleting or resizing a
required 16/24/32 px favicon or 1024 px app-icon row fails. PNG inspection checks
fixed metadata lengths/content and chunk order as well as CRCs and decoded pixels.
Independent review reproduced missing-coverage and malformed-metadata false
passes in the first implementation; the retained mutation regressions reject them.

| Canonical SVG(s) | PNG candidate | Supported review context |
|---|---|---|
| `ts-stamp.svg` | SVG primary; no distribution PNG | Cream or ink; full-color stamp |
| `ts-stamp-mono-orange.svg` | SVG primary | Cream or ink; transparent glyph knockout |
| `ts-stamp-mono-ink.svg` | SVG primary | Cream; transparent glyph knockout |
| `ts-stamp-mono-cream.svg` | SVG primary | Ink; transparent glyph knockout |
| `ts-stamp-currentcolor.svg` | No generic PNG | Explicit ink on cream or cream on ink; SVG inherits foreground only when used inline |
| `wordmark.svg` | SVG primary | Ink lettering on cream, at least 120 px wide |
| `wordmark-cream.svg` | SVG primary | Cream lettering on ink, at least 120 px wide |
| `wordmark-orange.svg` | SVG primary | Orange on cream or ink, at least 120 px wide |
| `wordmark-compact.svg` | SVG primary | Ink on cream; compare 119 px and the 120 px boundary |
| `lockup-horizontal.svg`, `lockup-stacked.svg` | SVG primary | Cream, because wordmark lettering is ink |
| `lockup-horizontal-mono.svg` | No generic PNG | Explicit ink on cream or cream on ink |
| `favicon.svg` | `favicon-16.png`, `favicon-24.png`, `favicon-32.png` | 16×16, 24×24 and 32×32; transparent RGBA |
| `app-icon.svg` | `app-icon-1024.png` | 1024×1024; opaque ink background; square with no corner mask |

PNG is reserved for favicon fallback review and the explicitly required app icon.
The other variants keep vector fidelity and adaptive sizing; their contextual PNG
renders are QA evidence, not additional distribution assets. `currentColor`
cannot remain dynamic inside a PNG, so the renderer rejects a missing explicit
foreground. A standalone SVG in an HTML `<img>` also does not inherit the host
page's `color`; consumers must use an appropriate fixed-color file or a reviewed
inline SVG integration.

JPEG, WebP, ICO, PDF, EPS, CMYK separations and font files are unsupported outputs.
No print-provider request, app-store upload or publication command is provided.

## Raster and visual QA contract

PNGs come directly from validated vectors with Inkscape page export, explicit
pixel dimensions, transparent export background and 8-bit RGBA. The app icon's
opaque background is already part of its vector. Integer rounding preserves the
viewBox ratio with `xMidYMid meet`; any fractional pixel mismatch becomes small
letterboxing, never stretched glyphs.

Pillow re-encodes the resulting pixels with only PNG structure, sRGB perceptual
intent and physical-resolution metadata. It excludes clock, text, ICC and other
renderer metadata, uses compression level 9 and records both encoded SHA-256 and
decoded RGBA SHA-256. Thus a future encoder change can be distinguished from a
pixel change; this check currently requires identical file bytes across both
builds. Screen exports use 96 DPI metadata. SVG brand colors are interpreted as
sRGB; there is no CMYK conversion or print color proof.

The review build contains `review.html`, individual native-resolution renders,
`qa/contact-*.png` sheets, synthetic opaque-plate examples, the native 1024 px
app icon, `manifest.json` and a `LOCAL-REVIEW-ONLY.txt` notice. No external imagery,
source font binary or remotely fetched resource appears in those outputs.

| Review case | Size and context | Automated evidence / remaining human work |
|---|---|---|
| Favicon | 16, 24, 32 CSS px at 1x/2x, cream/ink | RGBA/dimensions, interior knockout and snapshots; accountable reviewer assesses small lettering |
| Stamp | 24 CSS px tall at 1x/2x, supported cream/ink variants | Bounds, transparency and knockout; reviewer assesses detail and recognizability |
| Print stamp | 95 px tall at 300 DPI, 190 px at 600 DPI | About 8.04 mm after rounding up; physical print proof remains unperformed |
| Wordmark | 120 px perforated; compact at 119/120 px; 1x/2x | Boundary comparison and outline bounds; reviewer confirms legibility |
| Lockups | Horizontal 240 px, stacked 180 px; 1x/2x | Review sample sizes, not newly approved minima |
| App icon | Native 1024×1024 plus 256 CSS px 1x/2x previews | Dimensions, fully opaque alpha, no clipping; native-size human inspection |
| Busy imagery | Synthetic stripes under opaque cream/ink plates, mono stamps only | Plate/knockout rendering; no reference image permissions inferred |
| Dynamic foreground | `currentColor` resolved explicitly for each background | Missing-context negative test; compare ink/cream variants |

Same-color foreground/background combinations and full-color marks over bare
imagery are excluded. The manifest names the skipped cream/ink combinations and
their reasons. These are unsupported contexts, not passed visual tests. The
automated bounds and alpha checks cannot judge brand quality or recognize text.
The generated manifest therefore leaves every manual-review field pending.

At the unchanged 24 px full-color stamp, antialiasing can leave partially covered
pixels at every edge bite: the observed alpha range is 34–255. This is genuine
transparency, even without an alpha-zero pixel. Mono glyph knockouts still require
an alpha-zero interior sample. This distinction avoids silently flattening the
mark or falsely rejecting the canonical small-size render.

## Retained development failures

These are local development observations on a dirty checkout based on
`3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`, **not acceptance evidence**.

| UTC date | Executed command / outcome | Preserved cause and resolution |
|---|---|---|
| 2026-10-12 | `python -m unittest tools/tests/test_assets.py -v`: 18 tests, one failure | The synthetic zero-area `M1 1Z` outline was accepted. `tools/asset_lib.py` SHA-256 at failure: `5cae02ad39ea5894d6833b99e32f0ef02c3602962688b128cc641b168976f02a`. Reject zero-width/height outline bounds; preserve regression case. |
| 2026-10-12 | `python -I tools/build_assets.py build --output-dir ../asset-review-first`: exit 1 | The alpha rule wrongly demanded a fully clear pixel in the antialiased 24 px full-color stamp. Validator then: `e05659b6a9bb07ab2187cbaa6fa799b9e3194c5e02373d5f46b4b6ba59ee3aa7`; builder: `184bbe35fd465780db69510891dece8caddb6e4a1cd1d23b908baeb8cb178a61`. Correct the transparency rule and add a regression test; no vector changed. |

Both runs used the isolated pinned Python environment specified above. Required
merged-candidate verification and its actual revision/results are recorded in the
PR evidence after integration. Review/rights approvals and consumer ACKs must be
linked to the actual accountable people; this document supplies none on their behalf.
