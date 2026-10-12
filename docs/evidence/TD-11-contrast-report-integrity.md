# TD-11 contrast report integrity: focused implementation evidence

Refs #16 (TD-11.B/E/F, partial) and #15 (TD-10 contrast verification contributor). No leaf, gate, epic, FIN-10 or DASH-01..04 is accepted by this record.

## Source and execution boundary

Execution date: 2026-10-12 UTC. Base: `7f137a41ed8a2169da52ff1f1f9e4f087f3d4fde`; base tree: `6bd241e5c42b1ba97812dca0e2a7d6f400b235d9`. A focused isolated API source snapshot was used because the local runtime could not resolve github.com for cloning. Each original file was checked against its Git blob identity before editing. This was not a full checkout or a pinned-toolchain validation. The required graph command was attempted, but the `entire` executable was unavailable.

Runtime actually used: Node v22.16.0, npm 10.9.2, Linux. Node built-in tests ran without dependency installation, provider calls, credentials, browser execution or host integration. The repository-required Node 24.15.0/npm 11.12.1 full workflow remains separate and must be inspected on the PR candidate. Provider mode: N/A for the CSS generator; mock/offline for independently synthetic gate inputs. No paid/live provider operation occurred; provider authorization, budget and cost are N/A for this slice.

## Exact executable input identities

| File | Original Git blob | Tested repaired Git blob |
| --- | --- | --- |
| scripts/assert-ci-reports.mjs | 67db87c4ba1821885076321921c585d287095fbf | 91da75a1768bd014f5b6bfe8fcbaf9e0f108d09c |
| scripts/assert-ci-reports.test.mjs | a30df74be413ebbb3d1a9ebea64ebc869114ac92 | cd3696f96569f0e587344c9b55ebc5016fcb74c9 |
| scripts/check-contrast.mjs | 7d667c15b6d5b04e50abbbbeb9a5e3a4163e66f2 | a848eeb45893670a4744e525ff2e962e380b9a6e |
| scripts/contrast-policy.mjs | N/A, new | c4f426cb7da1991b77605e4ab58dfe847aad6eae |
| src/styles/brand-tokens.css | a53588e92a043918f263d29bff17c1891f0f6468 | unchanged |

The red run combines the original gate/producer/CSS with the repaired test blob above. The green run uses all repaired executable blobs above. Their eventual Git commit is the commit containing these exact blobs; GitHub CI evidence must name its own exact head and candidate rather than borrowing these local results.

## Executed commands and retained outcomes

| Command / revision mode | Actual result |
| --- | --- |
| `node --test scripts/assert-ci-reports.test.mjs`, original five tests and original gate | exit 0; 5 passed, 0 failed/skipped/todo |
| Same command, new regressions against original gate | exit 1; 13 tests, 6 passed, 7 failed, 0 skipped/todo/cancelled |
| Same command, repaired gate and same regressions | exit 0; 13 passed, 0 failed/skipped/todo/cancelled |
| `node scripts/check-contrast.mjs`, original and repaired producer with unchanged CSS | exit 0 both; nine checked pairs including three intentional negative controls |
| `cmp` of retained baseline and repaired contrast JSON | exit 0; byte-for-byte unchanged |
| `node --check` on each of the four affected `.mjs` files | exit 0 for all four |

The seven red failures exercise inconsistent ratios, mutable thresholds/expectations, incomplete or duplicate coverage, wrong source/method, malformed values, near-threshold rounding, and the complete CLI. In the red CLI case a synthetic body-text ratio of 2 with threshold 4.5 and both booleans true exited 0 when rejection was expected. In the green CLI case it exits 1 with no success output; replacing it with valid input then exits 0. The synthetic Vitest, Playwright and command-log inputs used to isolate this CLI behavior are not evidence that those application suites ran.

Preserved local raw-output SHA-256 identities (the failed result is retained, not relabelled as passing):

| Artifact | SHA-256 |
| --- | --- |
| baseline-gate-tests.tap | ce6106dff4091d0ccaa03033a4be3143b1fcf17504fe02eb652df258b30b00b6 |
| red-gate-tests.tap | e0e61fc2257ee1c137c4c4e0c152e276af15853b438a8f86c595518dd1e0d680 |
| green-gate-tests.tap | 8e50686297a95b093bbe10f9040de9f4d9bb9eba603e9d515d0baf3550fa7186 |
| baseline-contrast.json and green-contrast.json | d50d1537f7493df9764bfa22a4bcc5c3867379d77dfe00fcdeaf8329274b9de5 |

## Remaining obligations and review

The change verifies contrast-report coverage and internal consistency, not arbitrary measurement authenticity or overall accessibility. UI token values, Finance packets, package exports, host authority and runtime settings are unchanged. Required lint, typecheck, application tests, build, browser and fixture-host checks were not run locally on the mandated toolchain. Real-host `test:host` remains unresolved; no skipped required case becomes a pass.

Accountable reviewer roles: repository maintainer / Product and frontend, with the TD-11 integration-evaluation reviewer. Independent approval is not supplied by this author record. Merge requires review and current-candidate checks; issue #16 also retains its full producer, host, privacy, export and global procedure obligations. Review, candidate CI, postmerge checks and any later accepted evidence must be recorded separately without deleting this limited local receipt.
