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

## entire-graph output (no agent)

The rules accept "Entire checkpoints or entire-graph output from the repository." Each of the 10 repos has a manual `Entire graph` GitHub Actions workflow (first added in getticketstub.com#40). It installs the checksum-verified Entire CLI `v0.11.4` and plugin `entire-graph` `v0.4.0`, then exports `entire graph snapshot --format compact-ndjson` for the exact `main` commit. No agent session, Entire login or developer machine is involved. Each snapshot below is copied unchanged from its run artifact, together with the run's `SHA256SUMS`, and every checksum verified. Each snapshot header names the same repo and commit as its row. Each repo's `init-agents` output (`.entire/graph-agent.md`, `AGENTS.md`, `CLAUDE.md`) was merged through a reviewed PR from the run's `entire-graph/<sha>` branch.

| Repository | Commit (main) | Run | Files | Symbols | Relations | Snapshot |
| --- | --- | --- | ---: | ---: | ---: | --- |
| getticketstub.com | `c384776771eaa6b64beba99607007b5b9d47066d` | [38166575087](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/actions/runs/38166575087) | 331 | 4758 | 12849 | [graph-getticketstub-c384776](graph-getticketstub-c384776/README.md) |
| agent-harness | `70841eb10df8973239e0e1fdfab82f6af9680f33` | [38167306765](https://github.com/Jevelopers-neatHack-2026/agent-harness/actions/runs/38167306765) | 113 | 2105 | 7683 | [graph-agent-harness-70841eb](graph-agent-harness-70841eb/) |
| cost-intelligence | `7d0573331bc978212bf28ca9ec18f7525a41cc2c` | [38167313026](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/actions/runs/38167313026) | 102 | 2633 | 6387 | [graph-cost-intelligence-7d05733](graph-cost-intelligence-7d05733/) |
| creative-engine | `2b3632c6feeace25376d33d24fcbe91aff0ef29b` | [38167322823](https://github.com/Jevelopers-neatHack-2026/creative-engine/actions/runs/38167322823) | 111 | 4368 | 8550 | [graph-creative-engine-2b3632c](graph-creative-engine-2b3632c/) |
| event-intelligence | `1992ca6ec1865906ad853035f11a6ab83df8339e` | [38167329573](https://github.com/Jevelopers-neatHack-2026/event-intelligence/actions/runs/38167329573) | 112 | 3803 | 8439 | [graph-event-intelligence-1992ca6](graph-event-intelligence-1992ca6/) |
| fulfillment-connectors | `30f8e7859eddf92ffc9f8bebbd8384706f92d884` | [38167337832](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/actions/runs/38167337832) | 43 | 2421 | 8362 | [graph-fulfillment-connectors-30f8e78](graph-fulfillment-connectors-30f8e78/) |
| integration-evals | `5e487aa4b1822bd53d559a0e5e2e18389f4d698a` | [38167345283](https://github.com/Jevelopers-neatHack-2026/integration-evals/actions/runs/38167345283) | 10 | 123 | 173 | [graph-integration-evals-5e487aa](graph-integration-evals-5e487aa/) |
| print-production | `54ab292254ed275261ce005f3f6a19e342a51bac` | [38167353404](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38167353404) | 183 | 1025 | 5105 | [graph-print-production-54ab292](graph-print-production-54ab292/) |
| shared-contracts | `4e0ebbc3a1c06187a8e309f63a961d1aaf7461c7` | [38167360776](https://github.com/Jevelopers-neatHack-2026/shared-contracts/actions/runs/38167360776) | 8 | 49 | 79 | [graph-shared-contracts-4e0ebbc](graph-shared-contracts-4e0ebbc/) |
| team-dashboard | `f53b5c2912853bc634b123b6a0747a57f0db09b7` | [38167367816](https://github.com/Jevelopers-neatHack-2026/team-dashboard/actions/runs/38167367816) | 64 | 317 | 753 | [graph-team-dashboard-f53b5c2](graph-team-dashboard-f53b5c2/) |

Verify any folder with `shasum -a 256 -c SHA256SUMS`, and check its commit with `head -1 graph-snapshot.ndjson`. The plugin version is not pinned: `plugin install` takes the latest release, and each run records the version it used in `graph-version.json`.

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
