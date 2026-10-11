# TicketStub Entire checkpoint evidence — 2026-10-11

Evidence for the Entire item in [setup issue #27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27) and master checklist SPN-02. It records how Entire is configured on the owner's machine and the checkpoint captured from the Claude Code session that wrote this file. It does not cover teammates' clones, every repository, or every agent, and it does not complete SPN-02 by itself.

## Configuration

| Item | State |
| --- | --- |
| CLI | `entire` 0.11.4 (Homebrew cask `entireio/tap/entire`), darwin/arm64 |
| Login | Entire account logged in on the owner's machine (`ENTIRE_TOKEN_STORE=file`); no API key setting is used |
| Checkpoint storage | `git-refs` backend; synced to the **private** repo `Jevelopers-neatHack-2026/entire-checkpoints`, never to the public code repos |
| Telemetry | off |
| GitHub App | Entire App on 10 code repos plus `entire-checkpoints` (owner-approved, see #27) |

Agents enabled per local checkout (`~/<repo>`, owner's machine):

| Repository | Codex hooks | Claude Code hooks |
| --- | --- | --- |
| agent-harness, cost-intelligence, creative-engine, event-intelligence, fulfillment-connectors, integration-evals, print-production, shared-contracts, team-dashboard | installed; still need approval in Codex `/hooks` | installed 2026-10-11 |
| getticketstub.com | installed; still need approval in Codex `/hooks` | not installed: another Claude session is working in that checkout, so the hooks wait for its agreement |
| .github, brand-kit, landing-page-repo, marketing-material | not enabled (outside the Entire App selection) | not enabled |

Teammates' clones and linked worktrees are not configured. Settings live in untracked files, so a linked worktree needs `.entire/settings.local.json` copied in before Entire tracks it.

## Shared versus local settings

Nothing Entire-related is committed to any repository. Every file below is local to the clone and listed in that clone's `.git/info/exclude`:

| File | Scope | Contents |
| --- | --- | --- |
| `.entire/settings.local.json` | local | `enabled`, `telemetry: false`, `checkpoints.primary.type: git-refs`, `strategy_options.checkpoint_remote` (github, `Jevelopers-neatHack-2026/entire-checkpoints`), `push_sessions: true`. No credentials. |
| `.entire/settings.json` | shared, if committed | **Not created.** `entire enable --local` was used deliberately. |
| `.entire/.gitignore`, `.entire/tmp`, `metadata`, `logs` | local | Entire's working data, including in-progress session data. Never commit. |
| `.claude/settings.json` | Claude project settings | Entire's 9 Claude hooks (`entire hooks claude-code <event>`, each a no-op when `entire` is not installed). Excluded locally instead of committed, so teammates' Claude sessions are not changed without their consent. |
| `.codex/hooks.json` | local | Entire's Codex hooks. |
| `.git/hooks/{prepare-commit-msg,commit-msg,post-commit,post-rewrite,pre-push}` | local | Entire git hooks. No other hook manager (husky, `core.hooksPath`) is present. |

Transcripts can contain anything a session read, and Entire's redaction is best-effort ([security docs](https://docs.entire.io/security)). That is why checkpoints go only to the private checkpoint repo. Do not point `checkpoint_remote` at a public repository, commit a shared `.entire/settings.json` that turns on pushing, or copy transcript content into this public repo. This record contains identifiers and metadata only.

## Enabling Claude Code in another clone

Do not use the Codex-specific `entire enable --agent codex` for this. In a clone that is already enabled:

```sh
entire agent add claude-code                         # writes .claude/settings.json, keeps the Codex hooks
echo '/.claude/settings.json' >> .git/info/exclude
entire status                                        # Agents · Claude Code, Codex
```

In a fresh clone: `entire enable --agent claude-code --local --telemetry=false --checkpoint-remote github:Jevelopers-neatHack-2026/entire-checkpoints`, then add `/.entire/` and `/.claude/settings.json` to `.git/info/exclude`. Hooks load when a Claude session starts in that directory. A session started elsewhere is not captured automatically; `entire session attach <session-id>` links its transcript to the last commit.

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
