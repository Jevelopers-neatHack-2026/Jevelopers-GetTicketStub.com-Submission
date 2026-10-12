# LP-09 withdrawal repairs after independent review

Refs [LP-09 #11](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/11). This record supersedes the earlier withdrawal sufficiency assessment and preserves its actual results. It is local author verification pending independent re-review, not a GitHub approval, accountable content acceptance or publication authorization.

## Findings and repairs

The independent [REQUEST_CHANGES record](independent-review-request-changes.json) was copied unchanged from the review of `8b0abe50bc000e3d7ef1976f8d3ccf7511a16233` / implementation `4d934e929741689a4a47276a44c61de2989cf410`.

| Finding | Reproduced failure | Repair and regression coverage |
|---|---|---|
| GOV-R1 | Replacing `LP-COPY-02` with `&#80;in the nights that mattered.` and removing its active inventory entry returned PASS_LOCAL while the same text remained rendered | Decode valid numeric references and supported named references once; reject unsupported named/legacy references or ambiguous numeric values; inspect decoded source/attributes and both joined/separated HTML text. Tests cover decimal/hex, omitted semicolons, encoded whitespace, unsupported references, inline tag splits and an accessible label. A once-escaped reference remains literal rather than being recursively decoded. |
| GOV-R2 | Renaming the 53,684-byte original media and appending a newline returned PASS_LOCAL although every original byte remained | Check the original byte sequence anywhere in every public payload, retaining path, active mapping and baseline hash checks. Tests cover the exact newline reproduction and the original bytes embedded between prefix/suffix padding. |

These checks establish bounded literal/rendered-text and original-byte removal. They are not a full browser parser, semantic similarity scan, transformed-image comparison, visual sanitization review, rights approval, deployed withdrawal or cache invalidation result.

## Preserved failing evidence

Regression-only commit `521fcca7a6c91e675caf15ea589a13086efd2ec8` leaves the original withdrawal implementation unchanged and adds the two reproduction groups. On Node **24.15.0**, `node --test tests/governance.test.mjs` exited **1**, reporting 19 tests, seven passes and 12 failures (the failing groups and their subtests). [Reproduction output](01-reproduced-regressions.log) and [timestamp/revision record](reproduction.json) are retained. No expected-rejection failure was relabeled a pass.

The [working-tree repair run](02-working-tree-repair-check.log) then passed its 19 tests before three additional reference-encoding coverage cases were added. That exploratory working-tree output is separate from the exact committed results below.

## Verification of the repaired commit

Exact tested repair commit: **`1fc0c39046e7904a9ba7eff774fe72130b6fe90b`**. All commands below used Node **24.15.0** through the existing pinned executable on `PATH`. Exact timestamps, expanded commands, exit codes and log SHA-256 values are in [runs.json](runs.json).

| Command | Actual outcome | Evidence |
|---|---|---|
| `node --test tests/governance.test.mjs` | PASS, **22/22**, zero skipped | [Focused tests](03-focused-tests.log) |
| `node scripts/build.mjs` | PASS, 11 source files | [Build](04-build.log) |
| `./scripts/validate-landing --suite governance --mode draft` | PASS_DRAFT, exit 0 | [Governance draft](05-governance-draft.log) |
| `./scripts/validate-landing --suite governance --mode release` | **FAIL**, exit 1; accountable named acceptance remains unconfirmed | [Governance release](06-governance-release.log) |
| `node --test tests/*.test.mjs` | PASS, **157/157**, zero skipped | [Full tests](07-all-tests.log) |
| `./scripts/validate-landing --mode draft` | **FAIL**, exit 1; required brand validator remains unavailable | [All draft suites](08-all-draft.log) |
| `git diff --check` | PASS, exit 0 | [Diff check](09-diff-check.log) |

The unchanged built manifest SHA-256 is `389e41ab3e2f32b9169cd70db129b01466a329dde74e1c6874ebbdba1df56470`. No application source, asset, copy/proof/privacy pin or approval receipt was changed in this repair.

Execution is **mock/offline**. The mutations and padding are synthetic test inputs applied to temporary copies; the source page/media retain their recorded repository provenance and unconfirmed publication rights. No browser/provider result, deployment, paid operation, external publication, consumer ACK or master acceptance update occurred. Provider budget/usage is N/A to these local checks; no product cost result is inferred.

The original owner/maintainer/backup, content/rights review, independent review, brand and release dependencies remain open as described in the [content policy](../../../content-policy.md). The integration task must review the final head and rerun affected checks on its actual merged revision before making a scoped completion claim.
