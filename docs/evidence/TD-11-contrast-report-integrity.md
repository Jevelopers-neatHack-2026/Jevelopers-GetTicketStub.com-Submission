# TD-11 contrast coverage: corrected execution receipt

Refs #16 and #15, partial only. No leaf, gate, epic, FIN-10 or DASH-01..04 acceptance is asserted.

## Correction and preserved history

The initial receipt in `d545110115f736242727ac01c71ba0e5cccd1eb6` cited raw TAP files that are not available for corroboration in this execution environment. Its local-run claims and raw TAP digests must not be used for acceptance. The historical commit is retained and the correction is recorded in PR #37 comment 6128488149. The actual fresh executions below supersede those unsupported receipt claims; they are not relabelled old runs.

Main advanced through PR #36 to `e7e9aece87eac258369ed551cb9800282575cc45`, tree `c64c1bffa48458e300c9cb262cdeccf5eebbc301`, while the first source was being prepared. This integration retains PR #36's generic comparison and all 13 test bodies verbatim. It adds a separate completeness validator, uses it in the CLI, and restores the original unchanged CSS producer. The integration commit includes both the original branch head and current main as parents; no foreign branch or history is overwritten.

## Actual environment and boundaries

Execution date: 2026-10-12 UTC. Node v22.16.0, npm 10.9.2, Linux. `git clone --no-checkout https://github.com/Jevelopers-neatHack-2026/team-dashboard.git repository` exited 128 because github.com could not resolve. `entire graph search --repo . --profile full --query 'Validate CI contrast reports against the required pair coverage and measured ratios'` exited 127 because `entire` is not installed. A focused API source snapshot was therefore assembled and its original Git blob hashes verified. This is not a full checkout or the mandated Node24.15.0/npm11.12.1 workflow.

No dependency installation, provider, credential, browser, actual host or finance-runtime call was made locally. CSS measurement is a local calculation; command/Vitest/Playwright inputs used to isolate the CLI are independently TEST_BUILT mock/offline fixtures. They do not mean those suites ran. Paid/live provider authorization, budget and cost are N/A for these runs.

## Exact executed source identities

| File | Refreshed main Git blob | Repaired Git blob |
| --- | --- | --- |
| scripts/assert-ci-reports.mjs | addf161f486645bc1ab32cee998953bc7f249774 | 16ba4b561a8ea23e020a464948dcaf59eaafd427 |
| scripts/assert-ci-reports.test.mjs | 1fcbbdcfff99709ec74a5ded3388869b7c9a89f5 | 91471914cde921207e465aad696c1d2e296f978b |
| scripts/contrast-policy.mjs | N/A, new | 1f7cb563913dafa3d085cb03dd41b7163f4cbd14 |
| scripts/check-contrast.mjs | 7d667c15b6d5b04e50abbbbeb9a5e3a4163e66f2 | unchanged |
| src/styles/brand-tokens.css | a53588e92a043918f263d29bff17c1891f0f6468 | unchanged |

Original pre-PR36 gate/test blobs were also checked as `67db87c4ba1821885076321921c585d287095fbf` and `a30df74be413ebbb3d1a9ebea64ebc869114ac92`. The exact integration commit containing the repaired blobs is recorded in the PR after publication; hosted CI must name its own tested head/candidate and must not borrow these limited local results.

## Actual commands and outcomes

| Command / source | Outcome |
| --- | --- |
| `node --test scripts/assert-ci-reports.test.mjs`, original pre-PR36 files | exit 0; 5 pass, 0 fail/skip/todo |
| Same command, exact refreshed main files | exit 0; 13 pass, 0 fail/skip/todo |
| `node evidence/coverage-probe.mjs`, refreshed-main gate | exit 1; all four required rejection probes failed: actual CLI exit 0 |
| Same probe, repaired gate | exit 0; all four rejection probes passed: actual CLI exit 1, no success stdout |
| `node --test scripts/assert-ci-reports.test.mjs`, repaired files | exit 0; 22 pass, 0 fail/skip/todo/cancelled |
| `node scripts/check-contrast.mjs`, before and after | exit 0; nine pairs with three intentional negatives |
| `cmp evidence/replay-base-contrast.json evidence/replay-green-contrast.json`, from the snapshot parent | exit 0; identical measurement JSON |
| `node --check` for gate, gate tests, policy and unchanged producer | exit 0 for all four |
| Source substring assertions for PR36 generic validator and all original test bodies | pass; retained verbatim |

The CLI probe was a local harness in `/mnt/data/td-session/evidence/coverage-probe.mjs`, using the snapshot sibling directory. It starts the real CSS producer, creates synthetic passing command/Vitest/Playwright inputs, and mutates one contrast report at a time: omit the final pair; replace pair 0 with pair 1; set pair 0's threshold to 1; or set pair 0's ratio=2, passes=false and expected=false. The committed CLI test covers the same four mutations and valid-input recovery. A red outcome is an actual missed rejection, not a skipped case. The raw outputs are retained below.

## Immutable raw evidence and digests

All files below contain sanitized synthetic test output only. Their source provenance is the local run above, not hosted, sandbox or live Finance evidence.

| Committed artifact under td11-20261012/ | SHA-256 |
| --- | --- |
| coverage-red-main.json | 4a149e75bd7ff82f59216f1aa932a2980ee53e20b048c3f7a47cdada17c2a634 |
| coverage-green.json | 1972da89637d971cdb844601d19a2e66f4c153f28cefce974b5a836104f14f46 |
| replay-green.tap | a324d96379ffcd2c43596cf807549da13ad1c5dff58e552615478af8c076e80f |

Additional retained local outputs, not asserted to be uploaded here: fresh baseline TAP SHA256 `0bafd007b4c550e53d137462df24a47f0e738582af7a12324e602afbf7195631`; fresh main TAP `39082634c46a283cb46dda6d95124a386ea6dd93dc24ea376b66fc4306c87f2d`; identical before/after contrast JSON `d50d1537f7493df9764bfa22a4bcc5c3867379d77dfe00fcdeaf8329274b9de5`.

## Remaining review and integration requirements

Hosted lint/typecheck/application tests/build/browser/packed-host checks on the current candidate remain separate prerequisites. The initial d545 candidate run 38277644981 is retained separately and cannot validate this integration revision. Independent repository/Product-frontend and TD-11 reviewer approval is required; this author receipt is not approval. Actual-host validation remains unresolved. No Finance packet, schema, grant mapping, source pin, package version, export authority or global acceptance status changes in this slice.
