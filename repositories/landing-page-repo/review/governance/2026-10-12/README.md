# LP-09 local governance evidence — October 12, 2026

Refs [LP-09 #11](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/11). This is local implementation evidence for a partial issue slice. It is not named owner acceptance, public-content permission, deployment evidence or master EVAL-03/04 acceptance.

**Subsequent independent review:** the recorded local checks below passed, but review found two withdrawal false passes: character-reference encoding retained the rendered claim, and a renamed/padded asset retained every original byte. The original results and logs remain unchanged. This record is superseded for withdrawal sufficiency by the retained [REQUEST_CHANGES](revision-02/independent-review-request-changes.json) and [repair evidence](revision-02/README.md); no prior green run constitutes approval of the defective checker.

## Tested source and execution

- Exact tested implementation commit: `4d934e929741689a4a47276a44c61de2989cf410`.
- Base/main snapshot: `034785cb30aca697af13b5e47cbeea6cb7a9c158`.
- Current page audit source: `36c0a841d5b5c5f6e7c3870e65c541825026d214`; page SHA-256: `2bc1c248336d17ee0beb402882cc697925721a42f94b6e8f2fa187da36227a92`.
- Built `manifest.json` SHA-256: `389e41ab3e2f32b9169cd70db129b01466a329dde74e1c6874ebbdba1df56470`; 11 source payload files.
- Capture: October 12, 2026, 16:21:37–16:21:48 UTC. Exact per-command timestamps, runtime, exit codes and log hashes are in [runs.json](runs.json).
- Environment: Linux local checkout, no package installation. Required Node **24.15.0** was selected by prepending its existing executable directory to `PATH`, including for shebangs and child processes. A separate Node **24.19.0** exploratory run is retained and labeled; it does not satisfy the pinned-runtime requirement.
- Execution/provider mode: **mock/offline**, local filesystem builds and VM/test fixtures; no provider request, purchase, deployment or external publication. Product-provider budget/usage is N/A to this local procedure; no product cost result is inferred.
- Origin: the baseline source, artwork and original copy are recorded repository material. Local mutations and the text-only replacement SVG are independently synthetic. The supported-update drill replays the retained historical correction; it is not a new human review or product-provider result.

The implementation commit and its exact bytes must remain retrievable when this evidence is published. If integrated through a changed commit/rebase/cherry-pick, rerun affected checks against the new exact revision and retain this record as prior local evidence.

## Actual commands and outcomes

| Command | Runtime | Outcome | Evidence and interpretation |
|---|---|---|---|
| `git diff --check` before commit | Local Git | **FAIL, exit 2** | [Initial output](attempt-01-diff-check.log): changed OWNERSHIP lines inherited CRLF. Normalized that document to LF; failure retained. This was a working-tree check based on the base SHA, not an immutable candidate test. |
| `node --test tests/governance.test.mjs` | 24.19.0 | **PASS, 7/7** | [Exploratory output](02-nonpinned-governance-tests.log); nonpinned runtime explicitly retained. |
| `node scripts/build.mjs` | 24.15.0 | **PASS, exit 0** | [Build](03-build.log); 11 source files, no page or asset change in this implementation slice. |
| `./scripts/validate-landing --suite governance --mode draft` | 24.15.0 | **PASS_DRAFT, exit 0** | [Governance draft](04-governance-draft.log); 7/7 workflow tests, source/proof/CTA/artifact checks compose successfully. |
| `./scripts/validate-landing --suite governance --mode release` | 24.15.0 | **FAIL, exit 1** | [Governance release](05-governance-release.log); named maintainer/backup and accountable Product, marketing, brand/rights and Finance/reliability acceptance remain unconfirmed. Expected refusal is not a release pass. |
| `node --test tests/*.test.mjs` | 24.15.0 | **PASS, 142/142; 0 skipped** | [All tests](06-all-tests.log); exact expanded command recorded in runs.json. |
| `./scripts/validate-landing --mode draft` | 24.15.0 | **FAIL, exit 1** | [All draft suites](07-all-draft.log); foundation PASS_LOCAL and content/CTA/proof/UX/privacy/metadata/governance PASS_DRAFT; required brand validator still unavailable. No aggregate pass. |
| `node scripts/withdrawal.mjs --baseline 034785cb30aca697af13b5e47cbeea6cb7a9c158 --claim LP-COPY-02 --asset site/assets/ballet-clean.webp` | 24.15.0 | **FAIL, exit 1** | [Actual current-content rejection](08-current-content-not-withdrawn.log): claim remains in active inventory. The implementation did not withdraw current production source, so this must fail. |
| `git diff --check` on the implementation commit checkout | Local Git | **PASS, exit 0** | [Corrected check](09-diff-check.log). |

`expectationMet` in the local diagnostic index says only that the observed exit code matched the anticipated case. A failing release or all-suites command remains a failure. No records are an integration-evals machine schema or approval receipt.

## Dry-run coverage and practical limits

1. **Supported update:** the actual historical page contained the physical-product wording; the current page has removed it and retains explicit illustrative/printing/shipping-pending boundaries. Existing immutable content and proof validators return PASS_DRAFT; all 65 copy entries remain PENDING.
2. **Unsupported/stale update:** an unsupported price/fulfillment mutation remains rejected after a local rehash because the immutable source differs. Expired content carrying an APPROVED label and an expired example manifest fail before any release acceptance can be inferred.
3. **Withdrawal/replacement/rollback:** temporary copies of the actual page/media remove `LP-COPY-02` and `site/assets/ballet-clean.webp`, add a synthetic text-only replacement, build a real artifact and verify the original exact copy, filename and media digest are absent. Existing CTA behavior and static fallback remain locally usable. The changed fixture deliberately fails the original source audit. Restoring the original temporary source reproduces the original manifest bytes and correctly fails the withdrawal check again.
4. **Negative removal and route cases:** stale active copy/scene mappings, copy hidden in an HTML comment, old asset bytes renamed or still packaged, unknown/duplicate/empty selections and a moving baseline are rejected. A synthetic destination withdrawal must remove both the native and no-JavaScript hrefs.

Exact byte/digest removal does not prove semantic-equivalent content is absent, visual redaction/QR safety, browser rendering, media rights, actual provider behavior, deployment or cache invalidation. Full content/proof/privacy/metadata and affected browser checks remain necessary after a real edited candidate receives refreshed source audits. Reproduction of the rollback fixture is not authorization to republish revoked material.

## Remaining owner handoff

| Criterion / dependency | Local implementation delivered | Required next action and role |
|---|---|---|
| LP-09.A | [Policy](../../content-policy.md) and [change checklist](../../content-change-checklist.md) define explicit review and responder responsibilities | Product/frontend, marketing-material, brand-kit/rights and Finance/reliability nominate accountable people, maintainer and backup, and accept the actual scoped candidate |
| LP-09.B | Supported, rejected and withdrawal/recovery drills; exact-source logs retained | Accountable owners review these local results and the actual intended content candidate |
| LP-09.C | Cadence/triggers; reuse existing expiry guards; add built-payload withdrawal check | Maintainer/backup adopt response workflow; receiving app owner supplies authorized deployed removal/cache evidence when applicable |
| LP-09.D | Preserve original architecture/provenance and dated historical visibility; current public metadata observation explicitly distinguished | Preserve upstream source/contract ownership and obtain review for any future deviation |
| Brand / LP-06 #8 | No changes in this scoped branch | Brand owner/landing implementer must supply the approved pins and required validator; all-suite draft remains failing until resolved |
| LP-10 #12, epic #2, EVAL-03/04 | No acceptance state changed | Local gate/epic and integration-evals owners evaluate the complete exact assembled evidence after their prerequisites are met |

No GitHub review, owner acceptance, deployment receipt or consumer ACK was fabricated or recorded by this local branch. The root integration task owns independent review, publication of the branch/PR, merge and postmerge evidence.
