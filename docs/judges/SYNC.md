# Keep the submission current

[Back to the judge guide](../../README.md)

## Refresh the submission at any time

Requirements: macOS or Linux, Python 3.10+, Git, authenticated [GitHub CLI](https://cli.github.com/), and [Gitleaks](https://github.com/gitleaks/gitleaks) 8.30.1 or newer. On macOS, `brew install gh gitleaks` installs the two CLIs. Authenticate with `gh auth login` using an account that can push to this submission repository.

From a clean checkout on `main`:

```sh
git pull --ff-only
python3 scripts/sync_submission.py --publish
```

The script discovers all public repositories in `Jevelopers-neatHack-2026` except this submission repository, fetches each default branch, scans the complete staged snapshot for secrets, verifies each copied Git tree against its source, refreshes the index and manifest, and commits and pushes only when something changed. New public repositories are picked up automatically. Files removed upstream are removed from the next snapshot. Refresh after merging the work you want judges to see.

It fetches complete history for each selected branch to count source commits accurately. Repository, file, text-line, source-file-line, and commit counts are generated in the same manifest and index. [Counting rules](COLLECTION.md) explain what each number includes. Full history may take longer to fetch than the earlier shallow snapshots; only files at the selected commit are copied into the collection. The sync also imports original source commits as merge parents, preserving author credit. [How credit works](CONTRIBUTORS.md) records rollout status and GitHub account-matching limits.

If the signed-in account has used its GitHub API quota, public metadata can use the separate unauthenticated quota:

```sh
python3 scripts/sync_submission.py --publish --public-api
```

This mode still checks each repository’s public visibility, excludes private projects, scans secrets, and verifies exact source trees. Git push still uses your normal authentication. The public quota is lower; if it is exhausted too, wait until the reported reset time and rerun. A rate-limit failure leaves the existing snapshots intact.

To inspect an update before publishing:

```sh
python3 scripts/sync_submission.py --dry-run  # fetch and scan, without changing files
python3 scripts/sync_submission.py            # stage the generated update locally
git diff --cached --stat
git commit -m "Refresh submission snapshot"
git push origin main
```

Only committed code on GitHub's default branches is collected. Open pull requests, other branches, local edits, issues, releases, and private repositories (including agent-session checkpoint storage) are outside the snapshot. Original commit history remains in the source repositories, with exact commit links in the index. Successful history-enabled syncs also connect those unchanged commits to submission main. Do not squash or rebase the sync merge: its parents preserve the original histories. The source repositories remain the development homes. Edit source projects there and rerun the script; edits inside this repository's generated `repositories/` folders are overwritten by the next refresh.

The script fails before replacing the snapshot if a fetch, snapshot or history secret scan, or file validation fails. It rejects submodule pointers, Git LFS pointers, escaping symlinks, and oversized files instead of silently submitting incomplete code. Previously included repositories disappearing or becoming private require explicit manifest review. Updates use normal Git pushes without force; if another maintainer publishes first, reconcile your checkout and rerun. If a push fails after the local commit, that commit remains available for inspection and a normal retry with `git push origin main`.

Upstream workflows are kept inside their component folders and do not become active workflows in this repository. Existing per-project licenses and notices remain attached to their files; this collection grants no additional license.

History imports also scan older committed versions, including files later deleted. Their findings require the same exact-file review. A failed history scan leaves the current snapshots intact.

### Secret scan review

The initial source scan found intentionally public test credentials and fixture JWTs, source-file checksums, browser storage keys, and graph identifiers. `scripts/reviewed-scan-findings.json` records the reviewed matches with exact file SHA-256 hashes and finding locations. There are no blanket directory or rule exclusions. Changing any matched file invalidates its exceptions; new matches block publication and produce a redacted report in the system temporary directory. Review such reports and update only confirmed false positives in the baseline. Never automatically regenerate the baseline or use it to accept real credentials.

### Verify the sync tooling

```sh
python3 -m unittest discover -s tests -v
```

Presentation files in `README.md` and `docs/` are maintained by hand. The sync replaces only `repositories/`, `sources.json`, and `REPOSITORIES.md`. It never copies private checkpoint storage. Evidence records describe their tested revisions; refreshes do not reverify those claims.
