# TD-11 CI validation

The `Dashboard validation` workflow runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. Its `fixture-validation` job uses Node.js 24.15.0 and npm 11.12.1, installs the lockfile with `npm ci`, then installs Chromium's headless shell and Ubuntu system dependencies through Playwright.

The job runs lint, type checking, Vitest, package build, contrast checks, browser journeys, and fixture-host integration. It sets `CI=true`, `TZ=UTC`, and `TD_TEST_PORT=49177`. Playwright writes separate JSON reports and failure artifacts for each suite. The report gate requires the full command log and all reports, checks each test outcome against aggregate counts, and rejects missing, malformed, empty, skipped, todo, retried/flaky, failed, or unexpected outcomes. Built-in `node:test` cases exercise those rejection paths.

CI retains fixture test reports and contrast results for 14 days. It uploads screenshots and traces only after a failure, also with 14-day retention. The workflow has read-only repository permissions, keeps checkout credentials disabled, pins each used GitHub Action to its reviewed commit, and does not publish packages or use secrets, caches, or finance-provider APIs.

This is fixture validation only. It does not provide canonical finance fixtures or schemas, prove producer acceptance, or verify an actual host mount. `npm run test:host` remains `BLOCKED` until the pinned host consumer, runtime, authorization, and data evidence is available; a passing fixture workflow must never be reported as actual release acceptance.

## Contrast report integrity

`scripts/contrast-policy.mjs` pins the source identity, calculation method, and nine required named pairs for both the producer and report gate. Six production token pairs must pass their unchanged text/focus/bar thresholds; the orange, copper, and cyan body-text controls must fail their unchanged 4.5 thresholds. These are intentional negative controls, not skipped checks or permission to use those colors for body text.

The gate requires each known pair exactly once and rejects omissions, duplicates, unknown names, changed thresholds or expectations, and incorrect source/method identities. Ratios must be finite numbers in [1, 21]. Each pass flag is checked against the unrounded ratio and pinned threshold, then against the pinned expectation. Rounding cannot turn a near-threshold failure into a pass. This validates report consistency and coverage, not the authenticity of arbitrary reported measurements.

`node --test scripts/assert-ci-reports.test.mjs` exercises malformed and near-threshold inputs, every required pair, the real CSS contrast producer, and the report-gate CLI's rejection/recovery behavior. Synthetic command, Vitest, and Playwright inputs in the CLI test are gate-test fixtures only; they are not executed browser, host, financial, or release-acceptance results. The ordinary workflow still runs those suites separately on the pinned runtime.
