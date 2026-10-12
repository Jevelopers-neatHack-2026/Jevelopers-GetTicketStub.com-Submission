# Branch-to-review workflow

This is a recommended procedure for an individual repository. It does not configure branch protection, required reviewers, required checks, or merge rules. Each repository records observed enforcement separately.

## 1. Start from the owning issue and source

Read the destination repository's applicable AGENTS.md, README, ownership view, local acceptance view, and contributor guidance. Read central architecture, maintained contracts, and the authoritative acceptance source when relevant. Record the exact source revision and preserve existing accepted design.

A ready issue states its owner role, priority and rationale, required-for-v1 status, current evidence and revision, gap, scope and non-goals, acceptance IDs or justified N/A, dependencies and unblock conditions, provider mode, validation plan, evidence requirements, and closure evidence. If an essential field is unknown, state unknown and identify the owner role that must resolve it.

## 2. Create a focused branch

Suggested grammar:

    <type>/<issue-key>-<short-summary>

Fictional branch and commit examples (no corresponding issue, PR, merge, or test run is claimed):

| Contribution | Branch | Commit subject |
|---|---|---|
| Feature | `feat/issue-123-component` | `feat: implement the scoped component` |
| Bug | `fix/issue-456-bug` | `fix: correct the reported behavior` |
| Documentation | `docs/update-architecture` | `docs: clarify the architecture boundary` |
| Dependency maintenance | `chore/dependency-maintenance` | `chore: update the reviewed dependency` |
| Security hardening | `security/credential-hardening` | `security: restrict credential exposure` |
| Cross-repository integration | `integration/example-contract-handoff` | `integration: add contract handoff fixture` |

Use a repository's established naming policy if one exists. Lowercase branch names make examples easy to type. Preserve the canonical issue key in the pull-request body. A branch name is a convention, not evidence that the repository enforces it.

## 3. Commit focused changes

Use a short imperative subject with an optional type or scope, such as:

- docs: define evidence record fields (GH-08)
- fix(orders): reject expired quote (GH-22)
- feat: expose saved favorites (GH-21)
- integration: add contract handoff fixture (IE-09A)

Avoid vague subjects such as update files, multiple unrelated changes in one commit, and unsupported claims such as tests passed when the body has no result. Add a body for rationale, compatibility, migration, validation, or a known blocker. Do not rewrite others' history. The repository maintainer decides whether to squash or preserve commits; record that choice if it affects evidence.

## 4. Open a focused pull request

The shared pull-request template is at .github/pull_request_template.md. Copy it deliberately into the destination repository if appropriate. State:

- issue key and exact issue URL;
- summary, exact scope, and non-goals;
- dependent issue URLs, producer/consumer roles, expected artifact/version, and unblock condition;
- acceptance IDs or reasoned N/A;
- affected owners, interfaces, ADRs, and contract-catalog entries;
- compatibility, migration, and release impact;
- validation plan separately from commands actually executed;
- tested full SHA, runtime/configuration, input or fixture digest, expected and actual results;
- provider mode for each component and unknown cost/usage where relevant;
- evidence locations/access class, redactions, limitations, skips, and closure evidence;
- accountable reviewer roles and any required producer/consumer acknowledgments.

Before requesting review, inspect the diff, check for secrets and unrelated files, and run the relevant local checks. A draft PR may be useful while a dependency is unresolved; it is not ready evidence.

Use a neutral reference such as Refs #N for issue links in every PR. Do not use an auto-closing keyword. The authorized supervisor closes the local issue only after the exact candidate is merged and the required post-merge evidence is recorded. A merged documentation PR does not verify a master acceptance item; integration-evals updates its status after evidence review.

## 5. Review states and change-type guidance

Use the following terms consistently in PR descriptions and handoffs. `Blocked` and `Verified` are process descriptions, not native GitHub PR states or claims that a setting exists.

| Term | Meaning |
|---|---|
| Draft | The author is still preparing the change; reviewers should not treat it as a final review request. |
| Ready for review | The author has supplied the scope, issue links, planned and executed checks, and known gaps, and has requested review. It does not mean approved. |
| Approved | When the destination's actual process calls for human approval, an authorized maintainer has submitted an approving GitHub review on the current candidate. This term does not set a review count or add a universal approval requirement. An independent model review or checkbox is not a GitHub approval. |
| Blocked | A named dependency, required check, owner decision, or review remains unresolved. Record the unblock condition and owner role; do not describe the PR as ready to merge. |
| Merged | GitHub records the merge commit. This makes the change part of the destination branch but does not by itself establish product or master acceptance. |
| Verified | The scoped claim has the required evidence and review on the exact relevant revision. The authoritative acceptance owner records any master status change separately. |

Tailor review to the change. Ask for roles that own the affected decision; the destination's configured rules determine which approvals are actually required.

| Change type | Review focus |
|---|---|
| Documentation-only | Check facts against their owner source, link targets and headings, status language, accessibility, and that guidance does not imply an unconfigured control or unverified behavior. |
| Application code or behavior | Check acceptance scope, tests and negative cases, inputs and failure handling, compatibility, security/privacy effects, migration, and rollback where relevant. |
| Security-sensitive | Follow any actual destination rule or owner decision for security review; do not create a universal required reviewer from this guidance. Inspect exposure paths, permissions, secret handling, untrusted input, and evidence redaction. Keep sensitive details in a confirmed private channel. If the route is unconfirmed, block only a disclosure or credential action that requires it; safe, non-sensitive hardening and review can proceed within the authorized scope. |
| Workflow or automation | Inspect triggers, permissions, action revisions, untrusted pull-request context, caller access, secrets, generated artifacts, and failure behavior. Validate locally where possible; a successful source check does not prove a consumer's hosted run or settings. |
| Contract or API change | Request review from the canonical contract owner and affected producer and consumer roles. Check schema/version compatibility, fixtures, migration/deprecation, exact source revisions, and consumer acknowledgment. A producer test alone is not integrated acceptance. |

## 6. Merge, verify, and maintain

An implementation author does not review their own work as the independent review. The reviewer inspects the whole exact diff, surrounding source, acceptance criteria, tests, and dependency evidence. Distinguish an independent model review from a genuine GitHub maintainer approval and from configured branch protection. A review comment is not evidence that a protection rule required it.

Capture base SHA, head SHA, and candidate merge commit/tree when available. If a commit, rebase, conflict resolution, base, or candidate changes in a way that affects the reviewed result, get review on the current exact candidate and rerun affected checks. Keep blocking findings open until corrected or reasoned by an authorized independent owner.

Only an authorized maintainer merges, under the repository's actual protection and merge rules. Do not bypass a required review/check or claim enforcement when no live setting was inspected. After merge, verify the merge commit and any applicable installation or behavior. Keep an issue open while its accepted evidence is missing.

For repository onboarding, ownership transfer, ongoing maintenance, and archival, follow the [governance lifecycle](governance-lifecycle.md). Follow the [release standard](releases-versioning.md) for version or publication decisions.

## Worked samples

These are documentation examples, not submitted pull requests or execution evidence.

- Documentation-only: GH-02 (#7), branch docs/gh-02-branch-review-guidance. A PR can report a Markdown/link command and a source SHA only after those commands run. Its merge makes the guidance available on the destination default branch; it does not change a master acceptance ID.
- Bug: a synthetic issue would link a sanitized reproduction and expected/actual behavior. The branch and test remain hypothetical until a destination issue and exact test run exist.
- Contract handoff: actual coordination sources include [shared-contracts issue #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) and [integration-evals issue #8](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/8). Link the producer revision, contract/version, executed producer check, fixture, and consumer acknowledgment. A source link alone is not an integration pass.

### One complete documentation-change path

This fictional walkthrough starts at the real [GH-02 issue #7](https://github.com/Jevelopers-neatHack-2026/.github/issues/7). It shows the handoff from issue through review without claiming a repository event:

| Stage | Record for this walkthrough |
|---|---|
| Issue and acceptance scope | Local governance key GH-02, issue #7. No product acceptance ID is claimed as verified; use N/A for master IDs because this is a documentation procedure example. |
| Branch | docs/gh-02-branch-review-guidance (illustrative branch name; no branch event is claimed) |
| Commit | docs: clarify branch-to-review evidence (GH-02 example); full SHA UNKNOWN because no commit event is claimed |
| PR | Would link the real issue with neutral text `Refs #7`, list scope/non-goals, dependencies, actual acceptance IDs or justified N/A, and producer/consumer roles where relevant. PR URL UNKNOWN; no PR is claimed. |
| Test plan and result | Planned: run the destination's documented Markdown/link check on the final candidate. Actual command, tested SHA, and outcome: N/A/UNKNOWN because no run is claimed. |
| Evidence and review | No artifact or reviewer record exists in this example. The independent reviewer would inspect exact base/head/candidate revisions and record a real review; status remains pending until that happens. |

After an actual merge, the authorized supervisor verifies the merge commit and relevant post-merge behavior before closing the local issue. A later relevant commit requires fresh review and affected checks. This table is a process walkthrough, not evidence of a PR, test, approval, merge, or master acceptance change.
