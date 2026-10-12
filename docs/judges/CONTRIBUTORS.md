# Original commit credit on GitHub

[Back to TicketStub](../../README.md) · [Source index](../../REPOSITORIES.md)

The sync now supports importing the original public source commits into submission `main`. Each imported commit keeps its exact ID, author, email, date, message, parents, and any signature. It does not invent coauthors or change old dates.

A new merge commit connects those histories to the submission. Its files remain the organized snapshots under `repositories/`, plus the judge guide. Old commits retain their original paths; use their commit pages for original file history. The merger receives credit for the merge, not authorship of the imported work.

Future refreshes attach new source commits. Already imported commits are not rewritten or added twice. Original source repositories remain the development homes. Only history reachable from each selected public default-branch commit is imported. Private checkpoint repositories and unrelated branches are excluded.

## GitHub display

GitHub links authors to profiles when their commit email is attached to the matching account. A missing profile link does not mean the author record was lost. The contributors graph excludes merge and empty commits and may take time to refresh. We preserve original identities rather than guessing account mappings. [GitHub's contributor rules](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors) were checked October 12, 2026.

The current file snapshots and the imported history both undergo secret scans. New findings block publication until reviewed. Original history includes older file versions; the scan does not establish hackathon eligibility.

**Rollout status:** implemented locally; all 16 sync tests pass. The first import is waiting for enough local disk space and successful historical secret review. Original histories have not yet been published into submission `main`.
