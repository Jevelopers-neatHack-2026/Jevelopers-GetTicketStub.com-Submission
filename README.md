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

### OpenRouter configuration

OpenRouter is an optional server-side route for OpenAI and Anthropic models.
[Create an account](https://openrouter.ai/) and generate a key at
[OpenRouter API keys](https://openrouter.ai/keys). Copy `.env.example` to
`.env.local` in this repository root and give each selected model a separate
OpenRouter key using the capability-specific names below. A generic
`OPENROUTER_API_KEY` is not used; a missing capability key fails instead of
borrowing another model's key.
For deployment, enter the same names in the hosting platform's **server
Environment Variables / Secrets** settings. Never use `NEXT_PUBLIC_` names or
commit `.env.local`. No direct OpenAI or Anthropic key is needed for a capability
that selects OpenRouter.

| Capability | Provider setting | Allowed values / default | OpenRouter model setting | OpenRouter key setting |
| --- | --- | --- | --- | --- |
| Page fact extraction | `TICKETSTUB_RESEARCH_PROVIDER` | `anthropic` (default), `openrouter` | `TICKETSTUB_RESEARCH_MODEL` | `TICKETSTUB_RESEARCH_OPENROUTER_API_KEY` |
| Agent chat | `TICKETSTUB_AGENT_PROVIDER` | `anthropic` (default), `openrouter` | `TICKETSTUB_AGENT_MODEL` | `TICKETSTUB_AGENT_OPENROUTER_API_KEY` |
| Artwork | `TICKETSTUB_ART_PROVIDER` | `openai` (default), `openrouter` | `TICKETSTUB_ART_MODEL` | `TICKETSTUB_ART_OPENROUTER_API_KEY` |

For reviewed development with all three capabilities using OpenRouter:

```dotenv
TICKETSTUB_RUNTIME_MODE=live
TICKETSTUB_RESEARCH_PROVIDER=openrouter
TICKETSTUB_RESEARCH_MODEL=anthropic/claude-sonnet-5.5
TICKETSTUB_AGENT_PROVIDER=openrouter
TICKETSTUB_AGENT_MODEL=openai/gpt-6.1-sol
TICKETSTUB_ART_PROVIDER=openrouter
TICKETSTUB_ART_MODEL=openai/gpt-image-2
TICKETSTUB_RESEARCH_OPENROUTER_API_KEY=<research model key>
TICKETSTUB_AGENT_OPENROUTER_API_KEY=<agent model key>
TICKETSTUB_ART_OPENROUTER_API_KEY=<image model key>
```

Keys are paired with capability settings, so research and chat can use distinct
keys even if they select the same model. When changing a model, update its paired
key as needed. Existing setups using only `OPENROUTER_API_KEY` must migrate to
the three capability-specific variables. Keys are not included in responses,
usage metadata, logs, or browser bundles.

These example IDs were listed by OpenRouter's public discovery APIs on
2026-10-11 UTC; they are not proof of account access or a paid smoke test.
Select models your account can use and review their cost. Both OpenAI and
Anthropic text models are accepted; artwork requires an OpenAI image model.
There are no implicit OpenRouter model defaults. Auto-routing and colon-suffix
variants (including `:online` and `:free`) are rejected. Provider fallback is
explicitly disabled. The app does not retry failed requests or switch to a
direct-provider key after an OpenRouter failure.

Research and chat use OpenRouter Chat Completions with final text output.
Research extracts facts from the page already fetched by the application;
it does not enable external search or client tool execution. Fact citations
still point to that page, and a fact is live only when its quoted evidence
appears in the page. Malformed or truncated responses and unexecuted tool
calls are rejected. Artwork checks the Image Models API before using the
[dedicated Image API](https://openrouter.ai/docs/guides/overview/multimodal/image-generation).
Only base64 PNG, JPEG, and WebP outputs are accepted; returned image URLs and
SVG are rejected. Image dimensions use the selected model's default; this
adapter does not certify print dimensions or supplier compatibility.

Explicit OpenRouter configuration, capability, authentication, rate-limit,
and transport failures return bounded error codes and are displayed as errors.
They do not silently generate simulated art or agent replies. The original
optional direct-provider paths retain their simulated fallback behavior.
Successful route responses include `providerMetadata` with requested and
returned model/provider identities where supplied, plus available token counts
and OpenRouter cost in USD. Missing cost is unknown, not zero. These receipts
are not an authoritative finance ledger, provider invoice reconciliation, or
complete sponsor integration.

Setting keys does not enable external calls. Keep `TICKETSTUB_RUNTIME_MODE=demo`
for preview. For reviewed live development set it consistently at build and
start, then rebuild/restart after configuration changes. Existing production
limitations above still apply, including unfinished identity, budget, and URL
controls. Do not enable this as an unattended production service.

Run `npm test` for offline adapter and route tests. They intercept all HTTP
requests and use synthetic keys. Any paid smoke test requires the existing
project budget/authorization process and sanitized evidence; no paid request
was made to implement this support.

References: [OpenRouter Chat API](https://openrouter.ai/docs/api/reference/overview)
and [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

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
