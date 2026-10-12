# Current status and boundaries

This page holds the dated status detail and installation boundaries that the [repository README](../README.md) summarizes. The documentation defines expectations; it does not by itself change repository settings, prove that a product requirement passed, or establish adoption by another repository.

For the gate-by-gate assessment (twelve leaf issues, nine `GH-GATE` checks, settings observations and required next evidence), see the [dated partial governance release assessment](../adoption/governance-release-record.md). It is a historical record written before the scope change below and was not rewritten. Recheck live repository state before relying on any dated snapshot.

## Current status

The dated repository audit and profile evidence are in the [2026-10-12 governance status addendum](../adoption/observations/governance-status-addendum-2026-10-12.md) and its [machine-readable organization observation](../adoption/observations/organization-adoption-2026-10-12.json). The content audit is pinned to the 15 public default-branch trees observed at **2026-10-12 17:16:34 UTC**; their full SHAs and source URLs are recorded in the JSON. The public repository inventory contained 15 public repositories and one private repository. Only public repository identifiers and tree evidence appear in the published audit.

A later metadata read at **17:19:49 UTC** recorded public default-branch heads separately. Seven later metadata heads differed from the inspected tree SHAs; the exact pairs are listed in the addendum. Those later heads were not tree-audited here. This metadata read followed [PR #27](https://github.com/Jevelopers-neatHack-2026/.github/pull/27), which merged at 17:16:51 UTC and published the organization profile refresh. The head metadata is not a second tree audit. The 17:16 content matrix must be read at its exact pinned revisions, not as a continuously current inventory. The profile asset-generation evidence below records the reproducible rendering check.

- **Governance issues:** [#5](https://github.com/Jevelopers-neatHack-2026/.github/issues/5), [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16), and [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3) were closed completed after the reduced-scope decision. Their acceptance/closure records are [#5 comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/5#issuecomment-6122075793), [#16 comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6122141536), and [#3 comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6122142963). The ten retained leaf issues are complete. [#11](https://github.com/Jevelopers-neatHack-2026/.github/issues/11) and [#13](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) are closed **not planned**; neither is a passed check. The original twelve-leaf security baseline remains incomplete: there is no confirmed private reporting route or active sixth security form, and sensitive details must not be posted in an ordinary public issue.
- **Governance source and adoption:** at the pinned `.github` revision `2f61f85`, five issue forms plus chooser configuration and a pull-request template are present. Ten of 14 public consumer roots have `AGENTS.md`; 13 have `docs/architecture/OWNERSHIP.md`. Consumer roots have no recorded local issue forms, pull-request template, `CONTRIBUTING.md`, `CODEOWNERS`, code of conduct, or recognized `SECURITY.md`/`SUPPORT.md`. No consumer adoption record or verified adoption evidence was found. Source publication and missing local overrides do not establish that GitHub displayed an inherited default, that a workflow was adopted, or that a policy is enforced.
- **Workflow evidence:** 48 tracked YAML files were found in consumer `.github/workflows` directories at the pinned revisions. All 48 parsed using PyYAML 6.0.3 `BaseLoader`; the audit inspected their `jobs` mappings and found no job-level reusable-workflow calls and no `on.workflow_call` definitions. These are repository files, not evidence that Actions is enabled or that runs succeeded. The pinned `.github` root has no workflow files.
- **Settings and ownership gaps:** the `main` branch metadata reported protection enabled for `.github` and disabled for all 14 public consumers. The direct branch-protection detail endpoint returned 403. Repository-level ruleset listings were empty; this does not establish the absence of organization-level rules or every possible platform control. The full label catalogue and effective inherited community-profile behavior remain unknown. Ownership documents use proposed roles; they do not name confirmed individuals or teams. No `CODEOWNERS` file was observed. Confirm the responsible owner roles and actual authorized people before proposing settings, review gates, checks, or ownership assignments; do not invent review counts or signing requirements.
- **Private repository scope:** metadata for one private repository was inspected, but branch/tree/README source requests returned 404. No source content was fetched, so artifact presence and adoption remain unknown. Its identifier and evidence are withheld from the public record.
- **Acceptance boundary:** the issue closures close only the reduced governance work. They do not establish a master acceptance pass, product release, private security route, hosted-workflow behavior, consumer-wide adoption, or a complete security baseline. Master acceptance state remains owned by integration-evals.

The full per-repository gap matrix, endpoint limitations, profile validation, and owner decisions are in the dated addendum below. The [dated partial governance release assessment](../adoption/governance-release-record.md) and the sections citing revision 4129e71 remain historical records; they are preserved rather than rewritten.

## Profile asset verification

The organization profile refresh was published by PR #27. At `.github` revision `2f61f8551ecf38170f0c5b225305c950c7c3b222`, `profile/build_assets.py` used a read-only `brand-kit` checkout at `3c48922b54bf0cc7d92bf9de1f59b1bd3cdad4a4`. Two runs with Python 3.12.14, fonttools 4.61.1, and uharfbuzz 0.56.3 generated seven SVGs deterministically; every output matched its tracked asset byte-for-byte. All 17 profile assets (nine WebP and eight SVG) decoded or parsed, and all ten repository SVG files parsed structurally. Across 19 repository graphics, nine were visually inspected. The profile SVG titles and accessible labels were present. `profile/assets/ts-stamp.svg` is byte-identical to `brand-kit/logo/ts-stamp.svg` at the pinned brand-kit revision.

The generated SVG SHA-256 values are recorded in the [status addendum](../adoption/observations/governance-status-addendum-2026-10-12.md). To reproduce both runs from the repository root, use a read-only sibling checkout of `brand-kit` at the recorded revision and an environment with the recorded Python packages:

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

This asset-generation verification is an evidence-backed offline command, not a requirement to add font-building dependencies to every governance CI run.
## Published sources (historical, 4129e71 snapshot)

At inspected public default-branch revision [4129e71](https://github.com/Jevelopers-neatHack-2026/.github/commit/4129e71f42a51d42803b1020e146f54108cf2f93), observed 2026-10-11 02:48:39 UTC, [PR #19](https://github.com/Jevelopers-neatHack-2026/.github/pull/19) published the pull-request template and adoption guide, and [PR #20](https://github.com/Jevelopers-neatHack-2026/.github/pull/20) published five active issue forms plus a security draft outside the chooser. The PR template contract is `GH-PR-TEMPLATE@1.0.0`; the issue-form contract is `GH-ISSUE-FORMS@1.0.0`. Both interface versions are separate from execution-policy pack 1.1.0, product releases, and destination adoption status.

## Open governance work (historical, 4129e71 snapshot)

> **Historical, superseded where it differs:** this section records the 2026-10-11 4129e71 snapshot and is kept as dated evidence. Since then `GH-01` (#4) and `GH-04` (#9) were closed, and `GH-07` (#11) and `GH-03-I` (#13) were closed not planned; see [Current status](#current-status) above for the present state.

At that snapshot the remaining governance guidance work is still under review. `GH-01` still needs its second-maintainer validation. `GH-07` remains blocked until a maintainer confirms a private security-reporting destination and responsible role. A dated native GitHub client check after the PR20 merge verified the five active chooser entries, editable prompts, empty-text client-side required-field rejection under a per-tab network deny guard, and 46 per-field Markdown previews. It created no issue and did not test server validation or an assembled posted body. The check recorded a small 8 px mobile document overflow as an advisory, not a responsive pass; it was not a full assistive-technology audit. The security form remains outside the chooser, and no sensitive details should be sent through an ordinary public issue while the private route is unresolved. `GH-03-I` remains open.

- `GH-01` remains open until the required second-maintainer review is recorded.
- `GH-07` security reporting remains blocked until a maintainer confirms the private destination and responsible role; no contact or response time is supplied here.
- `GH-03-I` remains open: post-merge native checks verified empty-text client rejection for the five active forms, but did not test server validation, an assembled issue body, or an unselected required dropdown. The private route and sixth active form remain blocked, and destination-specific adoption is unverified.
- Per-repository settings and adoption, plus any GitHub-hosted workflow execution or secret-isolation evidence, require separate destination-specific observations.

## Workflows

The pinned **17:16:34 UTC source snapshot** had no root `.github/workflows` files. The candidate change set now includes `.github/workflows/docs-check.yml` (reusable documentation-link check) and `.github/workflows/governance-checks.yml` (pull-request, push-to-main, and manual caller). The caller's job IDs are `docs` (reusable link check) and `validate` (governance validator and offline contract/security tests).

- **Source:** both workflow files and their read-only workflow/job permission declarations are present in the candidate change set. The workflow source is a proposal until reviewed and merged.
- **Local validation:** the offline automation test suite passed 47/47 tests. `actionlint` was unavailable, so a separate actionlint parse was not performed.
- **Hosted execution:** no GitHub-hosted run receipt or successful check-run evidence is recorded here. Workflow execution, fork isolation, secrets behavior, and reusable workflow access have not been demonstrated by a hosted run.
- **Enforcement:** required-check settings are unknown. After the candidate PR has a successful hosted run, an authorized `.github` administrator may consider requiring the exact check-run names returned by GitHub for the tested commit. Identify the source jobs as `governance-checks.yml/jobs.docs` and `governance-checks.yml/jobs.validate`; do not infer required-check context names from their YAML display names. No required-check setting is claimed as active.

See [reusable workflow guidance](../automation-design/reusable-workflows.md) and the [local fixture](../automation-design/fixtures/reusable-workflow/README.md). The full clearly unapplied administrative proposal and owner prerequisites are in the [dated addendum](../adoption/observations/governance-status-addendum-2026-10-12.md).

## Architecture and evidence ownership

The master acceptance IDs and their status are owned by integration-evals. A merged documentation change, local fixture result, or mock check does not verify a master acceptance ID or complete a product release.

The [local ownership view](architecture/OWNERSHIP.md) defines this repository's documentation responsibility. The [local acceptance view](architecture/ACCEPTANCE.md) selects criteria but is not the master tracker.

Canonical architecture and the implementation plan live in getticketstub.com. Canonical schemas live in shared-contracts. Master acceptance state and evidence records live in integration-evals. Each repository owns its local implementation instructions, checks, settings, and adoption record. See the [source registry](../standards/architecture-linking.md) for immutable inspected references and link rules.

## Template and installation boundaries

The pull-request template is a published source on this repository's public default branch. GitHub may use organization default community-health files when a destination repository has no local equivalent. Local files take precedence; inherited defaults do not appear in clones. See [template guidance](../templates/README.md) for source visibility, local overrides, the versioned template contract, and per-repository adoption records.

Agent instructions, CODEOWNERS, licenses, workflow callers, labels, and repository settings require deliberate local decisions. Public issue forms and pull-request templates may appear as organization defaults when a destination has no local equivalent, but a local template directory overrides them. Consult current, destination-specific evidence before claiming a setting, label, workflow, or template is active. Do not report organization-wide adoption from one repository's result.

Use the [bootstrap record](../templates/adoption-record.md) to capture source revision, destination revision, applicability, verification evidence, deviations, and blockers. Public `.github` defaults are not copied into clones, and a private `.github` repository is not a supported source for public organization community-health defaults.
