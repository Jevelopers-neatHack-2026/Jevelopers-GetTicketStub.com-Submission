<!-- GENERATED FILE - DO NOT EDIT BY HAND. Source: tokens/tokens.json, tokens/profile.json, tokens/mapping.json. Generator: tools/build_tokens.py (`make build-tokens`); `make check-tokens` fails on drift. tokens/tokens.json sha256 649e570dc1397ef78bc00b28127ce166d640a4187eb2889fb2f57cc54054f228. tokens/profile.json sha256 18ce404d9e9f667bcab5a6cc0a87ca7be9e9866c5b7e69bff0c529e21742fef3. tokens/mapping.json sha256 7db9104591711ff10a86f2fa26f2ec64fc995f3fb5eec9b7040be6ae363ffb45. -->
# Token coverage matrix

Profile `ticketstub-token-profile` 1.0.0. Every leaf of `tokens/tokens.json` appears once. 82 tokens: 64 exported as CSS variables, 40 also exposed in the Tailwind adapter, 18 source-only.

| Token path | Type | Source value | CSS variable | Tailwind | Status / notes |
|---|---|---|---|---|---|
| `color.orange` | color | `#E4572E` | `--ts-orange` | `colors.orange` | exported; Tailwind value is var(--ts-orange) |
| `color.copper` | color | `#B4693E` | `--ts-copper` | `colors.copper` | exported; Tailwind value is var(--ts-copper) |
| `color.moss` | color | `#26302A` | `--ts-moss` | `colors.moss` | exported; Tailwind value is var(--ts-moss) |
| `color.cyan` | color | `#7CC6D2` | `--ts-cyan` | `colors.cyan` | exported; Tailwind value is var(--ts-cyan) |
| `color.cream` | color | `#F4ECDD` | `--ts-cream` | `colors.cream` | exported; Tailwind value is var(--ts-cream) |
| `color.ink` | color | `#17140F` | `--ts-ink` | `colors.ink` | exported; Tailwind value is var(--ts-ink) |
| `semantic.day.bg` | color | `{color.cream}` | `--ts-bg` | `colors.bg` | day theme default on :root; Tailwind value is var(--ts-bg) |
| `semantic.day.surface` | color | `rgba(23, 20, 15, 0.05)` | `--ts-surface` | `colors.surface` | day theme default on :root; Tailwind value is var(--ts-surface) |
| `semantic.day.text` | color | `{color.ink}` | `--ts-text` | `colors.fg` | day theme default on :root; Tailwind value is var(--ts-text) |
| `semantic.day.text-muted` | color | `rgba(23, 20, 15, 0.66)` | `--ts-text-muted` | `colors.muted` | day theme default on :root; Tailwind value is var(--ts-text-muted) |
| `semantic.day.cta-bg` | color | `{color.orange}` | `--ts-cta-bg` | none | day theme default on :root |
| `semantic.day.cta-label` | color | `{color.ink}` | `--ts-cta-label` | none | day theme default on :root |
| `semantic.day.focus` | color | `{color.ink}` | `--ts-focus` | `colors.focus` | day theme default on :root; Tailwind value is var(--ts-focus) |
| `semantic.night.bg` | color | `{color.ink}` | `--ts-bg` | none | night override of the day variable |
| `semantic.night.surface` | color | `{color.moss}` | `--ts-surface` | none | night override of the day variable |
| `semantic.night.text` | color | `{color.cream}` | `--ts-text` | none | night override of the day variable |
| `semantic.night.text-muted` | color | `rgba(244, 236, 221, 0.66)` | `--ts-text-muted` | none | night override of the day variable |
| `semantic.night.cta-bg` | color | `{color.orange}` | `--ts-cta-bg` | none | night value equals day; no override emitted (cascade identical) |
| `semantic.night.cta-label` | color | `{color.ink}` | `--ts-cta-label` | none | night value equals day; no override emitted (cascade identical) |
| `semantic.night.focus` | color | `{color.cyan}` | `--ts-focus` | none | night override of the day variable |
| `gradient.foil` | gradient | `linear-gradient(135deg, #B4693E 0%, #E4572E 45%, #7CC6D2 100%)` | `--ts-foil` | `backgroundImage.foil` | exported; Tailwind value is var(--ts-foil) |
| `gradient.holo-spectrum` | gradient | `repeating-linear-gradient(118deg, hsl(348 92% 58%) 0, hsl(34 94% 60%) 26px, hsl(58 90% 62%) 50px, hsl(150 82% 58%) 76px, hsl(200 92% 60%) 102px, hsl(280 88% 62%) 128px, hsl(348 92% 58%) 152px)` | `--ts-holo-spectrum` | `backgroundImage.holo` | exported; Tailwind value is var(--ts-holo-spectrum) |
| `font.family.display` | fontFamily | `'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif` | `--ts-font-display` | `fontFamily.display` | exported; Tailwind value is the literal family list |
| `font.family.ui` | fontFamily | `'Inter Tight', 'Segoe UI', system-ui, -apple-system, sans-serif` | `--ts-font-ui` | `fontFamily.ui` | exported; Tailwind value is the literal family list |
| `font.weight.regular` | fontWeight | `400` | none | none | source-only: Not exported before 1.0.0 and no public CSS name exists; a new --ts-weight-* API needs consumer review. Consumers set weights from SPEC.md (display 560 and logo 600 are only reachable here). |
| `font.weight.medium` | fontWeight | `500` | none | none | source-only: Not exported before 1.0.0 and no public CSS name exists; a new --ts-weight-* API needs consumer review. Consumers set weights from SPEC.md (display 560 and logo 600 are only reachable here). |
| `font.weight.semibold` | fontWeight | `600` | none | none | source-only: Not exported before 1.0.0 and no public CSS name exists; a new --ts-weight-* API needs consumer review. Consumers set weights from SPEC.md (display 560 and logo 600 are only reachable here). |
| `font.weight.display` | fontWeight | `560` | none | none | source-only: Not exported before 1.0.0 and no public CSS name exists; a new --ts-weight-* API needs consumer review. Consumers set weights from SPEC.md (display 560 and logo 600 are only reachable here). |
| `font.weight.logo` | fontWeight | `600` | none | none | source-only: Not exported before 1.0.0 and no public CSS name exists; a new --ts-weight-* API needs consumer review. Consumers set weights from SPEC.md (display 560 and logo 600 are only reachable here). |
| `font.scale.-1` | dimension | `0.8rem` | `--ts-step--1` | `fontSize.step--1` | exported; Tailwind value is var(--ts-step--1) |
| `font.scale.0` | dimension | `1rem` | `--ts-step-0` | `fontSize.step-0` | exported; Tailwind value is var(--ts-step-0) |
| `font.scale.1` | dimension | `1.25rem` | `--ts-step-1` | `fontSize.step-1` | exported; Tailwind value is var(--ts-step-1) |
| `font.scale.2` | dimension | `1.563rem` | `--ts-step-2` | `fontSize.step-2` | exported; Tailwind value is var(--ts-step-2) |
| `font.scale.3` | dimension | `1.953rem` | `--ts-step-3` | `fontSize.step-3` | exported; Tailwind value is var(--ts-step-3) |
| `font.scale.4` | dimension | `2.441rem` | `--ts-step-4` | `fontSize.step-4` | exported; Tailwind value is var(--ts-step-4) |
| `font.scale.5` | dimension | `3.052rem` | `--ts-step-5` | `fontSize.step-5` | exported; Tailwind value is var(--ts-step-5) |
| `font.scale.6` | dimension | `3.815rem` | `--ts-step-6` | `fontSize.step-6` | exported; Tailwind value is var(--ts-step-6) |
| `font.line-height.tight` | number | `1.05` | `--ts-lh-tight` | none | exported |
| `font.line-height.heading` | number | `1.15` | `--ts-lh-heading` | none | exported |
| `font.line-height.body` | number | `1.5` | `--ts-lh-body` | none | exported |
| `font.tracking.display` | dimension | `-0.02em` | `--ts-track-display` | none | exported |
| `font.tracking.label` | dimension | `0.08em` | `--ts-track-label` | none | exported |
| `space.1` | dimension | `4px` | `--ts-space-1` | none | exported |
| `space.2` | dimension | `8px` | `--ts-space-2` | none | exported |
| `space.3` | dimension | `12px` | `--ts-space-3` | none | exported |
| `space.4` | dimension | `16px` | `--ts-space-4` | none | exported |
| `space.5` | dimension | `24px` | `--ts-space-5` | none | exported |
| `space.6` | dimension | `32px` | `--ts-space-6` | none | exported |
| `space.7` | dimension | `48px` | `--ts-space-7` | none | exported |
| `space.8` | dimension | `64px` | `--ts-space-8` | none | exported |
| `radius.paper` | dimension | `2px` | `--ts-radius-paper` | `borderRadius.paper` | exported; Tailwind value is var(--ts-radius-paper) |
| `radius.control` | dimension | `12px` | `--ts-radius-control` | `borderRadius.control` | exported; Tailwind value is var(--ts-radius-control) |
| `radius.sheet` | dimension | `20px` | `--ts-radius-sheet` | `borderRadius.sheet` | exported; Tailwind value is var(--ts-radius-sheet) |
| `radius.pill` | dimension | `999px` | `--ts-radius-pill` | `borderRadius.pill` | exported; Tailwind value is var(--ts-radius-pill) |
| `shadow.paper` | shadow | `0 1px 0 rgba(23,20,15,.06), 0 10px 24px -10px rgba(23,20,15,.45)` | `--ts-shadow-paper` | `boxShadow.paper` | exported; Tailwind value is var(--ts-shadow-paper) |
| `shadow.lifted` | shadow | `0 2px 0 rgba(23,20,15,.05), 0 24px 48px -16px rgba(23,20,15,.55)` | `--ts-shadow-lifted` | `boxShadow.lifted` | exported; Tailwind value is var(--ts-shadow-lifted) |
| `material.foil.glowRest` | number | `0.1` | none | none | source-only: Foil material runtime limits (docs/material-foil.md); no CSS or Tailwind output in profile 1.0.0. Read from tokens.json by the foil code; JS outputs deferred (BK-03B). |
| `material.foil.sheenMaxOpacity` | number | `0.5` | none | none | source-only: Foil material runtime limits (docs/material-foil.md); no CSS or Tailwind output in profile 1.0.0. Read from tokens.json by the foil code; JS outputs deferred (BK-03B). |
| `material.foil.glareMaxAlpha` | number | `0.3` | none | none | source-only: Foil material runtime limits (docs/material-foil.md); no CSS or Tailwind output in profile 1.0.0. Read from tokens.json by the foil code; JS outputs deferred (BK-03B). |
| `material.foil.maxOpacityStepPerFrame` | number | `0.02` | none | none | source-only: Foil material runtime limits (docs/material-foil.md); no CSS or Tailwind output in profile 1.0.0. Read from tokens.json by the foil code; JS outputs deferred (BK-03B). |
| `motion.duration.track` | duration | `80ms` | `--ts-dur-track` | `transitionDuration.track` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-track) |
| `motion.duration.quick` | duration | `160ms` | `--ts-dur-quick` | `transitionDuration.quick` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-quick) |
| `motion.duration.base` | duration | `240ms` | `--ts-dur-base` | `transitionDuration.base` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-base) |
| `motion.duration.settle` | duration | `380ms` | `--ts-dur-settle` | `transitionDuration.settle` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-settle) |
| `motion.duration.reveal` | duration | `600ms` | `--ts-dur-reveal` | `transitionDuration.reveal` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-reveal) |
| `motion.duration.shutter` | duration | `320ms` | `--ts-dur-shutter` | `transitionDuration.shutter` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-shutter) |
| `motion.duration.print-sweep` | duration | `2600ms` | `--ts-dur-print-sweep` | `transitionDuration.print-sweep` | exported; reduced motion: 0ms; Tailwind value is var(--ts-dur-print-sweep) |
| `motion.easing.standard` | cubicBezier | `cubic-bezier(.2,.8,.2,1)` | `--ts-ease-standard` | `transitionTimingFunction.standard` | exported; Tailwind value is var(--ts-ease-standard) |
| `motion.easing.enter` | cubicBezier | `cubic-bezier(.16,1,.3,1)` | `--ts-ease-enter` | `transitionTimingFunction.enter` | exported; Tailwind value is var(--ts-ease-enter) |
| `motion.easing.exit` | cubicBezier | `cubic-bezier(.4,0,1,1)` | `--ts-ease-exit` | `transitionTimingFunction.exit` | exported; Tailwind value is var(--ts-ease-exit) |
| `motion.easing.flip` | cubicBezier | `cubic-bezier(.45,0,.55,1)` | `--ts-ease-flip` | `transitionTimingFunction.flip` | exported; Tailwind value is var(--ts-ease-flip) |
| `motion.smoothing.tauTiltMs` | number | `110` | none | none | source-only: Exponential-smoothing time constant for foil inputs (docs/material-foil.md). Unit ms is declared in the source. No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit ms declared in source |
| `motion.smoothing.tauLightMs` | number | `90` | none | none | source-only: Exponential-smoothing time constant for foil inputs (docs/material-foil.md). Unit ms is declared in the source. No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit ms declared in source |
| `motion.smoothing.tauGlowInMs` | number | `400` | none | none | source-only: Exponential-smoothing time constant for foil inputs (docs/material-foil.md). Unit ms is declared in the source. No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit ms declared in source |
| `motion.smoothing.tauGlowOutMs` | number | `600` | none | none | source-only: Exponential-smoothing time constant for foil inputs (docs/material-foil.md). Unit ms is declared in the source. No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit ms declared in source |
| `motion.smoothing.maxDtMs` | number | `50` | none | none | source-only: Exponential-smoothing time constant for foil inputs (docs/material-foil.md). Unit ms is declared in the source. No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit ms declared in source |
| `motion.spring.stiffness` | number | `0.055` | none | none | source-only: Drag-spin spring parameter stepped by consumer code (docs/motion-sound-haptics.md). No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B). |
| `motion.spring.damping` | number | `0.9` | none | none | source-only: Drag-spin spring parameter stepped by consumer code (docs/motion-sound-haptics.md). No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B). |
| `motion.spring.stepHz` | number | `60` | none | none | source-only: Drag-spin spring parameter stepped by consumer code (docs/motion-sound-haptics.md). No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B).; unit hz declared in source |
| `motion.spring.maxVelocity` | number | `34` | none | none | source-only: Drag-spin spring parameter stepped by consumer code (docs/motion-sound-haptics.md). No CSS or Tailwind output in profile 1.0.0; JS outputs deferred (BK-03B). |
| `motion.tilt.maxDeg` | number | `11` | `--ts-tilt-max` | none | exported; unit deg declared in source |
| `motion.tilt.perspective` | dimension | `1400px` | `--ts-perspective` | none | exported |

## Theme rules

- Default (`:root`): `semantic.day`.
- Night (`.ts-night, :root[data-theme="dark"]`, and under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`): `semantic.night` where it differs from day, plus `color-scheme: dark`.
- Night variables emitted: `--ts-bg`, `--ts-surface`, `--ts-text`, `--ts-text-muted`, `--ts-focus`.

## Reduced-motion rules

`@media (prefers-reduced-motion: reduce)` sets these variables to `0ms` on `:root`:

- `--ts-dur-track` (`motion.duration.track`): pointer/gyro follow; tilt is disabled under reduced motion
- `--ts-dur-quick` (`motion.duration.quick`): chip/toolbar appear becomes instant
- `--ts-dur-base` (`motion.duration.base`): sheets, toasts and style swaps become instant
- `--ts-dur-settle` (`motion.duration.settle`): tilt return and card flip become instant
- `--ts-dur-reveal` (`motion.duration.reveal`): stub landing becomes instant
- `--ts-dur-shutter` (`motion.duration.shutter`): print-complete flash is non-essential motion
- `--ts-dur-print-sweep` (`motion.duration.print-sweep`): non-essential decorative loop: a zero duration leaves the foil sweep static (a still sheen); consumers still own the animation itself

Non-essential looping motion (print-sweep) is static under reduced motion. This file only sets duration variables; stopping runtime animation (tilt, spin, glitch, sound) is consumer-owned.
