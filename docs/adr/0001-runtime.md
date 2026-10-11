# ADR 0001: Application runtime

- Status: accepted for the hackathon build; owner approval (Lars, implementation owner; Tim reviews) is not recorded by this file.
- Issue: GT-01 (#7). Consumers: team-dashboard TD-01, landing-page LP-01.
- Date: 2026-10-10

## Decision

The application is one Next.js 16.4.0 App Router app (`src/app`), React and React DOM 19.3.0, TypeScript, served by `next start` as a Node server. It is the composition root: customer pages, the HTTP API under `src/app/api`, the landing page at `/`, and the team-dashboard mount at `/admin`.

Alternatives considered:

| Option | Why not |
|---|---|
| Static export (Next or Vite) plus a separate API service | The studio needs server routes (accounts, shares, orders, signed context tokens) and server-gated `/admin`. Two deployables means two origins, CORS and cookie problems, and an assembly cycle with the dashboard. |
| A second framework for the landing page (static site at `/`) | The landing page's hero must sit above our `<StudioStart />` and print in place, which is one React tree. Serving a separate artifact at `/` is still possible later (see routes.md) but not needed now. |
| Vite SPA for the studio | No server rendering for share pages, no server-side access gate for `/admin` (a client-only gate would leak existence). |
| Remix / SvelteKit | Already built on Next (PR #5); a rewrite buys nothing for the criteria and risks the deadline. |
| Next with Cache Components | Stubs live in the browser and routes render on request; prerendering adds nothing yet (`next.config.ts`). |

## Pins

- Node `24.18.0` (`.nvmrc`; `engines.node` `>=24.18.0 <25`) and npm `11.16.0` (`packageManager`; `engines.npm` `>=11.16.0 <12`). The database is `node:sqlite`, which needs a recent Node.
- `next` `16.4.0`, `react` and `react-dom` `19.3.0`, `eslint-config-next` `16.4.0`: exact versions in `package.json`, resolved in `package-lock.json`. Install with `npm ci`; CI (`.github/workflows/runtime.yml`) does.
- The dashboard package must declare React 19.3.x and Next 16.4.x as peers, not bundle them (routes.md, "Admin mount contract").
- Next 16 has breaking changes against older docs; read `node_modules/next/dist/docs/` before using an API (see `AGENTS.md`). Example: error boundaries receive `retry`, not only `reset`.

## Demo and live modes

`TICKETSTUB_RUNTIME_MODE` is read at build and at start, and must be set consistently.

- Anything other than `live` is a **demo preview**: demo research fixtures only, no provider or Ticketmaster call, simulated art, 204 agent, sandbox checkout, sign-in links shown on screen (`TICKETSTUB_SANDBOX_MAIL`), a "Demo preview" notice. No secrets are needed.
- `live` restores the original provider paths for separately reviewed development. It is not a production recommendation: identity, budget and URL controls are tracked in #7-#13. In live mode context tokens need `CONTEXT_SECRET` or they answer 503.
- `/api/health` reports `mode` (`demo` or `live`) and a version (a git SHA from the platform, else the package version). `npm run verify:product -- --suite <name> --mode fixture --evidence-dir <dir>` runs the checks offline and writes JSON evidence.

## Deployment

- Preview: Plus Launch, per README. Repository root, `main`, Node 24.18.0, `npm ci`, `npm run build`, `npm start` (binds `0.0.0.0`, reads `PORT`). A Node server deployment, not a static export. Updating the preview and the build log are recorded in #21; a local or CI pass does not prove the platform has synchronised. Publishing to Live needs separate authorisation.
- Self-hosted (VPS): the same build and start commands behind HTTPS and a reverse proxy that sets `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Real-IP`. State is a SQLite file (`TICKETSTUB_DB`, default `./data/ticketstub.sqlite`) and a files folder (`TICKETSTUB_FILES`): one writer, one host, back both up together. SQLite means one app instance; scaling out needs a different `Storage` implementation behind the existing interface in `src/server/storage.ts`.
- Canonical origin: `https://getticketstub.com` (`APP_URL`), used for email links and as an allowed `Origin`.

## Web and worker topology

There are **no workers today**. One web process serves pages and API routes, and every request is handled inside it. The architecture kit's "one web application and one background worker" is a plan, not something this repo runs.

Specialist work belongs to other repositories and this app only consumes it through adapters (boundaries.md): research (event-intelligence), the creative engine, print production, fulfillment connectors and the cost ledger. This ADR does not assign them a process, a queue or an owner. When one of them delivers a worker, it gets its own ADR here describing how the web process hands it work and receives results; until then the demo paths are in-process fixtures.

## Consequences

- One origin, one cookie jar, one deploy; `/admin` and `/` are routes in the same app.
- The server gate (`requireStaff`) is the only thing between a visitor and `/admin`; the sidebar entry is cosmetic.
- SQLite pins the app to a single instance until storage is swapped.
- Anything not exercised by `npm run verify:product` and CI is not claimed here: no phone-gesture tests, no live provider runs, no platform deployment evidence.
