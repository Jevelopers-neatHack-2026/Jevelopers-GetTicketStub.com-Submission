# TicketStub Entire checkpoint evidence — 2026-10-11

Evidence for the Entire item in [setup issue #27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27) and master checklist SPN-02. It records how Entire is configured on the owner's machine and the checkpoint captured from the Claude Code session that wrote this file. It does not cover teammates' clones, every repository, or every agent, and it does not complete SPN-02 by itself.

## Configuration (current, after 2026-10-11 ~18:10Z)

The owner decided that Entire must be defined in the projects and must not run on the owner's machine. The capture below used a local setup; that setup has since been removed.

| Item | State |
| --- | --- |
| Project config | `chore/entire-project-config` PRs, open and unmerged, in all 10 App-selected repos: agent-harness#39, cost-intelligence#24, creative-engine#39, event-intelligence#52, fulfillment-connectors#33, getticketstub.com#38, integration-evals#28, print-production#26, shared-contracts#38, team-dashboard#21 |
| Owner's machine | Entire removed (`entire disable --uninstall` in all 10 checkouts: git, Codex and Claude hooks, `.entire/`, session state). CLI uninstalled (`brew uninstall --cask entire`), token file deleted. `git status` is unchanged in every checkout. |
| Checkpoint storage | `git-refs` backend; synced to the **private** repo `Jevelopers-neatHack-2026/entire-checkpoints`, never to the public code repos |
| Telemetry | off |
| GitHub App | Entire App on 10 code repos plus `entire-checkpoints` (owner-approved, see #27). No repo is mirrored on entire.io. |

## Committed (project) versus local settings

| File | Scope | Contents |
| --- | --- | --- |
| `.entire/settings.json` | committed (config PRs) | `enabled`, `telemetry: false`, `checkpoints.primary.type: git-refs`, `strategy_options.checkpoint_remote` (github, `Jevelopers-neatHack-2026/entire-checkpoints`), `push_sessions: true`. No credentials. |
| `.entire/.gitignore` | committed | Keeps `settings.local.json`, `tmp/`, `metadata/`, `logs/` and `redactors/local/` out of git. |
| `.claude/settings.json` | committed | Entire's 9 generated Claude hooks (`entire hooks claude-code <event>`). Each exits 0 when `entire` isn't on PATH. |
| `.entire/settings.local.json`, session data | local, ignored | Per-machine overrides and in-progress session data. Never commit. |
| `.codex/hooks.json` | not committed | Codex hooks aren't in the config PRs. |

Transcripts can contain anything a session read, and Entire's redaction is best-effort ([security docs](https://docs.entire.io/security)). Checkpoints therefore go only to the private checkpoint repo. Do not point `checkpoint_remote` at a public repository, and do not copy transcript content into this public repo. This record contains identifiers and metadata only.

## Where capture happens

The Entire GitHub App doesn't create checkpoints ([docs](https://docs.entire.io/guides/repositories/github-app-access): "Checkpoint data is created locally by the Entire CLI"). Checkpoints are only created where an agent session runs with the `entire` CLI installed and Entire's git hooks set up (`entire enable`). With the owner's machine excluded, that has to be another environment, such as a cloud agent session. That environment, and its ability to push to the private checkpoint repo, has not been set up or verified.

## Component revisions at capture time

`main` on GitHub, read with `git ls-remote` on 2026-10-11:

| Repository | main |
| --- | --- |
| getticketstub.com | `8afdefd40c9faf912e4a50a6a532fff0b5e480b2` |
| agent-harness | `cdd52b1406fb703e4c5b7c8c0c7f2b4ee5b68960` |
| event-intelligence | `ca252c5d52f150ae21cdfde8917659bd752a52fa` |
| creative-engine | `42444c99c59fcf4cd9b09b55a1b7ba52b1b77ea2` |
| print-production | `ca8fed888bdda8e432831b0c9f12f8b42fa09244` |
| fulfillment-connectors | `5e9fc8160e1285bd98f4012153f5a6296b7a22de` |
| cost-intelligence | `735b68a2c164af7f2f8054c4f3e275b7b35cc6d1` |
| team-dashboard | `4c66fd28552d387b97fc00f84ebfaa259868a97d` |
| shared-contracts | `686ead140e12b86ce4279b1beea881164025ba6a` |
| integration-evals | `95b0812d6b433a27698930ea5d4cb45af0b82b9d` (base of this branch) |

## Checkpoint

See [checkpoint.md](checkpoint.md). It is added in a follow-up commit because the checkpoint is bound to the commit that adds this file.
