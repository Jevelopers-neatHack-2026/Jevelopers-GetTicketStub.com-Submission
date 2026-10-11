# Required Linux CI workload

The `runtime` check requires three independent workload jobs and a final offline
union/proof job. Every job retains the existing 20-minute limit. Each uses the
unchanged checksum-verified Node 24.21.0/npm 11.19.0 installer, immutable renderer
image, checkout action SHA and `scripts/security/run-offline.mjs` driver. No
container, renderer, nested 60-second deadline, tolerance or concurrency setting
changes. Test files remain serial within each job.

## Why separate runners

Frozen `6880d356ed10f9ad3e80d51dbb8248ec71526954` executed 492 outer tests in
847,601.614157 ms on Linux head run 38111192191: 462 passed, 30 failed, none
skipped/cancelled/TODO. The CLI sweep took 159,092.535883 ms and release took
277,948.466835 ms. Candidate `0030e0101d50c21af52b75d3022d6951bab3a68b`
(tree `16223e0ce2fbbc0a59be4977ce817d0736005437`) took 263,398.187694 and
458,650.046363 ms for those cases. It expired before its final test summary;
check 114386947166 explicitly reports the 20m0s limit. Candidate total counts
are unknown. CPU/RSS measurements were not retained in those logs.

The CLI file independently executes all 14 implemented private selections for
the named sweep and again for release. Private dispatcher files also perform
real positive executions and complete deliberate failed-canary executions;
their descendants run browsers, PDF inspections and SQLite/process scenarios.
These repeated executions prove distinct CLI, nested-context and receipt
invalidation behavior. Sharing a cached result would remove that evidence.
Separate runners remove the serial sum from one job without making descendants
compete for the same CPU, memory or private IPC namespace. The measured candidate
CLI file alone took 722,048.234057 ms, leaving room for installation and proofs
inside its original budget. Fresh integrated Linux measurements remain required;
these historical timings do not guarantee new PDF work fits its child deadlines.
The historical named sweep stopped at the failed personalization assertion, so
its timing underestimates a healthy complete sweep. Release catches leaf failures
and continues through all 14 private selections. The new Linux run must measure
the complete healthy sweep and release, with fresh evidence for every selection;
the scheduler never interprets an early positive-test failure as saved work.

## Exact coverage

| Group | Complete compiled files |
| --- | --- |
| `cli` | `integration/production-output-cli.test.js` |
| `private` | `unit/production-output-dispatcher.test.js`, `unit/durability-dispatcher.test.js`, `unit/durability-independent-tests.test.js` |
| `standalone` | Every other compiled unit, contract and integration test file |

`ci-workload-plan.mjs` discovers the same three top-level directories used by
`npm test`, requires source/compiled filename equality, rejects symlinks and
requires all 48 frozen filenames from `ci-workload-baseline.mjs`. Additional
files automatically enter `standalone`. Every group must be nonempty. The frozen
plan contains sorted paths, SHA-256 of each compiled test and its sole group;
its union digest must match across all jobs and the final checkout. Every
selected compiled file is hashed again after execution. No name filters, shards,
only selectors, caller-supplied files or partial-group syntax are accepted.

The native Node CLI still runs `--test --test-concurrency=1` in process isolation.
Its custom reporter retains actual per-file/whole-run counts, durations, failure
name digests and stdout/stderr digests from [Node 24 test events](https://nodejs.org/docs/v24.21.0/api/test.html#event-testsummary). Raw test stdout, exception strings and
environment values are not copied into the uploaded receipts. Per-file summaries
must exist: Node's successful empty-file wrapper cannot count as a real test.
Every file must execute at least one test; every passing receipt requires zero
failures, cancellations, skips and TODOs. The aggregate requires at least the
492 frozen outer tests, equality of native whole/group/file sums, exact disjoint
file coverage, unique execution nonces and matching revision/run ID/attempt.

The selector sets fresh owned output directories so the existing producer tests
retain their actual artifacts, independent child counts/nonces/digests and full
positive/failed-canary receipts. Their existing assertions still audit that
evidence. Private artifacts stay under `out/ci-workload-private/<nonce>/`; only
the bounded sanitized group receipt is uploaded. Receipt digests establish
execution identity, not correctness of the PDF oracle or external approval.

## Security and failure propagation

Each prepared job attempts build, types, format, workload selector tests, the
original three security unit suites, launch diagnostics, its test group (or
union aggregation), the complete real Linux browser suite, runtime calibration,
root import and runtime receipt read. Each command's actual exit code is recorded
under a fixed phase name. Any phase failure makes the job fail, even when later
proofs finish. A timeout/crash that prevents a complete receipt also blocks the
final check. Matrix fail-fast is disabled so one failure cannot cancel other
coverage. No failure is retried or accepted as positive evidence.

The `pdf-position` phase also runs the six fixed synthetic coordinate fixtures
inside each job's existing offline sandbox before its test group. It records the
diagnostic command's actual exit code as a required receipt phase. Rejected
geometry fails the phase while the remaining checks continue. An always-running
artifact step preserves only `out/pdf-linux-position/`, including its synthetic
JSON/PDF/PNG evidence, under a separate name for each group and attempt. These
artifacts cannot enter the sanitized workload union input. This captures the
numeric Linux evidence needed to diagnose a rejection without accepting it.

The final `runtime` job always runs, downloads only this workflow attempt's
artifacts, requires exactly the three expected input files, and validates them
inside the unchanged offline driver. It rejects unknown fields, missing/duplicate
groups, missing/overlapping files, changed digests, mismatched counts, stale
revision/run/attempt, duplicate nonces and macOS receipts. It also requires the
matrix's actual job conclusion to be success. Build/security/browser/calibration
proofs run again in its own sandbox. Upload/download actions use verified full
commit SHAs ([upload](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02),
[download](https://github.com/actions/download-artifact/tree/d3f86a106a0bac45b974a628896c90dbdf5c8093));
they transport sanitized evidence outside the verification sandbox.
They do not execute tests or download dependencies into it.

The driver still enforces OS network-none, non-root, private IPC with 1 GiB shm,
cap-drop ALL, no-new-privileges, enforced AppArmor, read-only root, the minimal
pinned seccomp policy and live source/root/sandbox observations. Linux browser
positive, deliberately unsandboxed negative and exited-process rejection tests
remain intact. Font/glyph/paint/position checks and all pins remain intact.

`prepare` validates the exact checkout SHA and writes a strict request once at
`out/ci-workload-request.json`. It accepts only the three named groups or
`aggregate` plus revision/run/attempt identity. The offline driver receives no
new argument or environment override; the request crosses the existing `/work`
bind mount. Existing files cannot be overwritten to reuse a result. Rerun the
entire workflow after a failure: a subset rerun has a new attempt and cannot
reuse earlier group receipts.

## Local checks and remaining proof

Use the pinned local toolchain, then:

```sh
npm ci
npm run build
npm run typecheck
npm run format:check
node --test scripts/ci-workload-*.test.mjs
node scripts/ci-workload.mjs plan
```

`npm test` and the unprepared `ci-offline.sh` retain their full local meaning.
The prepared selector is exclusively a CI schedule for the same file union.
Native fixture tests exercise zero-test rejection, real failures, skips, TODOs,
cancellation and real failed children. Schema/union tests challenge omissions,
overlap, stale identity, altered digests, count inconsistencies, phase failures
and future-file coverage. Their small synthetic counts are separate from the
492 repository tests and never certify Linux.

FINAL-LINUX-1 and FINAL-PDF-1 through FINAL-PDF-4 remain under the PDF owner's
scope. The original SOURCE-INT observations, old timeouts, missing diagnostics
and unresolved reliability holds remain preserved. After stopped writers are
combined, the parent must freeze the new head/base/actual merge candidate, run
all groups and final proof on real GitHub Linux, inspect complete fresh counts
and native receipts, then obtain a fresh independent Astra review. This
scheduling change alone does not resolve those findings or approve the goal.
