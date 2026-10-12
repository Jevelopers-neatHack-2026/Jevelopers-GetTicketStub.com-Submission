# Local static runtime decision (LP-01)

Decision recorded 2026-10-12 against landing main `1d8379d1c5b0cb89ef869ea2cc7358886c9cf274` and host main `388005240aa62374d49f709afc300adb5e98cd98`. This implements a local artifact workflow; product approval and app-owner contract approval remain pending.

Keep the existing `site/index.html`, illustrated assets, archive and architecture provenance. Use Node's built-in filesystem, crypto, HTTP and test APIs to copy the existing static site deterministically. No framework, bundler, package manager, npm packages or install step is needed. `.nvmrc` pins the tested Node 24.15.0; a dependency lockfile is inapplicable because there are no package dependencies. Node 22 or later supports these scripts; use the pin when reproducing the evidence. This is a landing tooling decision, not a change to the application's Next.js runtime.

The host currently pins Next 16.4.0/React 19.3.0 with npm 11.16.0, and its package declares Node `>=22.23.3 <23`. Landing tooling runs separately and is not imported into the host. The host's [route proposal](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/388005240aa62374d49f709afc300adb5e98cd98/docs/architecture/routes.md) prefers a hero source component above its existing `StudioStart`. It offers a possible static artifact served at `/` with landing assets under `public/landing/`, but states that the directory/rebuild/rollback contract has not been agreed. The current page is a standalone HTML document, not that React component. Neither replacement strategy is implemented here.

## Source and content ownership

Runtime source is `site/index.html`; artwork/model/flight data are `site/assets/`. Human page inventory and editorial decisions live separately in `integration/site-map.md`; build and handoff policy live here and in `static-output.md`. Rendering copy, CSS and JavaScript remain in the established single HTML file. This change does not claim a separate content rendering pipeline or replace the original layout; future editorial extraction should preserve its rendering and scroll lifecycle. `archive/`, `markdowns/`, the zip and repository docs are retained as source history and excluded from the artifact.

## Clean-checkout commands

```sh
# Use Node 24.15.0 (nvm use reads .nvmrc, if nvm is installed).
node --version
node scripts/build.mjs
./scripts/validate-landing --suite foundation
node --test tests/scroll.test.mjs
node scripts/preview.mjs --port 8080
# Open http://127.0.0.1:8080/; stop preview with Ctrl-C.
```

No providers, credentials or network calls are used by build/foundation validation. The browser page still requests Google Fonts, Motion 11.11.17 and Three 0.160.0 from their existing CDN URLs. Local source/output creation and HTTP asset checks do not depend on those requests. Offline fonts/3D/animations and browser fallback behavior are not established by foundation tests; the existing scroll test covers deterministic handlers with doubles.

## Validation contract

`./scripts/validate-landing --suite foundation` builds then checks asset inventory, exact hashes/source parity and literal local references, runs HTTP preview/route isolation tests, and checks invalid/missing suite handling. Dynamic image templates are covered through the page's literal `assets/...` records; this is static reference validation, not a browser execution proof. The HTTP route responses for `/make`, `/signin/confirm` and `/api/health` are synthetic sentinels at source-observed paths, not owner-supplied fixtures.

No arguments runs every issue-defined required suite: `foundation`, `content`, `cta`, `proof`, `ux`, `brand`, `privacy`, `metadata`, `governance`. Mode defaults to `release`; `--mode draft` explicitly permits draft checks. Unknown names/modes or malformed arguments exit 2; build errors, failed tests and missing suites exit 1 with an actionable message. Missing Node produces the shell's `env: node` error: install/use the pinned Node runtime and retry. Foundation prints `PASS_LOCAL`. A green foundation suite does not imply any other suite, visual approval, provenance approval or release acceptance.

Later issues add `scripts/suites/<name>.mjs`, exporting `default async function run({ root, artifactDir, mode })`. Throw on failed requirements or unavailable prerequisites; return `{ status: 'PASS' }`, `{ status: 'PASS_LOCAL' }` or `{ status: 'PASS_DRAFT' }` only when that suite's checks complete. The dispatcher rejects draft results in release mode and preserves the explicit draft label in draft mode. The dispatcher continues independent suites after failures and exits nonzero if any required suite is unavailable/failed. Modules must not report a skipped prerequisite as a pass. No required leaf validator is stubbed to green here.
