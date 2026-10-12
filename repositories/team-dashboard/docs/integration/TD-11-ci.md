# TD-11 CI validation

The `Dashboard validation` workflow runs on pull requests targeting `main`, pushes to `main`, and manual dispatch. Its `fixture-validation` job uses Node.js 24.15.0 and npm 11.12.1, installs the lockfile with `npm ci`, then installs Chromium's headless shell and Ubuntu system dependencies through Playwright.

The job runs lint, type checking, Vitest, package build, contrast checks, browser journeys, and fixture-host integration. It sets `CI=true`, `TZ=UTC`, and `TD_TEST_PORT=49177`. Playwright writes separate JSON reports and failure artifacts for each suite. The report gate requires the full command log and all reports, checks each test outcome against aggregate counts, and rejects missing, malformed, empty, skipped, todo, retried/flaky, failed, or unexpected outcomes. Built-in `node:test` cases exercise those rejection paths.

CI retains fixture test reports and contrast results for 14 days. It uploads screenshots and traces only after a failure, also with 14-day retention. The workflow has read-only repository permissions, keeps checkout credentials disabled, pins each used GitHub Action to its reviewed commit, and does not publish packages or use secrets, caches, or finance-provider APIs.

This is fixture validation only. It does not provide canonical finance fixtures or schemas, prove producer acceptance, or verify an actual host mount. `npm run test:host` remains `BLOCKED` until the pinned host consumer, runtime, authorization, and data evidence is available; a passing fixture workflow must never be reported as actual release acceptance.

## Contrast report integrity

The generic `validateContrastReport` comparison and tests from PR #36 remain intact. The CLI additionally uses `validateDashboardContrastReport` and the independent `scripts/contrast-policy.mjs` coverage policy. The CSS measurement producer and token values are unchanged; deleting a producer check cannot silently delete the required gate expectation.

The dashboard gate pins source/method labels and requires all nine named pairs exactly once. Six production text/focus/bar pairs must pass their unchanged thresholds; orange, copper and cyan body-text controls must fail their unchanged 4.5 threshold. These are intentional negative controls, not skipped checks or permission to use those colors for body text. Unknown/duplicate/missing checks, changed thresholds or expectations, and ratios outside [1, 21] fail. Generic validation also rejects malformed values and flags that disagree with the unrounded measurement.

`node --test scripts/assert-ci-reports.test.mjs` includes the 13 retained main tests plus nine dashboard-policy groups covering malformed inputs, all pairs, boundaries, the real producer and CLI refusal/recovery. Synthetic command, Vitest and Playwright reports in the CLI tests are gate inputs only, not executed application/browser results. The ordinary workflow must still run those suites separately on the pinned runtime. This policy verifies report consistency and completeness, not authenticity of arbitrary claimed measurements or overall accessibility acceptance.
