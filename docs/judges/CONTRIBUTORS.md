# Original commit credit on GitHub

[Back to TicketStub](../../README.md) · [Source index](../../REPOSITORIES.md)

The sync now supports importing the original public source commits into submission `main`. Each imported commit keeps its exact ID, author, email, date, message, parents, and any signature. It does not invent coauthors or change old dates.

A new merge commit connects those histories to the submission. Its files remain the organized snapshots under `repositories/`, plus the judge guide. Old commits retain their original paths; use their commit pages for original file history. The merger receives credit for the merge, not authorship of the imported work.

Future refreshes attach new source commits. Already imported commits are not rewritten or added twice. Original source repositories remain the development homes. Only history reachable from each selected public default-branch commit is imported. Private checkpoint repositories and unrelated branches are excluded.

## GitHub display

GitHub links authors to profiles when their commit email is attached to the matching account. A missing profile link does not mean the author record was lost. The contributors graph excludes merge and empty commits and may take time to refresh. We preserve original identities rather than guessing account mappings. [GitHub's contributor rules](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors) were checked October 12, 2026.

The current file snapshots and the imported history both undergo secret scans. New findings block publication until reviewed. Original history includes older file versions; the scan does not establish hackathon eligibility.

## Published and checked October 12, 2026

[History import merge](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission/commit/442f4bcbc1c37f8d46470feee7e669b4f52620a4) connects all **1,944 original source commits** from the 14 collected repositories to submission `main`. All source tips are ancestors of the merge. All 14 copied file trees still match their source trees. The merge has 15 parents: the prior submission commit and the 14 source tips.

GitHub's contributors API now lists **CompleteDotTech, zwright8, lmvdz, and lajefahemp-collab**, alongside bot and agent account entries. [View contributors on GitHub](https://github.com/Jevelopers-neatHack-2026/Jevelopers-GetTicketStub.com-Submission/graphs/contributors).

We checked one commit for each of the 14 distinct original author-name/email pairs through GitHub's commit API. All retained their original author fields. Two pairs have no linked GitHub profile. One record named Timothy Wayne Gregg resolves to zwright8 through its recorded email. We preserved these records; we did not infer ownership or rewrite identities. [Exact checked commits and GitHub responses](CONTRIBUTOR-PROVENANCE.json) omit email addresses and record returned profile links.

All 16 sync tests pass. Snapshot and history scans passed after review of 181 historical findings and one changed current test fixture. Historical sample-token signatures matched documented public test keys. Exceptions remain tied to exact file hashes and finding locations.
