# TD-11 CI validation

The `Dashboard validation` workflow runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. Its `fixture-validation` job uses Node.js 24.15.0 and npm 11.12.1, installs the lockfile with `npm ci`, then installs Chromium's headless shell and Ubuntu system dependencies through Playwright.

The job runs lint, type checking, Vitest, package build, contrast checks, browser journeys, and fixture-host integration. It sets `CI=true`, `TZ=UTC`, and `TD_TEST_PORT=49177`. Playwright writes separate JSON reports and failure artifacts for each suite. The report gate requires the full command log and all reports, checks each test outcome against aggregate counts, and rejects missing, malformed, empty, skipped, todo, retried/flaky, failed, or unexpected outcomes. Built-in `node:test` cases exercise those rejection paths.

CI retains fixture test reports and contrast results for 14 days. It uploads screenshots and traces only after a failure, also with 14-day retention. The workflow has read-only repository permissions, keeps checkout credentials disabled, pins each used GitHub Action to its reviewed commit, and does not publish packages or use secrets, caches, or finance-provider APIs.

This is fixture validation only. It does not provide canonical finance fixtures or schemas, prove producer acceptance, or verify an actual host mount. `npm run test:host` remains `BLOCKED` until the pinned host consumer, runtime, authorization, and data evidence is available; a passing fixture workflow must never be reported as actual release acceptance.
