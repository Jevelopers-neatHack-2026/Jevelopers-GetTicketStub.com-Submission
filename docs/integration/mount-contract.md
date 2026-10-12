# Local module / host mount contract v0.1.0

Status: executable local interface, awaiting actual-host acknowledgement. No canonical financial schema or authoritative auth implementation is defined here.

## Package exports

| Import | Output |
| --- | --- |
| `@jevelopers/team-dashboard` | `Dashboard`, shared boundaries, public read-only host/adapter/view types |
| `@jevelopers/team-dashboard/integration` | Typed route manifest, `routeHref`, `resolveRoute`, `normalizeBasePath` and host/adapter types |
| `@jevelopers/team-dashboard/server` | Server-only, React-free trusted host seam: `createDashboardAuthorizer`, `createGuardedRouteReader`, `toHostAccessProjection`, the proposed permission matrix and verifier types ([TD-07 trusted host](TD-07-trusted-host.md)) |
| `@jevelopers/team-dashboard/style.css` | Scoped module CSS and pinned first-party token subset |

ESM JS, declaration files and CSS are packed. React and React DOM remain external host peers. Package `private: true` prevents accidental public npm publication. The root JS preserves `use client`; the pure route integration entry can be used by the host without creating its own application router. No package entry mounts a React root, starts a server or fetches an endpoint. The fixture is development-only.

## Injected boundary

```tsx
'use client';
import { Dashboard } from '@jevelopers/team-dashboard';
import '@jevelopers/team-dashboard/style.css';

// Inside the existing host's authenticated admin client boundary:
<Dashboard
  basePath={agreedAdminPrefix}
  pathname={hostPathname}
  navigate={hostNavigate}
  access={hostPresentationDecision}
  provider={hostReadOnlyProvider}
  renderRoute={hostDomainRenderer}
/>
```

`pathname` is a host-controlled pathname without query/hash. The host owns query/filter state, refresh, browser history and SSR/direct-entry routing. The module intercepts only unmodified left-click navigation; modifier clicks retain native links. Route changes focus the new h1. `routeHref` encodes safe detail IDs, rejects missing/unsafe IDs and never generates cross-origin URLs. Unknown/out-of-prefix paths show a not-found boundary. Direct URL/reload success in the fixture proves the local mount only: the actual host must supply its agreed catchall/route dispatcher and repeat those tests.

`HostAccess` is a presentation projection: authorized access requires nonempty tenant/project IDs and a revision identifying the current authorization context. Missing/malformed/unknown access fails closed. Change the revision whenever permissions/session change. Server-verified revisions must be 1–256 visible ASCII characters (U+0021–U+007E), excluding Unicode line and bidi controls. None of these browser fields is a security credential. The host server must derive scope from trusted identity, authorize every read and redact fields before sending the projection. URLs cannot override the scope passed to the read port. This package supplies no identity provider or privileged command endpoint. The server entry gives the host an injected `HostSessionVerifier` seam that derives scope and grants from its own verified credential, re-authorizes every read, passes the verified finance `trustedScope` and `revision` to the host read, returns each read as `{ state, access }` and never accepts a `HostAccess` value as input. Detail-route reads must scope ids by the verified scope, and a cross-tenant id must look exactly like a nonexistent one; see [TD-07 trusted host](TD-07-trusted-host.md).

The optional `RouteProvider<T>` declares fixture/integrated mode and reads `{ route, scope, signal }`. It returns `{ state, access }`, where `state` is the discriminated loading/empty/error/restricted/unavailable/ready boundary and `access` is the projection of the server decision that served this read. The `RouteReadResult<T>` type is exported from the integration entry. Forward the guarded read envelope unchanged; a legacy bare state fails closed. A ready response requires matching tenant, project and revision against the mounted authorized projection, and the renderer receives the returned scope snapshot. Mismatches or denied projections show restricted. Missing/malformed/inherited fields and accessors fail closed without invoking getters. The scope in the browser request remains advisory; it cannot replace server-derived scope. A returned loading result is rejected as an invalid terminal result; a pending read displays loading and times out after 15 seconds. Errors expose fixed safe messages; raw exception text is not rendered or logged. Reads are aborted on route/scope/grant/provider change and unmount. Results from cancelled/stale reads cannot render. There is no persistent data cache. Host-provided adapters must respect the abort signal and must not perform mutations or silently return fixtures in integrated mode.

A ready result renders only through an explicitly injected `RouteRenderer<T>`; without one, the route stays unavailable. The renderer is trusted host UI code and must use a safe, server-redacted projection. It owns domain semantics, error handling and accessible presentation; this local extension is not a financial adapter, export engine or ledger. The included reports boundary exports no data.

## Routes

The manifest includes overview, AI costs, sales/revenue, fulfillment costs, budgets, transactions and transaction detail, events and event detail, reports and exports. All are host-relative. No fulfillment capability is asserted. A required-but-unconnected route displays unavailable rather than fabricated records or zero. The fixture's ready extension contains only nonfinancial explanatory text.

## Styles and rollback

All module selectors and token declarations are scoped under `.team-dashboard`; no reset, root variables, remote font request, global theme or document body styling is shipped. Import the CSS exactly once. The host retains document title, main/outer landmarks and theme ownership; the package supplies a labelled section inside the host layout. Multiple simultaneous dashboard mounts are not supported by this v0.1 interface because its skip target is fixed.

Adopt a reviewed package archive/revision plus exact React peers, retaining the prior host package pin. Roll back by restoring that pin and its matching stylesheet; remove the mount if necessary. No persisted data migration or ledger write occurs. Record module/archive digest, host commit, contract/producer pins and host reviewer acknowledgement before actual adoption. Actual WP02 integration remains blocked until this is accepted and exercised by the host owner.
