# Pinned consumer imports and ownership

**Review fixtures only.** No approved distribution exists and no product, landing or
marketing owner has acknowledged this exact candidate. BK-09
[#15](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/15) stays open until
the approved artifact and named early contract reviews exist. Consumer releases are
not prerequisites for these early reviews.

## Consumer handoff matrix

| Consumer | Owning role | Observed source evidence | Required brand contract |
|---|---|---|---|
| getticketstub.com | Product/frontend application composition | [GT-10B #19](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/19) requires actual brand pins; its assembly tool labels missing pins pending | Approved archive/version/file-set hash, CSS/logo import, external-font policy, exact upgrade/rollback and named acknowledgment |
| landing-page-repo | Product/frontend public-site owner, with brand identity reviewer | [LP-06 #8](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/8) allows local work while final brand conformance is blocked | The same approved subset, font rules, public-export limits, representative rendered review and named early acknowledgment |
| team-dashboard | Product/frontend dashboard integration owner | [TD-10 source](https://github.com/Jevelopers-neatHack-2026/team-dashboard/blob/e7e9aece87eac258369ed551cb9800282575cc45/docs/integration/TD-10-components.md) records brand `3822635aff507cd5918a08a0c636bb0e41705261`, isolated styles and platform fallbacks | Deliberate token migration inside `.team-dashboard`, no global resets/font requests, and named design-owner acceptance in its own issue |
| marketing-material | Product/frontend collateral owner and brand/landing reviewers | [Draft consumption](https://github.com/Jevelopers-neatHack-2026/marketing-material/blob/62742934652aad8872c388e4d3fa77dddf93cbc9/review/brand-consumption.md) uses `3822635aff507cd5918a08a0c636bb0e41705261` guidance only; no logo/font binary imported; conformance blocked | Approved subset/voice, medium-specific adaptations, exact asset hashes/restrictions and named early acknowledgment |

These are read-only observations and role boundaries, not appointments or tested
adoption of a new release. Accountable brand approver @CompleteDotTech is nominated;
technical, provenance, consumer and release reviewer acknowledgments remain missing
in [governance](brand-governance.md). Lars is addressed as @lmvdz in the
[#14 coordination request](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14#issuecomment-6118157033);
that request does not appoint or approve every role.

## Obtain, verify and import

Follow [distribution.md](distribution.md) to create or obtain the exact local review
archive. Verify it with the independently reviewed full commit and ZIP SHA-256
before extracting. `check_consumers.py` safely extracts only the validated stored
regular files to an empty temporary directory; it never imports directly from the
producer's working tree. Archive members have a single `brand-kit/` prefix.

In an empty local consumer whose verified extracted `brand-kit/` folder sits next
to `index.html`, the plain CSS example is:

```html
<html lang="en" data-theme="light">
<link rel="stylesheet" href="brand-kit/tokens/tokens.css">
<div class="brand-plate"><img src="brand-kit/logo/wordmark.svg" alt="TicketStub" width="200"></div>
<button class="review">Review draft</button>
<section class="ts-night">A deliberately selected night-stage section</section>
```

```css
.brand-plate {
  display: inline-block;
  box-sizing: border-box;
  max-width: 100%;
  padding: 1rem;
  background: var(--ts-cream);
}
.brand-plate img { display: block; width: 200px; max-width: 100%; height: auto; }
.review {
  color: var(--ts-cta-label);
  background: var(--ts-cta-bg);
  border-radius: var(--ts-radius-control);
  font-family: var(--ts-font-ui);
}
```

An explicit `data-theme="light"` retains paper for the full document. `.ts-night`
opts a subtree into the existing night tokens; an explicit dark root or unforced
OS-dark preference follows the existing source contract. This guide does not ratify
the pending app direction. Reduced-motion duration variables become zero, but
consumers must also stop their own decorative loops, tilt, sound and animation.

For **Tailwind 3.4.x**, install the repository's already pinned development tooling
once and use the extracted relative preset, not an unpublished registry package:

```js
// tailwind.config.cjs, alongside the extracted brand-kit/ directory
module.exports = {
  presets: [require('./brand-kit/tokens/tailwind.preset.js')],
  content: ['./index.html'],
  corePlugins: { preflight: false }
};
```

Load `brand-kit/tokens/tokens.css` as well as the compiled utilities. The preset
references those variables. Tailwind 4 is not supported/tested. The checked fixture
uses no browser/network font request; font-provider availability remains pending.
For dashboard consumption, retain the existing host-owned `.team-dashboard` token
scope and translate upstream variables deliberately. Do not include the producer's
root declarations or a document reset globally in the authenticated host.

## Executable local checks

```sh
# After installing the existing exact tools/tokens-dev lockfile once:
python3 -I tools/check_consumers.py --local

# Full local contract check: currently nonzero for missing owner decisions/ACKs.
python3 -I tools/check_consumers.py

# An externally supplied archive must include both independent pins.
python3 -I tools/check_consumers.py --local --archive /absolute/path/brand-review.zip \
  --source "$REVIEWED_BRAND_COMMIT" --sha256 "$REVIEWED_ARCHIVE_SHA256"
```

The local check verifies extracted CSS variables/token parity, day/night and reduced
motion source rules, local font fallbacks, logo/link existence, an actual pinned
Tailwind compile and utility output. The committed `plain.html.in` and
`tailwind.html.in` files under `distribution/fixtures/` are extraction templates.
`check-consumers-local` renders their exact committed bytes as `plain.html` and
`tailwind.html` beside the verified extracted archive, then checks local links in
both rendered fixtures after compilation, including `compiled.css`. These templates
are not standalone repository pages or an exported distribution.
It removes the extracted CSS, requires that
import to fail, restores the exact bytes and checks the import again. This is a
local recovery exercise, not an actual approved-release rollback or browser test.
Missing Tailwind is a required skip and exits nonzero. `--local` explicitly limits
its pass to fixture mechanics; the normal command requires named contract records,
including available/unavailable external-font evidence bound to the exact file set.
An externally supplied font receipt is reported as `recorded_unverified`, separately
from `font_provider_checks` (`not_run`, `performed_this_run=false`). The receipt must
be independently authenticated; no offline command pass asserts a provider result.

### Actual local consumer browser checks

After installing the pinned tools documented in [accessibility.md](accessibility.md),
run this from a clean committed checkout:

```sh
node tools/check_consumer_browser.cjs
```

This separate command builds and verifies a local **unapproved review archive**,
copies the four exact committed consumer templates beside its extracted files,
and compiles the actual pinned Tailwind preset before Chromium renders them.
It records the source/tree, ZIP, exported file set, template, compiled CSS, checker,
served file and screenshot hashes under `out/brand/consumer-browser/`. A missing
browser or compiler, changed source/input, off-origin request or failed case exits
nonzero. All font/provider requests are blocked; only platform fallbacks are used.

The 16 cases cover both fixtures with OS light/dark, explicit light over dark OS
and explicit dark over light OS, each at 1080px with normal motion and 375px with
reduced motion. Assertions measure the semantic canvas, CTA label contrast,
visible logo surface, page overflow, actual Tab focus outline/adjacent contrast,
image loading and reduced-motion styles. The runner waits for the existing 240ms
theme transition to settle before measuring. It checks the documented 3px focus
outline with a 4px gap. These checks are local synthetic browser evidence; real
consumer acceptance, provider fonts, browser zoom and assistive-technology review
remain separate requirements.

Keep the ink wordmark on an explicit cream plate in either root theme. The logo
exception does not make an ink-on-ink rendering a useful usage example. The
Tailwind CTA uses `bg-orange text-ink` so its label remains approximately 4.99:1
against orange in both themes; `text-fg` still demonstrates semantic body text.
Using night `text-fg` on orange produces approximately 3.14:1 for normal text and
fails this fixture's 4.5:1 label requirement. Set the actual canvas with `bg-bg`;
do not depend on the browser's default canvas color. Focus uses the surrounding
surface exposed by the 4px gap, including the cyan ring in night mode.
The CTA limits its transition to `background-color`, so keyboard focus appears
immediately instead of animating from a missing or low-contrast outline.

## Worked migration from the original source baseline

| Earlier consumption at `3822635…` | Current source behavior | Required consumer action |
|---|---|---|
| Copy mutable `main` source or illustrative `@ticketstub/brand-kit` import | No registry package exists; local review archive has immutable SHA/hash pins | Keep a reviewed archive receipt; import the verified extracted paths; wait for approved BK-03B before release |
| JSON leaf read as a raw value | Profiled leaf contains `$value`, `$type` and description | Read the profiled `$value`, respecting aliases and the documented profile; do not claim DTCG compatibility |
| Importing `tokens.css` implicitly requests Google Fonts | Default CSS performs no font request | Use documented platform fallbacks; separately await owner review before adding external-font opt-in |
| Print-sweep duration remains active under reduced motion | Duration becomes `0ms` | Stop nonessential loops and runtime motion in the consumer; a token cannot stop its JavaScript |
| Dashboards copy brand variables globally | Host style isolation is owned by dashboard/app | Keep `.team-dashboard` scoping and verify actual host layout/keyboard/zoom separately |

For an upgrade, keep both old and new reviewed receipt/source/archive hashes,
classify every removed path or token as breaking, and review value/font/layout
changes even when names remain. Run local imports, actual browser modes and the
consumer's own tests before changing its pin. Retain the previous valid artifact
until the upgrade is accepted. If the candidate fails, record its failure and restore
only bytes with a currently valid rights/approval decision. There is no approved
historical artifact or chosen deprecation interval today; those gaps block release.

## Early acknowledgment and downstream evidence

The required Product, Landing and Marketing reviewer each acknowledges the **same
exact** artifact source/version, file-set hash, allowlist, external-font/fallback,
import and migration contract against these local fixtures. Record actual names,
dated comment/review permalinks and content digests in the receipt index. A name
in this document or a scripted fixture pass cannot supply that acknowledgment.
The actual approval record must be independently authenticated before a release.

Brand-kit owns identity, tokens and guides. Apps own behavior/layout and delivered
font behavior; landing owns final pages; marketing owns claims/collateral; event
intelligence owns discovered event/organizer assets. Do not copy references or
unapproved screenshots into the consumer subset. Edition/foil source links remain
pinned to the accepted documentation handoff; a source link proves availability,
not deployed behavior. Consumer implementation/conformance and global ART-05/EVAL-04
acceptance remain with their existing owners.
