# Local development and verification

Operational reference for working on `@jevelopers/team-dashboard`. Scope and open items are summarized in the [README](../README.md#status); requirement-by-requirement coverage is in [TD-01 coverage](integration/TD-01-coverage.md).

## Toolchain

Use Node **24.15.0** ([`.nvmrc`](../.nvmrc)) and npm **11.12.1** (`packageManager`). `package.json` engines allow Node `>=24.15.0 <25` and npm `>=11.12.1 <12`; [`.npmrc`](../.npmrc) sets `engine-strict=true` and `save-exact=true`. Dependencies are pinned in the npm lockfile. Only the exact pinned versions have been executed; see the [runtime decision](decisions/TD-01-runtime-mount.md) for the dependency pins and their rationale.

## Install

```sh
npm ci
npx playwright install --with-deps --only-shell chromium
```

The second line installs the Chromium headless shell that the Playwright 1.64.0 suites use; it is the command run by CI. `--with-deps` also installs Linux system packages and can be omitted where they are already present. Dependency/browser installation requires ordinary registry/CDN access; test execution requires only loopback access after installation.

## Commands

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run check:contrast
npm run test:e2e
npm run test:integration
npm run dev
```

| Script | What it does |
| --- | --- |
| `lint` | ESLint with zero warnings allowed |
| `typecheck` | `tsc --noEmit` |
| `test` | Vitest (`tests/package`, `tests/components`, `tests/access`); pass `-- --run` for a single run |
| `build` | Vite library build, declarations, then `scripts/check-package.mjs` |
| `check:contrast` | Contrast ratios for pinned token pairs in `src/styles/brand-tokens.css` (JSON output) |
| `test:e2e` | Playwright `e2e` project (`tests/e2e/*.spec.ts`) |
| `test:integration` | Playwright `integration` project (`tests/integration/*.spec.ts`) |
| `test:host` | Deliberately fails `BLOCKED`: the actual-host gate is unresolved |
| `dev` | Builds, prepares the packed fixture, and serves it |

To select only TD-01 browser cases, use `npm run test:e2e -- --grep TD-01` and `npm run test:integration -- --grep TD-01`; `npm pack --dry-run` lists the packed files. A successful grep selecting zero cases is not acceptable; Playwright's default no-tests behavior fails.

## Fixture host

`npm run dev` serves the fixture at `http://127.0.0.1:49171/admin/finance`. The browser test/dev harness imports the extracted `npm pack` archive, rather than module source. Its controls and read-only extension example are visibly labelled fixtures, contain no financial data, and are excluded from package exports. Browser tests block external HTTP requests; no provider secrets are required.

- `TD_TEST_PORT` selects a private test port (default `49171`); strict-port mode prevents reuse of another process.
- `TD_ARTIFACT_DIR` selects the Playwright report/screenshot directory (default `test-results`).

`npm run test:host` deliberately fails with the unresolved actual-host gate; it never treats fixture success as WP02 evidence.

## CI

The `Dashboard validation` workflow runs the same commands with JSON reports and a report gate; see [TD-11 CI validation](integration/TD-11-ci.md). It is fixture validation only and is not release acceptance.
