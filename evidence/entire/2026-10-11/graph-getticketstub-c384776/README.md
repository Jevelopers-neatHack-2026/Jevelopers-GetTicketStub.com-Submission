# entire-graph snapshot: getticketstub.com @ `c384776`

This is real entire-graph output, generated on a GitHub-hosted runner. No agent session or developer machine was involved.

| Field | Value |
| --- | --- |
| Repository | `gh/Jevelopers-neatHack-2026/getticketstub.com` |
| Commit / tree | `c384776771eaa6b64beba99607007b5b9d47066d` / `350e3fe088ca1d6668d3d7f3ba41096317edea04` (main after getticketstub.com#40) |
| Workflow run | [Entire graph #38166575087](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/actions/runs/38166575087) (`workflow_dispatch`, success) |
| Tooling | Entire CLI `v0.11.4` (checksum-verified release binary), plugin `entire-graph` `v0.4.0` |
| Snapshot | `entire graph snapshot --repo . --format compact-ndjson`: 24,564 records. These are 331 files, 4,758 symbols, 12,849 relations, 6,288 `d` records and 336 `x` records, plus one header (`h`) and one `m` record. |
| Agent instructions | `init-agents` output in getticketstub.com#44 |

Files are copied unchanged from the run artifact `entire-graph-c384776771eaa6b64beba99607007b5b9d47066d`. That artifact expires after 90 days; this copy keeps the evidence. `SHA256SUMS` was produced by the run.

```sh
shasum -a 256 -c SHA256SUMS    # all four files: OK
head -1 graph-snapshot.ndjson  # header: provider entire-graph v0.4.0, repo_key and commit above
```

Its only path is the runner checkout (`/home/runner/work/...`). The repository is public, so the snapshot exposes nothing beyond the public source.
