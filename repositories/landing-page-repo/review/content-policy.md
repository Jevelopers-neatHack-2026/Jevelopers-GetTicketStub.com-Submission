# Landing content review, freshness and withdrawal

Refs [LP-09 #11](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/11), [LP-10 #12](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/12).

## Scope and current decision

This is a proposed local editorial procedure with executable draft and withdrawal checks. It is not public content acceptance. Product, marketing, brand/rights and Finance/reliability have not nominated the accountable people required by LP-09.A. The maintainer and backup are also unconfirmed. Consequently `--suite governance --mode release` fails explicitly even when local dry runs pass. A contributor cannot turn a role, a checkbox, a passing test or a JSON approval label into an actual owner decision.

The current page is an illustrative digital preview with pending product/marketing and media permissions. The existing [navigation decision](cta-navigation-decision.json) permits only the specified `Open studio` link. It does not approve the landing's copy, examples, public deployment, ordering, prices or release. Do not broaden that receipt's scope.

This repository owns rendered page mappings, local evidence references, review records and update/withdrawal checks. Approved narrative remains with [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material); master identity, assets and tokens remain with [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit); canonical interfaces remain with [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts); assembled application routes and deployment remain with [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com).

## Accountable review and response

The local maintainer must record a named person, backup and evidence of each person's accepted responsibility before release. The table records gaps, not assignments. One person may cover several roles only through an explicit accountable decision.

| Responsibility | Owning role | Required review or response | Named person / backup |
|---|---|---|---|
| Page maintainer and withdrawal responder | Product and frontend | Maintain mappings, triage freshness events, prepare removal, coordinate app-owner rollback, retain evidence | Unconfirmed / unconfirmed |
| Product claims | Product and frontend | Demonstrated capabilities, prices, physical versus digital wording, automation limits, permission and purchase boundaries | Unconfirmed / unconfirmed |
| Narrative | marketing-material content owner | Approved messaging source, audience, claims and classification beside examples | Unconfirmed / unconfirmed |
| Identity and rights | brand-kit identity reviewer and applicable asset rights owner | Approved export/token versions, attribution, asset origins, licenses/permission scope and expiry | Unconfirmed / unconfirmed |
| Sensitive evidence | Finance and reliability | Sanitization, unnecessary customer/account details, applicable scanner results and safe evidence access | Unconfirmed / unconfirmed |
| Studio route and deployed removal | Receiving application owner | Exact destination/environment, artifact identity, host/cache behavior and rollback receipt | Unconfirmed / unconfirmed for this release; preserve existing limited navigation receipt |
| Master acceptance | integration-evals maintainer with EVAL-03/04 owners | Review immutable consumer evidence; record authoritative acceptance in that repository | Unconfirmed for this handoff |

A nomination is different from approval of a particular candidate. Record the actual review URL or authorized decision reference, person, role, decision time, exact candidate revision, scope and unresolved conditions. A later changed candidate requires affected re-review. Do not copy private discussion or sensitive approval evidence into public records; retain sanitized references accessible to the authorized reviewer.

## Required change record

Use [content-change-checklist.md](content-change-checklist.md) in addition to the organization PR template. Record the following for every proposed public update, including a withdrawal:

| Record | Required detail |
|---|---|
| Identity and scope | Local LP acceptance IDs; page/section or selector; every affected `LP-COPY-*` or other existing claim ID; example/scene ID and asset path; native/no-JavaScript CTA and metadata locations where applicable |
| Source and candidate | Original source/permission provenance, approved upstream revision if one exists, exact tested local commit SHA, artifact manifest SHA-256 and affected byte digests; preserve historical origins when refreshing a current audit pin |
| Evidence | Classification next to the claim, source origin for each artifact, execution/provider mode, fixture or recorded-source identity, exact command/procedure, date/time/timezone, actual result and all required failures/skips |
| Permission and sanitization | Permitted use and publication destination, license/permission receipt and expiry, sensitive-data review, applicable scan command/version/result; unknown permission remains unknown |
| Review | Named maintainer/backup, actual reviewer person and accountable role for each affected responsibility, review reference, approval date/time and scope; author audit and owner approval remain distinct |
| Publication | Exact destination/environment, separate applicable publication authorization, host-consumer artifact/revision acknowledgement and deployment/cache evidence; proposed URLs are not a deployed receipt |
| Freshness and recovery | Next review deadline, earlier event triggers, responder, withdrawal/removal selection, safe replacement or rollback revision, prerequisites and post-change verification |

Current mapping sources are [copy.json](../src/content/copy.json), [examples.json](examples.json), [claims.md](claims.md), [copy-changes.json](copy-changes.json), [cta.json](../src/content/cta.json), [metadata.json](../src/content/metadata.json) and [privacy-inventory.json](privacy-inventory.json). They remain the source of their existing fields. This policy does not create a substitute marketing catalog, release approval schema or integration-evals result schema.

## Review procedure

1. Refresh the issue and source revisions. Identify the active owner/writer; work in an isolated branch. Preserve the historical decision and replace only the affected rendered mapping. A changed master message or asset needs its upstream owner's decision.
2. Collect the required record and classify the evidence. An illustrative scene is not generated product evidence. A recorded live-origin artifact replayed locally remains a local/offline replay. Keep simulated, sandbox, live, estimated and pending information beside the related claim.
3. Audit all occurrences: visible copy, dynamic card data, captions/alt text, metadata and structured data, native links, no-JavaScript content, distributed media and the output manifest. Unsupported claims are rejected or explicitly relabeled with supported wording. Rehashing files supplies byte identity only.
4. Run the affected checks. The current content/proof validators require immutable source pins, reject changed or expired inventories and keep draft approval pending. A legitimate rendered change therefore needs an exact source commit, an actual author audit and a follow-up pin refresh; do not guess a SHA or refresh dates without review. Run the complete required suites before release and retain failures and skipped requirements.
5. Obtain the actual accountable reviews and the applicable host/publication authorization. Use neutral `Refs` issue links. Merge only the reviewed qualifying revision under repository policy, then verify the merged source/artifact. An owner acceptance still must identify its exact scope and revision.
6. Supply sanitized, immutable consumer evidence to the receiving app and integration-evals owners. Public deployment/removal and master acceptance remain pending until their responsible owners record the applicable evidence.

## Cadence and earlier freshness triggers

Proposed cadence on adoption: the named maintainer reviews the release candidate once each UTC day during active demonstration/release work, before every publication, and at least weekly after an authorized public release. The earliest per-item `recheckBy`, permission expiry or event below takes precedence over that cadence. A calendar date in an inventory is a deadline, not evidence of a completed review. This document installs no scheduler or host monitor.

| Trigger | What becomes stale | Required owner action |
|---|---|---|
| Product release, regression or changed supported behavior | Capability, automation, physical/digital and journey claims; related example evidence | Product owner confirms supported wording and reruns affected demonstration evidence; maintainer removes/relabels unsupported content |
| Changed studio URL, environment, availability or access behavior | Native and no-JavaScript CTA, metadata destinations and handoff evidence | Receiving app owner supplies exact route/availability evidence; landing maintainer withdraws every obsolete native href and updates config together |
| Brand export, asset or token revision change | Identity mapping, attribution and rendered review | Brand/rights owner approves the exact replacement and source version; maintainer checks every distributed asset |
| Expiring/revoked permission or sanitization concern | Asset and all derivative displays, metadata, thumbnails and public artifacts | Stop further publication, involve the rights or Finance/reliability owner and named responder, remove affected bytes or use a reviewed safe replacement |
| New evidence, expired evidence, price/cost change | Dependent claims and classifications | Product/marketing and Finance owners re-review the affected claim; pending evidence cannot silently retain a live/approved presentation |
| Changed source, runtime, dependency, test procedure, configuration or fixture | Affected local/browser checks and exact revision approvals | Retain the old result as superseded/stale and rerun the affected check on the new candidate |

Record the trigger time and source, affected IDs, previous evidence, observed result, owner and next action in the PR or sanitized issue record. For stale approved/public content, remove it or visibly relabel it pending new review. A broad rollback must not restore expired or revoked material. Source freshness validators block a candidate; an already deployed static page also requires an authorized app-owner update and cache verification.

## Withdrawal and rollback runbook

1. Select the last affected immutable revision and the exact claim IDs/asset paths. Record the reason, permission/evidence issue, current artifact digest and accountable responder. If sensitive data is suspected, stop dissemination and use the confirmed private reporting route. The organization route is currently unconfirmed; report that ownership blocker without posting sensitive details.
2. Prepare a focused branch. Remove or replace the claim at every rendered/dynamic/metadata occurrence. Remove withdrawn media from `site/assets/`; hiding it or removing an `<img>` alone still distributes the file. Keep historical source/decision references; change the active copy, example and scene mappings. A replacement needs its own source, rights, sanitization and review, even if the old asset was approved.
3. Rebuild and check the removal against the real baseline. For example, after editing a real candidate, substitute its actual baseline SHA and affected IDs:

   ```sh
   node scripts/withdrawal.mjs --baseline FULL_BASELINE_SHA --claim LP-COPY-02 --asset site/assets/ballet-clean.webp
   ```

   This command requires at least one existing baseline item. It builds into `dist/site`, compares the output to the source, rejects old active inventory references, checks exact copy/path bytes and decoded HTML text/attributes, and rejects the complete original media byte sequence anywhere inside a public payload, including renamed or padded files. It decodes valid numeric references and a bounded named-reference set once; unsupported named references, legacy name prefixes and ambiguous numeric values fail closed for inspection. Joined and separated text checks cover inline tag splits and whitespace. `PASS_LOCAL` establishes that bounded removal only. It is not a full browser parser, semantic-equivalence scanner, visual redaction/QR inspection, rights approval or deployed cache check.
4. Refresh the actual content/proof/privacy/metadata pins after author review and run their affected suites, the governance draft suite and meaningful negative/recovery checks. Missing media, stale inventories, unsupported copy or failed required suites remain failures. The three local governance drills never update a production inventory or provide a source-audit pin for a synthetic mutation.
5. Obtain the actual reviews; merge and verify the resulting main revision. The app owner then performs only an authorized deployment/removal, identifies the assembled revision/artifact, handles cache invalidation and checks old URLs and asset URLs. Record the public response and artifact identity without credentials or private payloads. A successful source check cannot prove this external step.
6. If a release fails, select a previous known-good artifact whose claims, permissions and approvals are still valid; otherwise use a newly reviewed safe page with the affected content removed. Record the chosen revision and authorization before the app owner applies it. Recheck routes, absence of withdrawn content/media, fallback text, access/privacy behavior and manifest identity afterward. Preserve both the failed and recovery records.

The automated rollback drill restores the original page only inside a temporary local directory and compares artifact bytes. It then confirms that the restored page again **fails** the withdrawal requirement. That drill demonstrates build reproducibility; it never authorizes restoring withdrawn content to a public destination.

## Local dry runs and acceptance mapping

Run `./scripts/validate-landing --suite governance --mode draft`. The suite composes the existing source, proof, CTA and artifact checks and executes `tests/governance.test.mjs`.

| Drill | Actual input and expected local result | What remains outside the result |
|---|---|---|
| Supported update | Replay the real historical physical-product wording correction against the retained immutable original source and current illustrative copy/proof; `PASS_DRAFT` with owner approvals still pending | New human editorial acceptance and public permission |
| Unsupported/stale update | Synthetic unsupported-price mutation, a local rehash attempt and expired content/example fixtures are rejected by the existing validators | Approval authority; a negative fixture is not a provider/product run |
| Replacement/withdrawal and rollback | Mutate copies of the real page/assets locally; remove selected copy/media, add a synthetic text-only SVG, check the actual build and native CTA, reject residual/encoded copy, renamed or padded original bytes and stale references, restore and compare the original manifest | New immutable audit/rights review for the synthetic mutation, full browser visual review, deployment/cache removal |
| Changed app destination | Synthetic pending destination withdraws both native and no-JavaScript links; configuration-only withdrawal is rejected | Current live route health and app-owner acceptance |

Record command output, exact checker revision, execution timestamp/timezone, Node version, source revision/digests and fixture identity with the PR. The synthetic fixture SVG and mutations are local test data. The copied existing artwork has recorded repository provenance and unconfirmed publication rights. No provider calls, cost data, public publication or central acceptance updates occur in these drills. Budget/usage for product providers is N/A for the local procedure; product operating costs are not inferred.

| LP criterion | Local contribution | Remaining closure requirement |
|---|---|---|
| LP-09.A | Usable policy and change checklist; explicit role boundaries | Named accountable reviewers, maintainer and backup; actual owner acceptance |
| LP-09.B | Repeatable supported/rejected/withdrawal/recovery drills with retained output | Review the actual dry-run evidence and applicable release candidate; no full release approval inferred |
| LP-09.C | Cadence, event triggers, inherited expiry checks and exact-content withdrawal check | Accountable responder adoption and external deployed update/cache evidence when applicable |
| LP-09.D | Existing provenance/architecture retained; dated visibility disposition below and in OWNERSHIP | Upstream owner review of any future deviation; master acceptance remains integration-evals-owned |

Send exact PR/commit links, manifest digests, commands/outcomes, modes, limitations and sanitized review references to the authorized integration-evals maintainer for [EVAL-03](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md#eval-03-evidence-classification) and [EVAL-04](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md#eval-04-secrets-and-customer-data). Only those owners update the master Markdown/JSON tracker. This policy closes neither LP-09 nor the release gate/epic.

## Preserved decisions and source guidance

- [Architecture PR #1](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/1), repository [OWNERSHIP](../docs/architecture/OWNERSHIP.md) and [ACCEPTANCE](../docs/architecture/ACCEPTANCE.md) remain authoritative for their scope. The October 10 private/architecture-only wording is preserved as a historical snapshot. Authenticated GitHub metadata checked on October 12, 2026 reports this repository public; this observation changes no permissions, visibility or license. Current implementation remains locally evidenced and release acceptance pending.
- Organization guidance was read at `.github` commit `2f61f8551ecf38170f0c5b225305c950c7c3b222`: [CONTRIBUTING](https://github.com/Jevelopers-neatHack-2026/.github/blob/2f61f8551ecf38170f0c5b225305c950c7c3b222/CONTRIBUTING.md), [acceptance evidence](https://github.com/Jevelopers-neatHack-2026/.github/blob/2f61f8551ecf38170f0c5b225305c950c7c3b222/standards/acceptance-evidence.md) and [security/secret handling](https://github.com/Jevelopers-neatHack-2026/.github/blob/2f61f8551ecf38170f0c5b225305c950c7c3b222/standards/security-secret-handling.md). The existing live contribution-guidance link remains available for refreshed instructions. Guidance does not install branch protection, inherited AGENTS, CODEOWNERS, workflows or approval authority.
- No master message, brand source, foreign contract, license choice, repository setting or global acceptance state is changed by this local procedure.
