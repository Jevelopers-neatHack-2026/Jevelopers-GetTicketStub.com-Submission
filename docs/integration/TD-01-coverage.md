# TD-01 local implementation coverage

This document preserves all TD-01 acceptance scope. It does not close issue #3 or certify FIN-10/DASH-01/02/03. Test results belong to revision-specific external execution artifacts.

| ID | Local deliverable and verification | External / later obligation |
| --- | --- | --- |
| TD-01.A | TypeScript/React module; Vite library; locked npm deps; pinned Node; Vitest component and Playwright suites. Clean install/static/test/build commands. | WP02 acceptance of runtime/React peers before incompatible host adoption. |
| TD-01.B | Explicit JS/types/CSS exports and peers; dev/lint/typecheck/test/build/test:e2e/test:integration scripts; required src directories and fixture directory. Build checker and real archive-consumer browser harness. | Actual host installation/compatibility proof. |
| TD-01.C | Full typed route manifest; injected base/path/navigation/auth/read port; direct-entry/reload/nested path/not-found tests; CSS and rollback contract. | Accepted production admin prefix, route ownership and actual-host direct/reload/navigation evidence. |
| TD-01.D | Loading/empty/error/restricted/unavailable boundaries on required routes; no financial values fabricated; absent auth/read port/view fails closed; timeout/cancellation/stale read tests. | Every required financial page must work before release. Domain leaves remain open; route containers are not completed views. |
| TD-01.E | Packed module mounted in offline fixture with explicit development controls and read-only extension. | Accepted actual host/auth/data interface and pinned host integration evidence. DASH-01/02/03 remain pending. |

## Validation and fixture identity

Vitest: `tests/package`, `tests/components`. Playwright: `tests/e2e/td01-routes.spec.ts`, `tests/integration/td01-mount.spec.ts`; all browser case names include TD-01. Fixture identifiers and mode are catalogued under `tests/fixtures`; they represent local boundary behavior only, not producer-approved finance fixtures. No canonical financial versions are claimed.

Commands: `npm ci`; `npm run lint`; `npm run typecheck`; `npm test -- --run`; `npm run build`; `npm pack --dry-run`; `npm run test:e2e -- --grep TD-01`; `npm run test:integration -- --grep TD-01`. Full suites run through the same declared scripts. `npm run test:host` must currently return BLOCKED/nonzero. A successful grep selecting zero cases is not acceptable; Playwright's default no-tests behavior fails.

Browser execution checks actual rendered route/state labels, keyboard focus and navigation, direct links/reload, missing/revoked auth, retries, responsive width and CSS 200% zoom, reduced motion, console/page errors and denied external HTTP egress. CSS zoom exercises doubled rendered layout; it is not a claim of native browser chrome zoom or assistive-technology certification. Full TD-10/TD-11 accessibility checks and actual-host server denial/audit evidence remain required.

## Producer blockers

WP02/GT-01 #7: accepted runtime/route/mount. GT-08 #9: trusted server identity and authorization projection. Shared-contracts #13/#12/#11: canonical finance schemas. Cost-intelligence #2 and linked leaves: tested authoritative read definitions/projections. Those producer outputs unblock integration incrementally; whole epic closure is not a prerequisite for local development.
