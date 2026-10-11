# getticketstub.com

## Running the preview application

The existing Next.js App Router studio from PR #5 is the runtime for the
deployment fix (#21). Its routes and brand assets are preserved. This is a
hackathon prototype; integrating it does not complete #7, #1, or the product
release criteria. PR #20 remains a separate stacked implementation.

Use Node **24.18.0** (see `.nvmrc`) and npm **11.16.0**. Next.js 16.4.0 and
React/React DOM 19.3.0 are pinned in the root manifest and lockfile.

```sh
npm ci
npm run lint
npm run typecheck
npm run build
npm start
```

Development uses `npm run dev`. The production entry point is Next.js serving
`src/app` from the compiled `.next` directory. `npm start` binds to `0.0.0.0`
and reads the hosting platform's `PORT` environment variable (default: 3000).
The build must finish before starting. Install dev dependencies during the
build because TypeScript and ESLint are build tooling; do not use
`npm ci --omit=dev` before building. Google Fonts are downloaded during build,
so the build environment needs outbound access to Google Fonts and npm.

### Plus Launch configuration

Configure the repository root as the working directory, `main` as the source,
Node 24.18.0, install command `npm ci`, build command `npm run build`, and start
command `npm start`. This is a Node server deployment, not a static export.
Keep `.next`, `public`, and installed runtime dependencies available to the
start process. No application secrets or environment variables are required
for the demo preview; the platform supplies `PORT`.

After the PR is merged, select **Update Preview** to pull the merged `main`
revision, then **Retry build**. Verify the build log and preview home page,
demo intake, studio and wall. Record the deployed commit and successful build
evidence in #21. Publishing to Live requires separate authorization. A local
or GitHub Actions pass does not establish that Plus Launch has synchronized.

### Runtime mode and limitations

By default, the preview uses demo research fixtures and simulated art/agent
responses, even if provider keys happen to be configured. Arbitrary event URL
fetching is disabled. The visible banner identifies demo mode. Try the home
page's neatHack, The Pale Hours, or Harbour FC shortcuts. Checkout remains
sandbox; sign-in, wallet passes, and QR codes remain simulated. Stubs remain
in browser storage and share links carry their payload; do not use private
customer data in this prototype.

`TICKETSTUB_RUNTIME_MODE=live` (set consistently at build and start) restores the original prototype's external
research/provider paths. This is for separately reviewed, authorized development
only: the original routes lack the production identity, budget and URL access
controls tracked in #7–#13. It is not a production deployment recommendation.
The optional server-only `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` enable original
provider paths in that mode; setting keys alone never enables them in demo mode.
No live provider calls were made to validate this deployment fix.

With the production server running, run the deployment smoke checks:

```sh
# Set SMOKE_BASE_URL when the server uses a non-default PORT.
npm run smoke:production
```

The GitHub Actions runtime workflow installs, lints, typechecks, builds, and
checks production routes, built assets and demo APIs using a non-default port.
It does not verify phone gestures, upstream integration, or platform deployment.

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.

## Project integration index

- [Versioned architecture-kit entry point](docs/architecture-kit/v1.0/README.md)
- [Verified repository inventory](integration/repository-map.json)
- [Distribution map](docs/architecture-kit-distribution.json)
- [Contributor responsibilities](docs/architecture/OWNERSHIP.md)
- [Implementation plan](docs/planning/implementation-plan.md)
- [Testing plan and acceptance tracking](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md)
- [Submission evidence](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/evidence/README.md)

The immutable v1.0 snapshot preserves original planning claims and checksum-valid files. Maintained ownership documents, contract catalog and checklist supersede snapshot copies for ongoing work.

[Architecture-kit deployment report](docs/architecture-kit-deployment-report.md) records the inventory, commits, PRs, validation and remaining publication requirements.

## Running it

```
npm install
npm run build && npm start      # production, http://localhost:3000
npm run dev                     # development
```

Node 22.13 or newer (the database is `node:sqlite`; it may print an experimental warning). Set the variables below in the environment or in `.env.local`; every one is optional, and the app works without any of them.

| Variable | What it does |
|---|---|
| `APP_URL` | The public origin, e.g. `https://getticketstub.com`. Used for links in emails and as an allowed `Origin` for POST/PUT requests. Without it, the request's own host is used. |
| `RESEND_API_KEY` | Sends sign-in links and receipts through Resend. Without it nothing is emailed: the server logs the sign-in link and `POST /api/auth/link` returns `devLink` for the sandbox "Open the link" button. In production with no key and no `TICKETSTUB_SANDBOX_MAIL=1`, sign-in answers 503 rather than pretend. |
| `MAIL_FROM` | The sender. Default `TicketStub <hello@getticketstub.com>`. The domain must be verified in Resend. |
| `TICKETSTUB_DB` | SQLite file. Default `./data/ticketstub.sqlite` (the folder is created, and `/data` is git-ignored). Back this file up; it holds accounts, walls, orders, shares and events. |
| `TICKETSTUB_FILES` | Folder for stub art. Embedded images (PNG, JPEG, WebP, up to 6 MB each) are moved out of the database into content-hashed files here and served from `/api/files/<hash>.<ext>`. Default `./data/files` (git-ignored). Back it up with the database. |
| `TICKETSTUB_SANDBOX_MAIL` | Set to `1` to return `devLink` (and log the link) when there is no mail key, even in production. Never leave it on once Resend is set up. |
| `TICKETMASTER_API_KEY` | Event lookup through the Ticketmaster Discovery API in `/api/research`. |
| `OPENAI_API_KEY` and the other OpenAI variables | Ticket reading and art generation. Without them the studio falls back to simulated results. Art generation is capped at 10 a day per account, 10 per device (an httpOnly `ts_device` cookie) and 30 per IP, counted in the SQLite `art_usage` table. Over the cap, `/api/art` answers 429 `art_limit` with `retryAt`, and the editor falls back to procedural art. Sign-in and email change refuse disposable email domains (the bundled list is `src/server/disposable.ts`). |
| `SESSION_SECRET` | Not used. Session and sign-in tokens are random and stored only as SHA-256 hashes, so there is no secret to configure. |

### Plus Launch persistence

The app keeps accounts, walls, orders and shares in one SQLite file, and art in a folder. A host may have no disk that survives a deploy, or none that can be written at all. So on first use the server tries both paths: it makes the folders, writes a file, and writes and reads a scratch table. It logs one line saying what it found and never crashes over it.

- **Writable, with a persistent volume.** Set `TICKETSTUB_DB` and `TICKETSTUB_FILES` to paths on that volume. The startup line says `persistence configured`, and `/api/health` reports `"persistence": "configured"`.
- **Writable, no volume.** Leave them unset and the defaults under `./data` work, but the data resets on each deploy. The startup line and `/api/health` (`"persistence": "default-path"`) say so. It is fine for a preview and wrong for anything people rely on.
- **Not writable.** The server runs device-only. `/api/health` reports `"storage": "unavailable"`, every route that needs storage answers 503 `storage_unavailable` ("Saving is off on this preview."), art falls back to procedural with no OpenAI call, and the app hides sign-in and shows "Saving off · this device only". Stubs, shares (as encoded links) and sandbox orders keep working on the device. `npm run verify:product -- --suite degraded --mode fixture --evidence-dir out/evidence` proves this against a build.

### Verifying it (`verify:product`)

```
npm run build
npm run verify:product -- --suite foundation --mode fixture --evidence-dir out/evidence
```

| Suite | What it runs |
|---|---|
| `foundation` | route smoke for every page under `src/app`, the unknown-route 404, the error boundary, `/api/health`, and `/admin/x/y` entry and reload as staff, non-staff and anonymous |
| `access` | `scripts/smoke-server.mjs` against a production server (the one dev-only email-preview check is excluded by name and recorded in the evidence) |
| `research` | `scripts/smoke-ticketmaster.mjs` on the saved Discovery sample |
| `creative` | `scripts/check-creative-adapter.mjs` |
| `production` | `scripts/smoke-production.mjs` against a production server |
| `degraded` | a production server whose `TICKETSTUB_DB` and `TICKETSTUB_FILES` sit under a file, so storage can't be written: the 503s, the health fields, every page rendering 200, and `smoke:production` still passing |

`--mode fixture` is the only mode: the run starts its own production server on a free port with a throwaway database, no provider or mail keys, and `ADMIN_EMAILS` set to a test address, and it blocks every outbound host except loopback (`scripts/lib/fixture-network-guard.mjs`; a blocked attempt fails the run even if the code swallowed it). An unknown suite, a missing build or fixture, and any skipped check exit nonzero. Each run writes `<evidence-dir>/<suite>-<timestamp>.json` with the command, exit code, counts, timestamps, git SHA, mode and per-step results. `npm run build` must have run first. See `docs/architecture/routes.md` for the route and state map and `docs/adr/0001-runtime.md` for the runtime decision.

### For judging

Until `RESEND_API_KEY` is set and the sending domain has its DNS records, start the server with `TICKETSTUB_SANDBOX_MAIL=1` (for example `TICKETSTUB_SANDBOX_MAIL=1 npm start`). Sign-in links then show on screen as an "Open the link" button instead of being emailed, so anyone can try the live site without an inbox. This works in a production build. Remove the flag once real email is on.

Sign-in is by emailed magic link only. The link opens a page ("One tap and you're in") and only the tap on its stamp uses the link up, so mail scanners that fetch links can't burn it. It works once and expires after 15 minutes, and the `ts_session` cookie (httpOnly, SameSite=Lax, Secure in production) lasts 90 days. Put the app behind HTTPS and a reverse proxy that sets `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Real-IP`.
