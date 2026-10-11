# team-dashboard

Typed React module for the authenticated financial administration area of `getticketstub.com`.

This revision delivers the **TD-01 local package, route and state foundation**. It does not deliver financial domain views, server authorization, authoritative financial adapters, exports, or actual host integration. Required domain leaves, TD-01.E and the repository release gate remain open. Missing upstream integration renders unavailable, never financial zero.

## Local development

Use Node **24.15.0** (`.nvmrc`) and npm **11.12.1**. Dependencies are pinned in the npm lockfile. After installing dependencies and the declared Playwright Chromium build:

```sh
npm ci
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run test:e2e
npm run test:integration
npm run dev
```

Open `http://127.0.0.1:49171/admin/finance`. The browser test/dev harness imports the extracted `npm pack` archive, rather than module source. Its controls and read-only extension example are visibly labelled fixtures, contain no financial data, and are excluded from package exports. Browser tests block external HTTP requests; no provider secrets are required. Dependency/browser installation requires ordinary registry/CDN access; test execution requires only loopback access after installation.

`TD_TEST_PORT` selects a private test port; strict-port mode prevents reuse of another process. `TD_ARTIFACT_DIR` selects the Playwright report/screenshot directory. `npm run test:host` deliberately fails with the unresolved actual-host gate; it never treats fixture success as WP02 evidence.

## Host adoption

The private, unpublished package exports JS, declarations and isolated CSS. React/React DOM `19.3.0` are exact peers matching the **unaccepted host candidate**, not a claim of WP02 agreement. No standalone production server or identity provider is included.

See [mount and rollback contract](docs/integration/mount-contract.md), [local requirement coverage](docs/integration/TD-01-coverage.md), and [runtime and provenance decision](docs/decisions/TD-01-runtime-mount.md). Existing [architecture ownership](docs/architecture/OWNERSHIP.md) and [global acceptance boundaries](docs/architecture/ACCEPTANCE.md) retain their authority.
