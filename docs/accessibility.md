# Accessibility evidence and supported sample uses

This is local BK-08 validation of the existing source colors and adapters. The
identity decision in [#9](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9),
font-provider decision in [#14](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14),
named accessibility review and consumer acceptance remain pending. Passing a
calculation or a local browser fixture does not approve an asset or certify an app.

## Computation and thresholds

The [generated matrix](accessibility/contrast-report.md) and its
[machine-readable report](accessibility/contrast-report.json) are generated from
`tokens/tokens.json` with the existing profile and alias resolver. Both record the
actual input hashes; the JSON also records the generator hash and raw ratios.

The method uses encoded sRGB channels in the range 0–1. A translucent surface is
first composited over its opaque theme background; translucent text is then
composited over that resulting surface. Each composited channel is linearized
using the WCAG breakpoint 0.04045. Relative luminance is
`0.2126R + 0.7152G + 0.0722B`; the ratio is `(Llighter + 0.05)/(Ldarker + 0.05)`.
Intermediate channels are not quantized and ratios are not rounded for a decision.
Displayed ratios use two decimals. Approximate hexadecimal composite colors are
for illustration, not replacement source tokens.

| Intended use | Threshold | Source / qualification |
|---|---:|---|
| Normal text, including active control labels and meaningful placeholder text | 4.5:1 | [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) |
| Large text | 3:1 | At least 18pt / 24 CSS px, or 14pt bold / 56÷3 CSS px, measured at delivered size. The kit's weight 600 is not automatically treated as bold. User zoom does not turn an initially failing small label into an allowed large label. |
| Meaningful control boundary or custom focus indicator against adjacent colors | 3:1 | [SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html); a visible focus state is also required. A ratio does not prove keyboard reachability or lack of occlusion. |
| Logotypes and pure decoration | Narrow exceptions | A logo exception is not an exception for body copy, icons carrying information, button labels or a focus outline. Prefer a legible mark and an accessible name when a logo is a link. |

## Current measured restrictions

The six palette colors and their semantic values are unchanged. Numerical
restrictions below describe measured use, not an additional brand approval.

| Pair or treatment | Measured result | Sample use |
|---|---:|---|
| Ink on orange | 4.986501:1 | Normal CTA labels; keep the existing ink label token. |
| Orange on cream | 3.137562:1 | Large text only; not body text. |
| Copper on cream | 3.555839:1 | Large text only; not body text. |
| Copper on ink | 4.399935:1 | Fails normal text even though rounding to one decimal gives 4.4. Use cream for ordinary copy. |
| Orange on moss | 3.705590:1 | Large text or measured non-text use; not body text. |
| Copper on moss | 3.269698:1 | Large text or measured non-text use; not body text. |
| Muted ink, 66%, on cream | 5.532483:1 | Normal text; the earlier 5.6:1 description is corrected to 5.5:1 at one decimal. |
| Muted cream, 66%, on ink / moss | 7.292514:1 / 5.988783:1 | Normal text on these exact backgrounds. Recompute over a different image, tint or opacity. |
| Cyan directly touching orange | 1.905679:1 | Prohibited as the sole meaningful focus boundary. |
| Day tint or moss against the respective page background | Below 3:1 | Decorative grouping only. Meaningful inputs need a measured border or other sufficient identifying cue. |

The fixture uses `--ts-text` for meaningful input borders, and a 3px
`--ts-focus` outline with a 4px gap. That gap exposes the surrounding cream,
composited day surface, ink or moss; it prevents the night cyan outline from
touching the orange button. Consumers must check the actual adjacent surface,
including clipping and overlays. A ring drawn directly on cyan or orange is not
covered by these examples. Forced-colors mode keeps a system-color focus outline.

The browser checker measures actual outline color/style and composited adjacent
surface contrast, and checks clipping ancestors as well as each text/control box.
`make check-accessibility-browser` also runs synthetic regressions: a transparent
focus outline and a short parent with hidden overflow must fail for their specific
assertion reason. An unavailable browser fails the prerequisite; it cannot count
as a successful negative test. These cases address two reproduced false passes
in the first checker, retained in the integration evidence.

Do not put essential labels over the foil gradient or busy event artwork without
an opaque, measured text plate. Contrast must hold at the worst location behind
the content. A ratio for two gradient stops does not establish the ratio across
the gradient. Text, shape and accessible names accompany status colors.

## Themes and runtime responsibilities

The local fixture imports the generated [token CSS](../tokens/tokens.css).
It follows the existing contract: light by default; OS dark unless the document
sets `data-theme="light"`; explicit `data-theme="dark"`; and a `.ts-night`
subtree. A light document can contain a night subtree. There is currently no
public `.ts-day` subtree adapter, so consumers must not assume one exists.

This demonstrates both existing source themes. It does not decide whether the
product app should remain on paper; [PR #3](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/3)
and BK-02 retain that owner decision. A consumer choosing explicit light should
set it before first paint and test its own color-scheme, controls and hydration.

## Typography and unavailable fonts

The fixture uses the token Fraunces and Inter Tight stacks. It has an explicit
generic-fallback switch and makes no font request. Existing TTFs are outline-build
source inputs and are not served by this fixture. No self-hosted font route is
introduced. Approved external-provider behavior, families, axes, privacy, CSP and
availability remain the [distribution proposal](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14)'s
responsibility. Fallback evidence cannot stand in for font-available evidence.

Sample long titles, labels, dates, seats and prices wrap without fixed text
heights. Data uses `font-variant-numeric: tabular-nums`; platform fallback fonts
may support different numeric features. Test real strings and locales in each
consumer. The [resize text guidance](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html)
requires text to remain usable at 200%. Automated CSS `zoom: 2` at a 640px
viewport is explicitly a layout proxy, not a claim that actual browser zoom or
every assistive technology was tested.

## Motion

The source profile's reduced-motion rules set all seven duration variables,
including shutter and print-sweep, to `0ms`. The Tailwind adapter reads those
same variables. This does not cancel JavaScript requestAnimationFrame loops,
device-orientation subscriptions, audio, or animations that impose their own
minimum duration. Consumer owners must stop nonessential tilt, spin, glare,
reveal, shutter and print loops and expose the same information through a static
state and text. Essential status must not depend on motion, sound or haptics.

The fixture uses a single decorative sweep with a pause control. Under
`prefers-reduced-motion: reduce` it sets `animation: none`, `transition: none`
and `transform: none`, independently of duration values. It contains no sound,
gyro or haptics. [SC 2.3.3 animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
is Level AAA guidance; these examples do not elevate it to an AA claim or certify
the application's animation/flash behavior.

## Reproduce

```sh
make build-accessibility
make check-accessibility
python3 -I tools/check_accessibility.py pair --foreground color.ink --background color.orange --use normal-text
# Expected nonzero negative controls:
python3 -I tools/check_accessibility.py pair --foreground color.orange --background color.cream --use normal-text
python3 -I tools/check_accessibility.py pair --foreground color.copper --background color.ink --use normal-text
python3 -I tools/check_accessibility.py pair --foreground color.cyan --background color.orange --use ui

# Install the exact browser tool dependency and its matching browser once:
npm ci --prefix tools/browser-dev --ignore-scripts --no-audit --no-fund
node tools/browser-dev/node_modules/playwright/cli.js install chromium
make check-accessibility-browser
```

`build-accessibility` writes deterministic tracked reports.
`check-accessibility` checks required measured sample pairs, report drift,
fixture inputs/variable names and the negative unit cases; it is offline.
`check-accessibility-browser` uses Playwright **1.56.1**, pinned with npm
integrity hashes in [the lockfile](../tools/browser-dev/package-lock.json).
Playwright's source/license is [Microsoft Playwright, Apache-2.0](https://github.com/microsoft/playwright/tree/v1.56.1).
Browser binaries are development dependencies installed locally, not distributed
brand assets. Browser availability errors are nonzero, not skipped passes.

The browser runner binds a short-lived server to loopback, serves only four
known fixture routes, blocks all other browser requests, and writes a new
timestamped directory under `out/brand/accessibility-browser/` on every run.
Its report records source revision, dirty-worktree status, input hashes, runtime,
browser version, cases and screenshots. It preserves failures and does not
overwrite earlier runs. A pass covers only the explicit local fixture cases;
the report always retains the required follow-up list and `release_eligible: false`.

For manual inspection, run `python3 -m http.server --bind 127.0.0.1 8000` from
the checkout and open `http://127.0.0.1:8000/tools/accessibility-fixture/`.
Review OS light/dark, explicit overrides and night subtree; Tab through every
control; test fonts unavailable and, after provider approval, available; use
real 200% browser zoom and narrow width; enable reduced motion and forced
colors. Record date, source SHA, browser/OS/font versions, screenshots, failures,
exclusions and reviewer verdict. Stop the local server afterward.

## Remaining acceptance

BK-08 remains open until the exact identity/font choices and usage restrictions
have accountable review, actual approved-font and browser-zoom evidence exists,
and consumer limitations are acknowledged. The source matrix and synthetic
fixture are reusable producer evidence for that review. They do not update
ART-05, EVAL-04, or any integration-evals state.
