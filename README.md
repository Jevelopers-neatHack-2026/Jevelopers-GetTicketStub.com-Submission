# TicketStub — neatHack 2026 submission

TicketStub is a keepsake studio: turn the link to a show, a game, or a night out into a collectible ticket stub with researched facts, artwork, and print-ready design.

This repository brings the team's public project repositories together in one download. Each project is included as real source files under `repositories/`, with its own documentation, assets, and license notices where present.

## Start here

- **Customer studio:** [getticketstub.com](repositories/getticketstub.com/README.md).
- **Architecture:** [system overview and ownership](repositories/getticketstub.com/docs/architecture/OWNERSHIP.md).
- **Agent workflows:** [agent-harness](repositories/agent-harness/README.md).
- **Sponsor and project evidence:** [evidence index](repositories/integration-evals/evidence/README.md).
- **Current acceptance status:** [master checklist](repositories/integration-evals/planning/acceptance-checklist.md).
- **All projects and exact source commits:** [repository index](REPOSITORIES.md) · [source manifest](sources.json).

The project is actively developed. The included acceptance checklist and component READMEs describe implemented, demonstrated, and pending work; collecting the code here does not certify integrated acceptance.

## Run the studio demo

Use the Node.js and npm versions specified by the included studio's `.nvmrc` and `package.json`, then:

```sh
cd repositories/getticketstub.com
npm ci
npm run dev
```

Follow the [studio README](repositories/getticketstub.com/README.md) for current runtime configuration, checks, and production instructions. Other components retain their own setup and test commands. This is a source collection, not a newly integrated root build.

## Refresh the submission at any time

Requirements: macOS or Linux, Python 3.10+, Git, authenticated [GitHub CLI](https://cli.github.com/), and [Gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 or newer. On macOS, `brew install gh gitleaks` installs the two CLIs. Authenticate with `gh auth login` using an account that can push to this submission repository.

From a clean checkout on `main`:

```sh
git pull --ff-only
python3 scripts/sync_submission.py --publish
```

The script discovers all public repositories in `Jevelopers-neatHack-2026` except this submission repository, fetches each default branch, scans the complete staged snapshot for secrets, verifies each copied Git tree against its source, refreshes the index and manifest, and commits and pushes only when something changed. New public repositories are picked up automatically. Files removed upstream are removed from the next snapshot. Refresh after merging the work you want judges to see.

To inspect an update before publishing:

```sh
python3 scripts/sync_submission.py --dry-run  # fetch and scan, without changing files
python3 scripts/sync_submission.py            # stage the generated update locally
git diff --cached --stat
git commit -m "Refresh submission snapshot"
git push origin main
```

Only committed code on GitHub's default branches is collected. Open pull requests, other branches, local edits, issues, releases, and private repositories (including agent-session checkpoint storage) are outside the snapshot. Original commit history remains in the source repositories, with exact commit links in the index; the submission has its own snapshot history. The source repositories remain the development homes. Edit source projects there and rerun the script; edits inside this repository's generated `repositories/` folders are overwritten by the next refresh.

The script fails before replacing the snapshot if a fetch, secret scan, or file validation fails. It rejects submodule pointers, Git LFS pointers, escaping symlinks, and oversized files instead of silently submitting incomplete code. Previously included repositories disappearing or becoming private require explicit manifest review. Updates use normal Git pushes without force; if another maintainer publishes first, reconcile your checkout and rerun. If a push fails after the local commit, that commit remains available for inspection and a normal retry with `git push origin main`.

Upstream workflows are kept inside their component folders and do not become active workflows in this repository. Existing per-project licenses and notices remain attached to their files; this collection grants no additional license.

### Secret scan review

The initial source scan found intentionally public test credentials and fixture JWTs, source-file checksums, browser storage keys, and graph identifiers. `scripts/reviewed-scan-findings.json` records the reviewed matches with exact file SHA-256 hashes and finding locations. There are no blanket directory or rule exclusions. Changing any matched file invalidates its exceptions; new matches block publication and produce a redacted report in the system temporary directory. Review such reports and update only confirmed false positives in the baseline. Never automatically regenerate the baseline or use it to accept real credentials.

### Verify the sync tooling

```sh
python3 -m unittest discover -s tests -v
```
