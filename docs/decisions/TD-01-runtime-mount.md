# TD-01 local runtime and mount decision

Status: local implementation/toolchain decision; actual package-to-host mount and integration-evals acceptance remain pending.

The local module uses TypeScript 6.0.3, React/React DOM 19.3.0, Vite 8.3.4 with plugin-react 6.1.2, Vitest 5.0.3 and Playwright 1.64.0. Node 24.15.0 and npm 11.12.1 are the measured implementation runtime. Engines constrain the supported runtime to Node 24.15+ in major 24 and npm 11.12.1+ in major 11; only the exact pinned local versions have been executed here.

Registry metadata was inspected before selecting pins. Vite/plugin-react agree on Vite major 8; Vitest accepts Vite 8 and Node 24; jsdom 30.1.2 requires Node 24.15+. TypeScript 6.0.3 stays within typescript-eslint 8.71.1's <6.1.0 peer range. ESLint 9.39.5 stays within jsx-a11y 6.10.2's supported peer range ending at 9; the registry marks ESLint 9 deprecated. This compatibility choice does not claim ongoing upstream support; upgrading the lint toolchain requires a compatible accessibility plugin and fresh checks. Dependencies remain development-only except host-supplied React peers.

## Current host evidence

The current getticketstub.com source snapshot is main `138e4b9019c0f5a55ad5e3f586d129216b680e4d`, a Next.js 16.4.0 / React 19.3.0 application. It contains a staff-gated `/admin/**` route, `ticketstub.admin-mount/1` interface, and host navigation. `AdminMount` still renders the host-owned `admin-fixture/1`; the application does not import this package. The `/admin/finance` package path remains a local proposed route until the host owners accept the mount and path.

The host also has `GET /api/context?v=2` and finance producer grants. Those source facts update the earlier source snapshot but do not establish a production connection from this package. The host must still supply and validate its session credential, membership and finance scope through a reviewed contract. GT-01 #7 and the master integration-evals checklist own that agreement and acceptance. See the host's [source-pinned current architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after the companion documentation PR merges).

## Brand source and isolation

The unchanged token values in src/styles/brand-tokens.css are a local subset of first-party [brand-kit tokens/tokens.css](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/tokens/tokens.css), commit 3822635aff507cd5918a08a0c636bb0e41705261, blob 5201162d0c05062cb909e54b2176157a74cecfd1. The selector changes from :root to .team-dashboard for isolation. The remote Google Fonts import, global theme selectors, unused decorative effects and motion tokens are excluded. No font file or third-party asset is redistributed. Installed host fonts may satisfy the brand family; native fallback works offline. This consumer subset does not certify brand-kit publication rights or full TD-10 acceptance.

## References

- [TD-01](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/3)
- [Host runtime owner](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/7)
- [Vite library mode](https://vite.dev/guide/build.html#library-mode)
- [Vitest requirements](https://vitest.dev/guide/)
- [Next client library boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components#third-party-components)
