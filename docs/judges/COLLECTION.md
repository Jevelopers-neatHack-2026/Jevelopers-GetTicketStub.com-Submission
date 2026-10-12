# What is in the code collection?

[Current counts and source versions](../../REPOSITORIES.md#collection-at-a-glance) · [Evidence](EVIDENCE.md)

The collection joins public projects at exact saved commits. A commit is a saved version of code. The [generated index](../../REPOSITORIES.md) shows totals and a row for each repo. Click its commit count to browse that source history.

## How we count

| Measure | Meaning |
| --- | --- |
| Repositories | Public source repos in the current manifest. The submission repo is excluded. |
| Tracked files | Entries in each saved Git tree, including images, data, and links to files. |
| Source-file lines | Physical lines in files with a listed programming, markup, or style suffix. Includes tests, comments, blank lines, and generated code. |
| All text lines | Physical lines in UTF-8 text without null bytes, including docs, logs, lockfiles, and fixtures. |
| Source commits | All commits leading to each saved source version, including merge commits. Full history is required. |

A physical line ends at a newline character. A final line without a newline still counts. Empty files have zero lines. Links to files are counted separately and never followed. Binary files and text in other encodings are excluded from line counts.

The exact suffix list and each repo's file, byte, line, and commit counts are in [sources.json](../../sources.json). Source-file lines are a subset of all text lines. We do not parse languages to separate code from comments. We do not remove duplicate content or generated files. This is not a count of unique, hand-written code.

Commit totals are summed per repository. Shared history can count more than once across repos. Only commits reachable from the saved version count; later commits, unrelated branches, and local edits do not. These are all-history counts, not hackathon-only counts. No author or contributor count is inferred from names or email addresses.

## What the counts prove

They show the size of the public collection. They do not measure effort, usefulness, test coverage, or quality. They do not show that all code was first written during the event. [Eligibility still needs review](EVIDENCE.md#code-history).

The submission repo adds snapshot and presentation commits, and now imports unchanged original source commits as merge parents. [Contributor credit](CONTRIBUTORS.md) explains author preservation and GitHub account matching. Private repositories and checkpoint contents are excluded.

## Refresh and reproduce

The normal [sync command](SYNC.md) refreshes these counts automatically, using each fetched source tree and its complete commit history. It never edits copied project files to add metrics. Failed or shallow history must not produce a misleading partial commit count.

The initial count addition uses the source commits already in the collection; it does not advance those versions. Original file trees remain unchanged.

To check a source commit count in a full clone:

```sh
git rev-list --count <source-commit-from-sources.json>
```

The generator is [scripts/sync_submission.py](../../scripts/sync_submission.py). The [offline tests](../../tests/test_sync_submission.py) check pinned history, shallow-history rejection, line endings, blank files, binary files, tests, and links to files.
