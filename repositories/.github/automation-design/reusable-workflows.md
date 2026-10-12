# Reusable workflow guidance

This package contains examples, a copyable starter, a local consumer fixture, and two root workflows. `.github/workflows/docs-check.yml` is the reusable Markdown checker; `.github/workflows/governance-checks.yml` calls it from the same commit and runs the offline governance validator and fixture tests on pull requests targeting `main`, pushes to `main`, or manual dispatch. Both workflows grant only `contents: read`, check out with credentials disabled, and bound runnable jobs. Workflow files and local checks describe candidate source behavior; hosted success, Actions settings, and required-check enforcement need separate evidence for the exact revision.

## Check recommendations and status

| Check | Status in this package | Owner role | Meaningful pass condition | Failure condition |
|---|---|---|---|---|
| Markdown relative-link check | Installed reusable source, root caller, starter, and local fixture | Repository docs maintainer; CI owner reviews | Every supported relative file link in scanned Markdown resolves within the checkout; output reports files checked and zero broken links | Broken or escaping path, invalid scope, empty required docs directory, or checker error |
| Repository lint, unit tests, build | Recommendation only | Repository engineering owner and CI maintainer | Each repository's documented lint/test/build commands pass on the exact candidate revision | Any required command fails, is skipped, or has no recorded result |
| Contract compatibility | Recommendation only; integration-evals owns integrated gate | Producer and consumer contract owners | Local contract validation passes against the exact catalog revision and consumer fixtures; integrated result is linked separately | Catalog/version mismatch, unreviewed producer/consumer change, missing fixture, or absent integrated result |
| Evidence artifact hygiene | Recommendation only; no artifact upload configured | Evidence owner and repository maintainer | If an artifact is required, it is produced from the tested revision, contains the declared result/provenance, has a digest and limited retention/access, and is scrubbed of secrets and private data | Missing artifact, mismatched revision/digest, excessive access/retention, sensitive content, or fabricated evidence |

“Starter” means a workflow copied from workflow-templates into an adopting repository. “Example” means files under automation-design/examples for review. The root caller is source in this repository revision, and its `uses: ./.github/workflows/docs-check.yml` resolves to the reusable source at that same commit. “Configured” for a consumer means the consumer installed a caller or copied workflow on its own default branch and intentionally enabled it. “Verified” requires an actual authorized run on an exact source and caller revision with a run URL and inspected result. A local check or installed file does not establish a hosted run or consumer adoption.

The documentation starter checks a deliberately small Markdown link syntax: inline relative links whose target is a file or directory in the checkout. It skips external URLs and does not validate anchors, reference-style links, generated-site routing, or private links. It resolves and checks the requested scan root and each scanned Markdown file before reading; a docs/ symlink or file link resolving outside the checkout fails closed. A repository owner should replace or extend the check if its documentation format needs more coverage.

## Visibility and permission matrix

| Caller repository | Reusable workflow host | Requirement and expected denial |
|---|---|---|
| Public | Public | The organization must allow public reusable workflows. An inaccessible or removed source makes the run fail before its jobs execute. |
| Public | Private | Not accessible. GitHub's documented visibility matrix limits public callers to public reusable workflow repositories. Do not put private code or a private workflow ref in a public caller. |
| Private | Public | The caller's Actions policy must allow that public source. Review and pin the exact public source commit. |
| Private | Private | Both repositories must have compatible visibility and Actions policies, and the host repository must explicitly allow the caller. Grant source read access only to the people and teams who need it. |
| Private organization workflow template | Private destination | Available only to private destinations; people who use it need read access to the template source. Internal/public template visibility has different rules. A template is copied into a caller; it is not a reusable workflow grant. |

Public organization .github community-health defaults are a separate GitHub feature. They can be displayed for public repositories when a local equivalent is absent, but are not copied into clones. Private .github files do not supply public community-health defaults. Workflow templates and reusable workflows have their own visibility and access rules; neither gives a destination issue forms, agent instructions, settings, or a caller automatically.

The host and caller in automation-design/examples are illustrative private same-organization repositories. The caller contains an explicit placeholder for a reviewed full commit SHA and cannot run until the maintainer substitutes a real, reviewed source revision. A public destination must use a public reusable workflow source and follow the public-call permissions rule above.

## Security and input rules

- Declare only the minimum GITHUB_TOKEN permission needed. The examples use contents: read and no other token scopes. A called workflow cannot elevate the permissions granted by its caller; nested calls may keep or reduce them.
- Pass ordinary inputs with a declared type and validate them against an allowlist before using them. Transfer expression values through an environment variable, quote shell expansions, and never splice untrusted values into shell source, a path, a command, or a branch/ref without validation.
- Declare and pass no secrets unless a separately approved job requires one. Never use secrets: inherit as a shortcut. A reusable workflow receives no secret from this example, and its scripts do not print tokens, environment dumps, request headers, or secret values.
- Use pull_request for untrusted pull requests. Do not use pull_request_target or workflow_run to check out and execute fork-controlled files. The sample caller has no write token, secret, deployment environment, privileged runner, or provider call. A fork's Markdown is treated as data. Repository settings can change token behavior, so verify the actual settings before installing.
- Review third-party actions and pin them to a full commit SHA. The checkout examples use actions/checkout v7.0.1 at the immutable commit 3d3c42e5aac5ba805825da76410c181273ba90b1, inspected at [its release](https://github.com/actions/checkout/releases/tag/v7.0.1) and [commit](https://github.com/actions/checkout/commit/3d3c42e5aac5ba805825da76410c181273ba90b1). Recheck the action owner, release, runtime compatibility, transitive behavior, and changed commit before adoption. A full SHA reduces mutable-ref risk; it does not replace review.
- Do not upload an artifact unless a consumer needs it. Include only the smallest sanitized output, record source and tested revision, set the shortest useful retention, and limit artifact access. Review the host and caller visibility, outside-collaborator access, and log exposure before sharing a private reusable workflow; private workflow code or logs can reveal implementation context to people who can access the caller run.
- Sandbox, live-provider, paid, deployment, or credential-bearing jobs require explicit credential and budget authority, an owner, isolation review, and destination-specific approval. Without that authority, record blocked or skipped with the missing prerequisite. Do not label it pass, zero-cost, or verified.

GitHub controls when a private host permits access to calling repositories. The maintainer must confirm repository and organization Actions policies, the host access policy, permitted Actions, and secret/environment boundaries in the actual destination. Documentation and local fixture tests do not configure or prove those controls.

## Example contracts

The reusable source at automation-design/examples/reusable/.github/workflows/docs-check.yml declares interface contract docs-link-check/v1. It accepts one string input, scope, with allowed values docs or repository. It returns contract_version (docs-link-check/v1), checked_files (integer text), and result (passed or failed). Invalid input, an absent docs directory, an outside-checkout scan root, or a malformed/missing/escaping relative target fails the job with result=failed. It declares and accepts no workflow secrets. Its called job checks out the caller repository at the caller revision with persisted checkout credentials disabled, then scans Markdown as data with a workflow-defined Node script. The script does not execute repository-provided code and rejects a scan root, scanned Markdown source, or link target that resolves outside the checkout.

The caller at automation-design/examples/caller/.github/workflows/docs-check.yml demonstrates a pull_request invocation and consumes both outputs. Its uses ref is deliberately a placeholder, not an installable SHA. The executable local fixture under automation-design/fixtures/reusable-workflow is a local copy of the source plus a fixture runner; the Python tests extract and execute the exact Node script embedded in the called workflow. This exercises the declared input/output behavior without contacting GitHub.

The caller is pinned to a placeholder until its maintainer chooses the exact immutable source SHA. Record that SHA together with the caller SHA, contract version, fixture revision, exact local command, outputs, limitations, and reviewer. Add optional inputs/outputs compatibly within v1; an incompatible input/output change requires a new contract version, refreshed fixture, and caller review. A pinned caller does not silently move to a new source revision.

The fixture proves only local checker behavior and static policy checks. Local validation can inspect the source workflow and caller, but it does not prove hosted workflow-call resolution, Actions access settings, token behavior on the platform, fork isolation, secrets isolation, runner billing, artifact retention, status-check enforcement, or successful GitHub execution. Confirm those conditions with platform evidence tied to the exact candidate revision.

## Adoption checklist

Before copying or calling a workflow:

1. Record the destination URL, visibility, default branch, owner role, exact destination SHA, and intended caller event.
2. Review the source workflow, all action pins and scripts, input/output contract, token permissions, execution of untrusted code, and required runner. Record the full reviewed source SHA; do not use a moving branch or guessed revision.
3. Confirm caller Actions policy, allowed actions, reusable workflow source access, host access policy, and repository/organization secret and environment settings. Public callers cannot use a private workflow host.
4. Install the starter under the destination's .github/workflows path, or install the explicit reusable-workflow caller there. A reusable call must be in an installed workflow job and use an accessible source reference. A template copied into a repository does not require or create a reusable-workflow call.
5. Validate the merged destination source and input/output names. Run on an authorized safe branch or pull request with synthetic non-secret values. Never expose secrets to untrusted PR code.
6. Record the actual run URL, caller commit, called workflow commit, command/result, logs reviewed, artifact URL/digest/retention/access if any, and remaining limits. A configured file without an actual run is not verified.
7. Roll back by removing or reverting the caller from the destination default branch and restoring the previous destination revision. Recheck required-check settings after removal so they do not require an absent check.

The root caller is present in this candidate source revision. Source presence alone does not establish a GitHub run, consumer installation, source access grant, Actions setting, required check, artifact, or adoption. The platform follow-up is to have a named repository owner authorize a destination, verify its visibility and Actions policy, install a reviewed caller pinned to a full source SHA, run a non-secret fixture, inspect the run and logs, and record immutable evidence. Live/provider use still needs separate explicit authority.

## Offline governance validator

Run the governance validator and offline fixture suite from a repository checkout with Python 3.10 or newer and the exact dependency pin:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --no-input -r automation-design/tests/requirements.txt
.venv/bin/python scripts/validate_governance.py
.venv/bin/python -m unittest discover -s automation-design/tests -v
```

The validator checks the active GitHub issue-form properties/types used by this repository, duplicate field IDs and form names, YAML duplicate keys, chooser configuration, unique-key governance JSON structure and reference joins, dated observation snapshot counts and states, workflow token/runner/trigger/action-pin policy and secret declarations/references, release/PR template prerequisites, supported relative Markdown file links, HTML image `alt` presence, and profile asset references. Its workflow secret check rejects non-empty `secrets` keys and scans YAML string values for explicit `${{ ... }}` expressions, plus unwrapped `if` expressions, for a root `secrets` identifier. It recognizes direct, dot, index, and function-argument uses, compares that identifier without regard to ASCII case, and skips single-quoted expression literals (GitHub escapes a literal apostrophe as `''`). This is a targeted identifier scan, not a complete GitHub Actions expression parser and not evidence of hosted secret isolation. See GitHub's official [contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts) and [expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions) references. As a repository-profile rule, the validator requires IDs for interactive issue-form elements even though GitHub's schema does not require them. GitHub currently documents the form schema as public preview, so this offline subset must be reviewed against the current schema before future form changes. It does not validate GitHub's hosted issue-form rendering, labels available in GitHub, all Markdown/CommonMark or GitHub-Flavored Markdown behavior, generated anchors, reference-style links, Mermaid syntax, arbitrary integration-evals acceptance schemas, or live Actions behavior. It deliberately does not decide whether a GitHub label exists or whether a source file has been enabled as a setting.

## Official references

- [Reusable workflow access, visibility, permissions, and caller behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations)
- [Creating workflow templates and metadata](https://docs.github.com/en/actions/how-tos/reuse-automations/create-workflow-templates)
- [Calling reusable workflows, inputs, outputs, and secrets](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [Sharing actions and workflows from a private repository](https://docs.github.com/en/actions/how-tos/reuse-automations/share-with-your-organization)
- [Default community-health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
- [Current issue form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)
- [Supported keywords for reusable-workflow caller jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations#supported-keywords-for-jobs-that-call-a-reusable-workflow)
