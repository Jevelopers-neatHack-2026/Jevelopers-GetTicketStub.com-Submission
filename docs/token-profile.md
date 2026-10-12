# Token profile and build (BK-03A)

[`tokens/tokens.json`](../tokens/tokens.json) is the canonical value source. This page documents the profile it follows, the two rule files beside it, the generator, the compatibility promises and the migration notes. Nothing here records an approval: the identity is not ratified, the A + B direction (paper by day, foil by night) stays the baseline pending owner ratification, and [PR #3](https://github.com/Jevelopers-neatHack-2026/brand-kit/pull/3)'s "always on paper" proposal is **not** adopted. Issue [BK-03A #10](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/10) is closed on GitHub as observed on 2026-10-12. Its implemented build/profile slice does not supply BK-02 identity approval or the affected consumer reviews; those missing acceptance inputs remain explicit for distribution and the release gate.

## Profile, not DTCG

The source is shaped like the [W3C Design Tokens format](https://www.designtokens.org/) (`$value`, `$type`, `$description`, `{group.name}` aliases) but **this repository does not claim DTCG compatibility**: no pinned DTCG validator has been run against it, and the profile departs from the format on purpose (CSS-string gradients and shadows, a `number` unit extension, only `px`/`rem`/`em` dimensions). The profile is `ticketstub-token-profile` **1.0.0**, declared in `tokens.json` (`$extensions["com.ticketstub"]`) and in [`tokens/profile.json`](../tokens/profile.json). They must agree. The "parser" is the standard-library validator in [`tools/token_lib.py`](../tools/token_lib.py) (Python 3.9+); there is no third-party schema dependency.

| Type | Accepts | Rejected examples |
|---|---|---|
| `color` | `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` (comma or space syntax, channels 0 to 255, alpha 0 to 1) or an alias | `#12345`, alpha above 1 |
| `dimension` | number with `px`, `rem` or `em` | `4pt`, `4`, `12 px` |
| `duration` | non-negative number with `ms` | `0.24s`, `240` |
| `number` | JSON number; optional `$extensions["com.ticketstub"].unit` of `ms`, `deg` or `hz` | `"400"`, `true`, unit `px` |
| `fontWeight` | integer 1 to 1000 | `"400"`, `400.5` |
| `fontFamily` | two or more comma-separated names ending in a generic family | a list with no generic fallback |
| `cubicBezier` | `cubic-bezier(x1, y1, x2, y2)`, x values in 0 to 1 | `cubic-bezier(1.5,0,.55,1)` |
| `gradient` (extension) | one balanced `linear-gradient()` or `repeating-linear-gradient()` string | embedded aliases |
| `shadow` (extension) | comma-separated layers of 2 to 4 lengths then a colour | stray CSS syntax |

Structure rules: every leaf is `{ "$value": ... }` with a `$type` on it or an ancestor; bare scalars, empty groups, unknown `$` keys, unknown top-level groups, duplicate JSON keys and non-finite numbers are errors. Values may not contain `;`, `<`, `>`, `@`, comment markers or `url(`, so a token cannot inject CSS. An alias must be the whole value, must point at a token (not a group) of the same `$type`, and may not form a cycle (`alias cycle: a -> b -> a`).

**New fields.** Adding a token or group is a three-file change: the value in `tokens.json`, an entry in [`tokens/mapping.json`](../tokens/mapping.json) (an output name or a `source_only` rationale), and for a new top-level group the profile's `top_level_groups`. The check fails until all agree, so nothing is exported or dropped by accident.

## Files

| File | Role | Edited by |
|---|---|---|
| `tokens/tokens.json` | values, types, descriptions | hand |
| `tokens/profile.json` | types and units, **theme rules, reduced-motion rules, external-font policy**, Tailwind sections | hand |
| `tokens/mapping.json` | per-token outputs: CSS name, optional Tailwind key, or `source_only` rationale | hand |
| `tokens/tokens.css` | CSS custom properties, night theme, reduced motion. Loads nothing. | generated |
| `tokens/tailwind.preset.js` | Tailwind adapter; every value is a `var(--ts-*)` except font stacks | generated |
| `tokens/external-fonts-google.css` | opt-in legacy web-font import (see below) | generated |
| `tokens/token-matrix.md` | [path-to-output matrix](../tokens/token-matrix.md) for every token | generated |

Generated files start with a header naming the source, the generator and the SHA-256 of each input, and say not to edit them. A hand edit, a stale output, a missing output or an unexpected file in `tokens/` fails `make check-tokens`.

## Commands

```sh
make build-tokens           # validate, then write the four generated files
make check-tokens           # offline: validate, build twice, compare, drift, parity, token unit tests
make check-tokens-tailwind  # npm ci from the lockfile, then a real Tailwind build (needs network, Node 18+)
```

`make check` runs `check-tokens` (not the Tailwind target, which needs npm). All three exit non-zero on any problem or missing input, publish nothing, call no paid service and touch no consumer repository. `python3 -I tools/build_tokens.py validate|build|check [--root DIR] [--print-hashes]` is the underlying entry point; `--root` points it at an alternate checkout, which is how the invalid-fixture tests drive it.

`check-tokens` verifies, in order: schema, types, units, aliases and mapping coverage; two builds of the same inputs give the same file set and bytes; the committed outputs equal a fresh build (with a diff of the first differences); no `@import`, `@font-face` or `url()` in `tokens.css`; no hardcoded duration in the preset; and that every exported variable, resolved through the generated CSS in the day, night (class, attribute, media) and reduced-motion contexts, equals the value resolved from the JSON source. It does not render in a browser; **no visual or browser verification is claimed**.

## Supported consumers

- **CSS custom properties.** Public names are the pre-existing `--ts-*` names, unchanged. Values equal the pre-BK-03A `tokens.css` (the unit tests compare against a recorded copy of the file at `91157ac`) except where listed under migration.
- **Tailwind CSS 3.4.x.** Pinned and tested with **3.4.19** ([`tools/tokens-dev/package.json`](../tools/tokens-dev/package.json) plus lockfile, Node v24.15.0 on the verification run, any Node 18+ expected to work). Tailwind 4 is not supported or tested. The preset still uses `var()` colours, so Tailwind's `/opacity` colour modifiers do not work (unchanged).
- **JavaScript or other runtimes.** No JS token output exists in 1.0.0. Material, smoothing and spring values are read from `tokens.json` directly; a JS export is deferred to [BK-03B](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14).

### Tailwind coverage and unmapped tokens

Exposed (unchanged keys): `colors` (palette plus `bg`, `surface`, `fg`, `muted`, `focus`), `backgroundImage` (`foil`, `holo`), `fontFamily`, `fontSize` (`step-*`), `borderRadius`, `boxShadow`, `transitionTimingFunction`, `transitionDuration`.

Added (additive, no existing key changed): `rounded-pill`, `duration-shutter`, `duration-print-sweep`.

Not exposed in Tailwind (use the CSS variable, for example `bg-[var(--ts-cta-bg)]`): `cta-bg`, `cta-label`, `space-*` (Tailwind's numeric spacing keys would collide with different values), line heights and tracking (`leading-tight` would override a Tailwind default), weights, material, smoothing, spring, tilt and perspective. The reasons are in the matrix.

## Themes and scoping

Rules live in `profile.json` (`themes`), so the CSS selectors are generated, not hand-written. Behaviour is the pre-BK-03A behaviour:

- Day is declared on `:root` and is the default.
- Night redeclares only the variables whose value differs from day (`--ts-cta-bg` and `--ts-cta-label` are equal, so they are not re-declared) plus `color-scheme: dark`.
- `.ts-night` scopes night to a subtree; `:root[data-theme="dark"]` forces the whole document; `@media (prefers-color-scheme: dark)` on `:root:not([data-theme="light"])` follows the OS unless the page sets `data-theme="light"`.
- `semantic.day`/`semantic.night` must have the same keys and the same CSS names, or the check fails. Because the Tailwind preset only references variables, themes switch without a rebuild.

## Motion and reduced motion

Durations are tokens and Tailwind's `duration-*` utilities use the same variables, so the reduced-motion override reaches Tailwind output too. The rule lives in `profile.json` (`reduced_motion`):

| Duration | Reduced motion | Note |
|---|---|---|
| `track`, `quick`, `base`, `settle`, `reveal` | `0ms` | as before |
| `shutter` | `0ms` | as before; the print-complete flash is non-essential |
| `print-sweep` | `0ms` (new) | the foil sweep is a non-essential loop; a zero duration leaves it static (a still sheen). It was not overridden before, so users who prefer reduced motion previously still got a 2.6 s loop wherever the variable was used. |

Every duration token must appear in that list or `make check-tokens` fails, so a new duration cannot skip the policy. The tokens only set CSS variables. Stopping tilt, spin, glitch and sound is consumer-owned runtime behaviour (see [motion, sound and haptics](motion-sound-haptics.md)), as is making sure any loop built on `print-sweep` is not given a nonzero minimum duration.

## External fonts

Consumer outputs **do not self-host, bundle, convert or declare `@font-face` for fonts**, and this work makes no font provider or identity decision. The tokens only name families (`--ts-font-display`, `--ts-font-ui`) with fallback stacks. Existing TTF files remain source-only inputs for outlined logo generation; they are not web-font distribution outputs.

Before BK-03A, `tokens.css` began with a Google Fonts `@import`, so importing the tokens silently made the visitor's browser contact `fonts.googleapis.com` and `fonts.gstatic.com`. `tokens.css` now loads nothing. The same `@import`, byte for byte in its URL, moved to [`tokens/external-fonts-google.css`](../tokens/external-fonts-google.css), generated from `profile.json` (`external_fonts.legacy_google`), whose header discloses the requests. It is an explicit opt-in and a legacy adapter, not an approved provider.

## Migration notes (consumers)

1. **Web fonts are no longer implicit.** Consumers that relied on `tokens.css` to pull Fraunces and Inter Tight may propose adding `@import "brand-kit/tokens/external-fonts-google.css";` before other rules (the legacy URL is unchanged), or propose another reviewed external provider. The adapter is not provider approval; **do not self-host fonts**. Without an external font request the fallback stacks apply. This is a visible change and needs affected-consumer review. The original BK-03A run did not inspect or modify consumers; later read-only consumer evidence is separately recorded under BK-09.
2. **`tokens.json` shape.** Bare scalars (weights, line heights, tracking, space, radius, smoothing, spring, tilt) are now `{ "$value": ... }` records with `$type`s. The values and key names are unchanged (verified against a recorded copy of the old file). Any consumer that reads those fields as bare scalars must unwrap `$value`. `smoothing.*Ms`, `spring.stepHz` and `tilt.maxDeg` keep numeric values and declare their unit in `$extensions`. The root `$description` no longer says "DTCG format".
3. **Print-sweep under reduced motion** is now `0ms` (see above).
4. **Tailwind** gains `rounded-pill`, `duration-shutter`, `duration-print-sweep`; durations are `var()` references. Resolved values are identical to the old literals.
5. **CSS formatting.** `tokens.css` is regenerated, so layout and comments differ (one declaration per line). Every pre-existing variable keeps its name and value; the test compares them.

Weights have no CSS variable and none was invented; adding `--ts-weight-*` would be new public API for consumer review.

## Declared in prose, absent from JSON

These appear in [`SPEC.md`](../SPEC.md) or the guideline docs but are not token leaves. They are not added here because that would be a new decision: the Fraunces optical-size/`SOFT`/`WONK` axis settings (logo: opsz 144, wght 600, SOFT 0, WONK 0; headlines: wght 560, SOFT 30; JSON holds only `weight.display` 560, `weight.logo` 600 and the axis ranges in the family description), the muted-text opacity (66%, present only inside the rgba values), contrast ratios, the tear threshold (60%), the tear angle range and the gyro filter constants. The foil `glow` 0.45 reduced-motion sheen in the motion doc is also prose only.

## Limits

- Not browser-verified. The Tailwind check builds real CSS and the parity check resolves variables with a small reader of the generated CSS; neither renders pixels.
- The profile validator proves shape and internal consistency, not that a value is the approved brand value. `approval_status` stays `unknown`.
- Rights, release classification and font hosting remain with BK-06, BK-03B and BK-02.
