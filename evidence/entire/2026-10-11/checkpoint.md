# Entire checkpoint `01M4P1DT7TRNWJ5EA42T47R1P0`

This is a real checkpoint from the Claude Code session that set up Claude integration and wrote the [setup record](README.md). It includes no transcript content. The transcript is stored only in the private checkpoint repo.

| Field | Value |
| --- | --- |
| Checkpoint ID | `01M4P1DT7TRNWJ5EA42T47R1P0` |
| Repository | `Jevelopers-neatHack-2026/integration-evals` |
| Branch | `docs/issue-27-entire-checkpoints` (base `main` `95b0812d6b433a27698930ea5d4cb45af0b82b9d`) |
| Bound commit | `3358f0ddf9a3b799924d459375925e603663581b` ("Add Entire checkpoint setup evidence for #27"), trailer `Entire-Checkpoint: 01M4P1DT7TRNWJ5EA42T47R1P0` |
| Agent / model | Claude Code, `claude-opus-5-5` |
| Agent session | `02a75f37-6672-42e2-9e7a-4538e8c9f6a9` |
| Created | 2026-10-11T17:51:01Z, Entire CLI 0.11.4, strategy `manual-commit`, 1 session |
| Checkpoint ref | `refs/entire/checkpoints/P0/01M4P1DT7TRNWJ5EA42T47R1P0` at `dc2778dc2a092f450f9bf01a0b6265ab56db86ec` (local, before push) |
| Storage | `git-refs` backend, synced on `git push` to the private repo `Jevelopers-neatHack-2026/entire-checkpoints` |

## How it was captured

The session started in the home directory, not inside an Entire-enabled checkout, so Claude's project hooks did not load for it. After the work was committed, the session's own transcript was linked with Entire's documented command for sessions the hooks did not capture:

```sh
entire session attach 02a75f37-6672-42e2-9e7a-4538e8c9f6a9 --agent claude-code --force
# Attached session 02a75f37-... · Created checkpoint 01M4P1DT7TRNWJ5EA42T47R1P0
# Amended commit b04d19d with Entire-Checkpoint: 01M4P1DT7TRNWJ5EA42T47R1P0  (amended SHA 3358f0d)
```

No session history was fabricated or imported from elsewhere. The credential-pattern scan of the transcript before attaching found no matches.

## Verification

Run in any environment with the `entire` CLI and a clone with the checkpoint refs fetched from `entire-checkpoints`:

```sh
entire checkpoint list                                    # branch docs/issue-27-entire-checkpoints, 1 checkpoint, (3358f0d)
entire checkpoint explain --commit 3358f0d --short        # Checkpoint 01M4P1DT7TRNWJ5EA42T47R1P0, session 02a75f37-..., commits 3358f0d
entire checkpoint explain -c 01M4P1DT7TRNWJ5EA42T47R1P0 --json   # agent Claude Code, model claude-opus-5-5, session_id 02a75f37-...
git log -1 --format=%B 3358f0d | grep Entire-Checkpoint   # Entire-Checkpoint: 01M4P1DT7TRNWJ5EA42T47R1P0
```

## Limitations

- The checkpoint came from `session attach`, not live hook capture, so `files_touched` is empty. Live capture of a Claude session started inside an enabled checkout has not been exercised yet.
- One session, one repository, captured on the owner's machine before the owner ruled out local capture. That local setup has since been removed (see [README](README.md)). Future checkpoints must come from a non-local environment, which isn't set up yet. No Codex checkpoint exists.
- Not mirrored on entire.io. `entire repo mirror list --available` lists the 9 App-selected code repos plus `entire-checkpoints` as `available` with no clusters, and `entire repo view` reports the repo is not visible yet. `getticketstub.com` is absent from that list. Onboarding (`entire repo mirror add`) would put hosted copies on Entire's clusters, so it is left to the owner. Git-based retrieval does not depend on it.
- Fresh-clone check: a new clone of this branch plus `git fetch https://github.com/Jevelopers-neatHack-2026/entire-checkpoints 'refs/entire/*:refs/entire/*'` gives checkpoint metadata with the same ID, session and agent. The public origin holds 0 `refs/entire/*`.
