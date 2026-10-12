# Governance and profile status addendum — 2026-10-12

This dated addendum records the public repository audit, issue decisions, and profile-asset verification completed on 2026-10-12. The companion [machine-readable observation](organization-adoption-2026-10-12.json) contains the full pinned commit SHAs, source-tree URLs, artifact paths, settings observations, and per-repository workflow counts. The [governance lifecycle](../../standards/governance-lifecycle.md) defines the states used here.

The original [governance register](../governance-register.json) and [partial governance release record](../governance-release-record.md) remain preserved as dated historical evidence. This addendum supplements them; it does not rewrite their original baseline or turn a reduced-scope completion into a pass of that baseline.

## Scope and observation times

The organization inventory contained 16 repositories: 15 public repositories and one private repository. Metadata was inspected for all 16. Complete source trees were inspected for the 15 public repositories at their recorded default-branch revisions at **2026-10-12 17:16:34 UTC**. The companion JSON pins each tree observation to its full SHA and exact GitHub tree URL. One private repository's branch, tree, and README requests returned 404; no source content was obtained. Its identifier and private evidence are intentionally omitted here and from the public JSON. The inventory records only the aggregate private count and that its source was unavailable.

A separate public default-branch metadata read at **17:19:49 UTC** found seven later head SHAs that differed from their inspected tree SHAs:

| Repository | Audited tree SHA | Later head SHA | Later tree audited here? |
|---|---|---|---|
| `.github` | `2f61f8551ecf38170f0c5b225305c950c7c3b222` | `07d750dfb7feeecdeca7d3d1a2363663d7f3517f` | No |
| `shared-contracts` | `7251a09c4eaddbb1232d444fd931a01c266095ac` | `91736a026c02a3206cb7666ebfbe6134692e5a24` | No |
| `Jevelopers-GetTicketStub.com-Submission` | `70d03263da98e0ccc392ff20958618473a99f589` | `37ff6999a09da7707cc30a1fc9cfcacca429ce5f` | No |
| `landing-page-repo` | `f8a8b511aaebd8ce2d469306f36a013ea8b9d4c8` | `dda1b5d48e71ed9c111b82111676b7ef033fe5ef` | No |
| `team-dashboard` | `e7e9aece87eac258369ed551cb9800282575cc45` | `97e35e7f669f368b26c9884c48e7c181a26438b8` | No |
| `getticketstub.com` | `b5573270af362295c126e8b0be61b64f748c09a5` | `138e4b9019c0f5a55ad5e3f586d129216b680e4d` | No |
| `brand-kit` | `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4` | `6222a745195e9f15a14069e79210ad45daa16c94` | No |

The other eight public repository heads matched their inspected tree SHAs at the later metadata read. The head read describes branch metadata at that timestamp only; the seven different head SHAs are not represented as tree-audited content. Therefore, the gap matrix below is explicitly a 17:16:34 tree snapshot, not a continuously current inventory.

## Public repository gap matrix

`Y` means the specified root artifact was present in the pinned tree; `—` means it was not found at that canonical root path. Ownership refers to root `docs/architecture/OWNERSHIP.md`. Forms/PR refers to root GitHub issue-form configuration or issue forms and a pull-request template. Workflows is the number of YAML files under the repository's `.github/workflows/` directory; `calls` counts parsed job-level reusable-workflow calls. `Adoption record` means destination-specific evidence verifying adoption of the shared governance source. Full SHAs and exact source URLs are in the companion JSON.

| Public repository (pinned tree) | Root `AGENTS.md` | `CONTRIBUTING.md` | Ownership | Forms / PR | Workflows / calls | Adoption record | Local override observed |
|---|:---:|:---:|:---:|:---:|---:|:---:|:---:|
| [.github](https://github.com/Jevelopers-neatHack-2026/.github/tree/2f61f8551ecf38170f0c5b225305c950c7c3b222) `2f61f85` (governance source) | Y | Y | Y | Y | 0 / 0 | N/A | N/A |
| [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts/tree/7251a09c4eaddbb1232d444fd931a01c266095ac) `7251a09` | Y | — | Y | — | 1 / 0 | No | No |
| [Jevelopers-GetTicketStub.com-Submission](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission/tree/70d03263da98e0ccc392ff20958618473a99f589) `70d0326` | — | — | — | — | 0 / 0 | No | No |
| [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/56018576a9450a2bb46aa55ed3b2f9d9ae97e50d) `5601857` | Y | — | Y | — | 12 / 0 | No | No |
| [landing-page-repo](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/tree/f8a8b511aaebd8ce2d469306f36a013ea8b9d4c8) `f8a8b51` | — | — | Y | — | 0 / 0 | No | No |
| [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/tree/50910da5999fc099558ecf07c075488fd4cfd1be) `50910da` | Y | — | Y | — | 2 / 0 | No | No |
| [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine/tree/5b0f354dd8871550345863aef4017b7bbba3bd86) `5b0f354` | Y | — | Y | — | 4 / 0 | No | No |
| [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence/tree/ef69133bb38320793e02f8530accdd67e59f90e3) `ef69133` | Y | — | Y | — | 18 / 0 | No | No |
| [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness/tree/fce81e4f31f4047827d7de69a4e2da35415bc4c8) `fce81e4` | Y | — | Y | — | 3 / 0 | No | No |
| [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material/tree/79ae21607eb4d98188f85ce3c42b8be6eb5688bc) `79ae216` | — | — | Y | — | 0 / 0 | No | No |
| [team-dashboard](https://github.com/Jevelopers-neatHack-2026/team-dashboard/tree/e7e9aece87eac258369ed551cb9800282575cc45) `e7e9aec` | Y | — | Y | — | 2 / 0 | No | No |
| [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/tree/b5573270af362295c126e8b0be61b64f748c09a5) `b557327` | Y | — | Y | — | 2 / 0 | No | No |
| [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/tree/a1c04e6424626475c7c6db3d397cc6e3392c1600) `a1c04e64` | Y | — | Y | — | 2 / 0 | No | No |
| [print-production](https://github.com/Jevelopers-neatHack-2026/print-production/tree/89b5dd63c0a23dc27e62cfc235daa40dfe6d2002) `89b5dd6` | Y | — | Y | — | 2 / 0 | No | No |
| [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit/tree/3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4) `3c48922` | — | — | Y | — | 0 / 0 | No | No |

The `.github` governance-source tree contains root `AGENTS.md`, `CONTRIBUTING.md`, `docs/architecture/OWNERSHIP.md`, five active issue forms plus chooser configuration, a pull-request template, and `adoption/governance-register.json`. It has no root workflow files, `CODEOWNERS`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, or `SUPPORT.md`. The consumer totals are 10 of 14 with root `AGENTS.md`, 13 of 14 with root ownership documents, zero with root `CONTRIBUTING.md`, local issue-form configuration, a pull-request template, `CODEOWNERS`, code of conduct, recognized root `SECURITY.md` or `SUPPORT.md`, and zero with a destination-specific adoption record.

The submission repository contains a nested snapshot of organization material. Those nested copies are enumerated separately in the JSON and do not count as root-level destination configuration. Likewise, `docs/api/security.md` in `cost-intelligence` and `docs/security.md` in `fulfillment-connectors` describe domain security but are not root `SECURITY.md` reporting policies. All 14 consumer rows record no local override at the recognized community-health paths. A missing local file does not establish that an organization default was effectively displayed to that repository.

## What is configured, present, and verified

These statuses answer different questions:

- **File present:** the path exists in a pinned tree. The matrix and JSON record these path facts. Existing local workflow files count as files present only.
- **Configured:** the metadata surface returned a setting. The `main` branch metadata reported protection enabled for `.github` and disabled for all 14 public consumers. Repository-level ruleset listings returned zero for all 15 public repositories. These observations do not describe every organization-level or platform control.
- **Verified adoption:** a destination-specific record and evidence support a claim that a consumer adopted and verified the shared governance source. The audit found zero verified consumer adoptions. No consumer adoption record was found. The governance source's register is not a consumer's adoption evidence.

All **48** consumer workflow YAML files parsed with PyYAML 6.0.3 `BaseLoader`; their `jobs` mappings contained zero reusable-workflow `uses` callers, and none declared `on.workflow_call`. There were no invalid YAML files in the inspected set. This is a file and syntax audit, not evidence that Actions is enabled, that a workflow ran, or that a shared workflow was adopted. The source `.github` repository itself had zero root workflow files; example workflows nested below documentation/fixtures are not root workflow installations.

The direct branch-protection detail endpoint returned 403 for each repository. Therefore, review counts, eligible identities, required checks, force-push rules, and other detail remain unknown. Repository-level ruleset listings were empty, but that does not prove no organization rules exist. The full label catalogue endpoint was unavailable through the read surface, so configured labels are unknown; labels seen on sampled issues are not a full inventory. Effective inherited community-profile behavior is also unknown. `CODEOWNERS` was absent at the checked root paths. Ownership documents state proposed roles but no confirmed person or team. Confirm owner roles and authorized identities before proposing or setting ownership, protection, review gates, checks, label policy, security routes, or dependency-update automation. Do not infer owners or invent mandatory review counts, signing thresholds, or check names.

## Proposed administrative configuration — not approved or applied

This is a decision-ready proposal for the authorized owners to review. It documents desired values and prerequisites; it does not authorize or perform settings changes. The public audit observed `main` as the default branch for `.github` and the 14 listed consumer repositories. Reconfirm the default branch and settings immediately before any implementation. The private repository is excluded because its source and branch could not be inspected. The approval column identifies the responsible **role**, not a confirmed person or GitHub team.

| Target and observed state | Proposed value or control | Approving owner role | Evidence required before application |
|---|---|---|---|
| `.github/main` (branch metadata reported protected) and the consumer `main` branches: `shared-contracts`, `Jevelopers-GetTicketStub.com-Submission`, `integration-evals`, `landing-page-repo`, `cost-intelligence`, `creative-engine`, `event-intelligence`, `agent-harness`, `marketing-material`, `team-dashboard`, `getticketstub.com`, `fulfillment-connectors`, `print-production`, and `brand-kit` (metadata reported not protected) | Keep existing `.github/main` protection in force. For each consumer branch, enable pull-request-before-merge protection, disallow force pushes, and disallow branch deletion. Preserve existing review/signing requirements where they can be observed. Do not invent a review count, eligible identity/team, signed-commit requirement, or bypass identity; leave any inaccessible value unknown until its owner decides it explicitly. Use per-repository protection unless an organization owner chooses an organization ruleset. | Authorized administrator for each destination repository; the organization owner approves any organization-level ruleset. Destination maintainers confirm applicability. Actual named approvers are not recorded. | Refresh branch names and inspect the full current protection/ruleset configuration in an authorized admin surface. Record exact current values, intended exceptions/bypass identities, approval role, date, and resulting configuration evidence. The present read returned 403 for branch-protection details. |
| `.github/main` required checks, after the candidate governance PR | Once a successful GitHub-hosted run exists for the candidate PR, require the governance check-run context or contexts reported by GitHub for that tested commit. Candidate source identifiers are `.github/workflows/governance-checks.yml` job IDs `docs` and `validate`; the YAML display names are not asserted to be GitHub required-check context strings. Configure no required-check name until actual run evidence supplies the exact names. | `.github` repository maintainer recommends; the authorized `.github` repository administrator applies. If configured through an organization ruleset, the organization owner approves. No named person/team is confirmed. | Capture the successful run ID, exact tested commit SHA, conclusion, and check-run API/UI `name` values from the actual run. Confirm both jobs are stable and required to succeed before selecting those exact observed names. No hosted run receipt or check-run name is recorded in this audit. |
| Organization Actions defaults and any repository-level override affecting `.github` workflows | Set the default `GITHUB_TOKEN` permission to read-only. Keep each workflow/job at the minimum required permission. Do not expose secrets or write-capable tokens to fork-originated pull requests. If a later task needs write access, isolate it in a separately approved post-merge workflow with explicit permissions and environment controls. | Organization owner for organization-wide Actions defaults; authorized repository administrator for any repository-level exception. Maintainers describe the workflow need. Named approver is unknown. | Inspect current organization/repository Actions policy and fork settings. Verify the candidate's `contents: read` workflow/job permissions and `persist-credentials: false`; then test a harmless fork-originated PR path without a secret. Do not infer effective settings from workflow YAML alone. |
| `.github` security guidance and the parked security issue form | Keep `community/SECURITY.pending.md` and the sixth/security form inactive. Do not publish a root `SECURITY.md` contact route or enable the form until an actual private destination, access expectations, responsible role, escalation owner, and safe test procedure are approved. | The maintainers who approve the private route, with the designated security-reporting owner and the authorized organization administrator. The role and named contact remain unconfirmed. | Record the approved route and access/response responsibilities; validate it with a harmless test that contains no sensitive report details. Until that evidence exists, retain the pending state and direct reporters away from public issues for sensitive content. |
| Each of the 14 public consumer repositories on its own default branch | Require a deliberate repository-owner decision about whether to inherit, copy, adapt, or decline each shared form/template; verify that every referenced issue label exists in that destination's actual label catalogue; record the source SHA, destination SHA, reviewer role/date, applicability, deviations, and verification in a destination adoption record. Do not bulk-create or synchronize labels from this source proposal. | Maintainer of each destination repository; the destination's authorized administrator applies any local settings. Actual names/teams are unconfirmed. | Obtain current per-repository label inventories and local override evidence, inspect actual forms/templates, and record a destination-specific adoption decision. A few labels observed on issue/PR objects (`type:docs`, `type:implementation`, `cross-repo`) are partial evidence only and do not establish the configured catalogue. |

No administrative setting, branch rule, required check, Actions permission, security route, label, or consumer adoption was changed by this audit. Apply a row only after the identified owner role approves it and its prerequisites are recorded. The [repository bootstrap checklist](../repository-bootstrap.md) and [adoption-record template](../../templates/adoption-record.md) support the destination-specific follow-through.

## Governance issue decisions

Issues [#5](https://github.com/Jevelopers-neatHack-2026/.github/issues/5), [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16), and [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3) were closed completed on 2026-10-12 after the reduced-scope acceptance was recorded in [#5's comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/5#issuecomment-6122075793), [#16's comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6122141536), and [#3's comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6122142963). The ten retained leaf issues are complete. Issues [#11](https://github.com/Jevelopers-neatHack-2026/.github/issues/11) and [#13](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) were closed **not planned**, not passed.

The original twelve-leaf security baseline remains incomplete. No confirmed private reporting route or active sixth security form was established. The task did not disclose sensitive security information publicly. The issue closures apply only to the recorded reduced scope: they do not assert complete master acceptance, product release, a private security route, successful hosted workflow behavior, consumer-wide adoption, or completion of the original security baseline. Master acceptance remains owned by `integration-evals`.

## Profile asset verification

PR [#27](https://github.com/Jevelopers-neatHack-2026/.github/pull/27) published the organization profile refresh. The reproducibility check used `.github` revision `2f61f8551ecf38170f0c5b225305c950c7c3b222` and a read-only `brand-kit` checkout at `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`. `profile/build_assets.py` ran twice with Python 3.12.14, fonttools 4.61.1, and uharfbuzz 0.56.3. All seven generated SVGs were byte-identical between runs and matched tracked assets:

| Generated SVG | SHA-256 |
|---|---|
| `banner-day.svg` | `4cde5e14331fc58687d35d56b81984021631bf50628193226e5eed52ebfeb310` |
| `banner-night.svg` | `f8cee8f43a99520b4692569ab61acf2959558e4041ee01358d5c418b9f1c4e48` |
| `flow-day.svg` | `e5e0c51609d1d1e5d68d7da5a7fc95dd8fcb87229630705281e4339a469e7ac3` |
| `flow-night.svg` | `f60b9653987996f9116f1bf8abf7ee3e827890de6983d4590d09f19e8ebf1251` |
| `foil.svg` | `439768d985e2aa523618ccf1d90079c5c1ecefad78c010c66fd0cbf524b9b11c` |
| `palette.svg` | `e60ef6e6ed86e98810d49af753ded7f7d57337928cc6b92174d6de77be374340` |
| `perforation.svg` | `876925c351a1b5d8c3f6360824ab6ef5a56102bed537a4ab18f20535e1dc4921` |

All 17 profile assets (nine WebP and eight SVG) decoded or parsed. All ten repository SVG files parsed structurally; nine of the 19 repository graphics were visually inspected. Profile SVG titles and accessible labels were present. `profile/assets/ts-stamp.svg` (`a1279c701ff62a20288854bef1e7a7718128125d745485e30a019f2a2c78efd8`) is byte-identical to `brand-kit/logo/ts-stamp.svg` at the pinned brand-kit revision. The verification receipt is kept as scratch evidence and is not needed to interpret these results.

From the repository root, both generation runs can be reproduced using a read-only sibling checkout of `brand-kit` at the pinned SHA and an environment with the versions above:

```sh
set -eu
brand_kit_dir=../brand-reference
expected_brand_kit_sha=3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4
test "$(git -C "$brand_kit_dir" rev-parse HEAD)" = "$expected_brand_kit_sha"
asset_run_one=$(mktemp -d)
asset_run_two=$(mktemp -d)
trap 'rm -rf "$asset_run_one" "$asset_run_two"' EXIT
python3 profile/build_assets.py "$brand_kit_dir" "$asset_run_one"
python3 profile/build_assets.py "$brand_kit_dir" "$asset_run_two"
for asset in banner-day.svg banner-night.svg flow-day.svg flow-night.svg foil.svg palette.svg perforation.svg; do
  cmp "profile/assets/$asset" "$asset_run_one/$asset"
  cmp "$asset_run_one/$asset" "$asset_run_two/$asset"
done
```

This reproducibility command records a targeted asset-generation check. It does not require adding image/font dependencies to every governance CI run.

## Decisions that remain with repository owners

Before a consumer can be marked adopted or enforced, its authorized owner should record whether the shared source applies; choose local, inherited, or linked content intentionally; name the responsible owner role and approved people/team; confirm security and support routing; decide whether dependency updates use Dependabot or a reviewed equivalent; and capture local settings and evidence at a specific revision. The [repository bootstrap checklist](../repository-bootstrap.md) and [adoption-record template](../../templates/adoption-record.md) provide the process and fields. No settings were changed by this audit, and no foreign repository was modified.
