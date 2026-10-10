# getticketstub.com

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

### For judging

Until `RESEND_API_KEY` is set and the sending domain has its DNS records, start the server with `TICKETSTUB_SANDBOX_MAIL=1` (for example `TICKETSTUB_SANDBOX_MAIL=1 npm start`). Sign-in links then show on screen as an "Open the link" button instead of being emailed, so anyone can try the live site without an inbox. This works in a production build. Remove the flag once real email is on.

Sign-in is by emailed magic link only. The link opens a page ("One tap and you're in") and only the tap on its stamp uses the link up, so mail scanners that fetch links can't burn it. It works once and expires after 15 minutes, and the `ts_session` cookie (httpOnly, SameSite=Lax, Secure in production) lasts 90 days. Put the app behind HTTPS and a reverse proxy that sets `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Real-IP`.
