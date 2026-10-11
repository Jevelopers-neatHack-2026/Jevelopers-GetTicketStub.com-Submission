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
