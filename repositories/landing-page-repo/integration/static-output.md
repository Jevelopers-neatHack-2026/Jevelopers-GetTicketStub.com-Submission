# Static artifact handoff proposal (LP-01.C)

Contract identifier: `ticketstub.landing-artifact/1`. This is a local proposal, not an owner-approved application integration. Source inspected: landing `1d8379d1c5b0cb89ef869ea2cc7358886c9cf274`; host `388005240aa62374d49f709afc300adb5e98cd98`, [route inventory](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/388005240aa62374d49f709afc300adb5e98cd98/docs/architecture/routes.md). App implementation owner recorded in GT-01 is @lmvdz; affected reviewer roles are application technical lead and Product and frontend. No new approval receipt is recorded by this document.

## Artifact and URL rules

`node scripts/build.mjs` clears/rebuilds `dist/site/`, containing only byte-identical `index.html`, recursively copied reviewed asset file types from `site/assets/`, and `manifest.json`. The manifest records byte length and SHA-256 for each payload file in stable path order; it has no timestamps or absolute checkout paths. The manifest's own SHA-256 is the artifact inventory identity; retain it with the source commit and Node version in a review/release receipt. No docs, readmes, archive, markdown handoffs, zip, `.git` or tooling are copied. Symlink/hidden asset entries and unexpected asset types fail the build. These checks do not approve asset rights or guarantee that every permitted binary/JSON file is free of private data; LP-04/EVAL-04 review remains required.

The local artifact mounts at `/`, and existing relative `assets/...` references resolve to `/assets/...`. It is not a subpath export: nested base paths would change URL resolution. There is no HTML rewrite or source replacement in this build. `manifest.json` is handoff metadata and is not served by the preview.

**Unresolved host compatibility:** the host proposes assets under `public/landing/` (URLs `/landing/...`) and prefers a hero React component above `StudioStart`. This standalone artifact currently uses `/assets/...` and contains its own intake. Do not copy it over the host's root page or public directory as-is. The owners must choose source-component integration or a static-only adapter; agree asset URL rewrite/mount, intake ownership, script/style isolation, CSP/CDN allowances and rebuild/rollback; then pin both revisions and perform real host tests. No app files are changed here.

## Route isolation and error behavior

The preview binds to `127.0.0.1`, serving `/`, `/index.html`, and files below `/assets/` only. It serves correct local content types with `Cache-Control: no-store`, supports GET/HEAD, rejects malformed/traversal paths, returns 405 for other methods and 404 for unknown/public/app paths. There is no SPA fallback and no directory listing. It is a development preview, not a production hosting implementation.

The host retains all its existing route precedence, including `/make`, `/new`, `/studio/[id]`, `/wall`, commerce/share/organizer/account routes, `/admin/**`, `/api/**`, `/signin/**`, `/claim/**`, `/_next/**`, `/brand/**`, `/privacy`, `/terms`, and the `/map` → `/help` redirect. Unknown routes and error boundaries remain host-owned. No catch-all rewrite to this landing document is proposed.

Foundation HTTP tests load `/` and every existing asset, reject unknown routes, and inject synthetic response sentinels for `/make`, `/signin/confirm`, `/api/health` to verify that host-like handlers have precedence. Those route names come from actual host source; the sentinels are not host/app-owner fixtures. Tests do not run the Next application, exercise auth/API behavior or prove production route isolation. Owner-supplied fixtures and actual-host smoke are required to satisfy LP-01.C.

## Updates, cache and rollback

1. Pin the landing source commit and Node version; clean-build and run the applicable required suites. Keep `manifest.json` and its SHA-256 alongside evidence outside the public site.
2. Compare manifests to identify changes; review content and asset approval, and coordinate any path/route/cache change with the host owner.
3. After approval, the host owner selects the adapter/serving behavior and atomically switches a complete, pinned release. Do not merge files from unrelated versions.
4. As assets keep stable filenames rather than content hashes, proposed production cache behavior is revalidation (`Cache-Control: no-cache`) for HTML and assets; do not grant immutable caching to these names. Actual headers remain a host decision.
5. Roll back by restoring the prior complete artifact plus its host adapter/source revision and revalidating its manifest and routes. Keep the previous bytes and digest; a branch name alone is insufficient. No publication, provider work or rollback deployment is executed by this PR.

App-owner approval, product approval, browser screenshots, exact host adapter, accepted `/landing` asset handling and real app/auth/API smoke remain unresolved. Foundation success changes none of the central acceptance states.
