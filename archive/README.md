# Archive: earlier versions of the getticketstub.com landing page

Snapshots of the site from before it moved into `site/`. They are kept for reference only; the maintained source is [`site/`](../site/README.md). Historical claims about a live page, paths, libraries or completion describe the original snapshot and are not evidence of the current deployment.

| Folder | Date | What it is |
|---|---|---|
| [`2026-10-10-ticketstub-website/`](2026-10-10-ticketstub-website/) | Oct 10, 2026 | The first finished build (from `Ticketstub website .zip`). Five thrown scenes, original cut-outs. |
| [`2026-10-11-crystal-landing/`](2026-10-11-crystal-landing/) | Oct 11, 2026 | The "Crystal" draft that was first proposed for `landing/crystal/`, recovered from the `crystal-getticktstub.com` patch. |
| [`2026-10-11-claude-artifact/`](2026-10-11-claude-artifact/) | Oct 11, 2026 | The version published as a Claude artifact ([link](https://claude.ai/artifact/LPQUiDHBDcT5wBEuBXNqY3)), with the build sources in `src/`: the Blender script that made the 3D stub and flight data, the GLB converter, the screenshot harness and the review brief. |

Each folder retains its original source and assets. To view one with the 3D scene, enter that snapshot's current directory under `archive/` and serve it over HTTP; old README commands may name its former location:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/`. Opening `index.html` straight from disk skips the 3D scene. Snapshot scripts may still need their original external CDN/font services; those responses and archival public links have not been revalidated as a current release.
