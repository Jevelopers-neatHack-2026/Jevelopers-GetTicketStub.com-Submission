# Archive: earlier versions of the getticketstub.com landing page

Snapshots of the site from before it moved into `site/`. They are kept for reference only; the live, maintained version is [`site/`](../site/).

| Folder | Date | What it is |
|---|---|---|
| [`2026-10-10-ticketstub-website/`](2026-10-10-ticketstub-website/) | Oct 10, 2026 | The first finished build (from `Ticketstub website .zip`). Five thrown scenes, original cut-outs. |
| [`2026-10-11-crystal-landing/`](2026-10-11-crystal-landing/) | Oct 11, 2026 | The "Crystal" draft that was first proposed for `landing/crystal/`, recovered from the `crystal-getticktstub.com` patch. |

Each folder is self-contained. To view one with the 3D scene, serve it over HTTP from inside the folder:

```bash
python -m http.server 8765
```

then open http://localhost:8765. Opening `index.html` straight from disk skips the 3D scene.
