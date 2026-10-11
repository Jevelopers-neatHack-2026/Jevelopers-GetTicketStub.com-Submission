# TD-01 local runtime and mount decision

Status: local implementation decision; **actual WP02 agreement pending**.

The local module uses TypeScript 6.0.3, React/React DOM 19.3.0, Vite 8.3.4 with plugin-react 6.1.2, Vitest 5.0.3 and Playwright 1.64.0. Node 24.15.0 and npm 11.12.1 are the measured implementation runtime. Engines constrain the supported runtime to Node 24.15+ in major 24 and npm 11.12.1+ in major 11; only the exact pinned local versions have been executed here.

Registry metadata was inspected before selecting pins. Vite/plugin-react agree on Vite major 8; Vitest accepts Vite 8 and Node 24; jsdom 30.1.2 requires Node 24.15+. TypeScript 6.0.3 stays within typescript-eslint 8.71.1's `<6.1.0` peer range. ESLint 9.39.5 stays within jsx-a11y 6.10.2's supported peer range ending at 9; the registry marks ESLint 9 deprecated. This compatibility choice does not claim ongoing upstream support; upgrading the lint toolchain requires a compatible accessibility plugin and fresh checks. Dependencies remain development-only except host-supplied React peers.

Authoritative host evidence inspected: getticketstub.com main `5a2986454297dd6df97088a8fbde69adc771f7a0` is documentation only; open PR #5 at `e2dadb052cefd93454e85cab8558c30447496293` pins Next 16.4.0/React 19.3.0 but is unmerged and unapproved as a mount contract. GT-01 #7 owns the host runtime/route agreement. The fixture prefix `/admin/finance` is provisional. No actual admin URL, auth trust contract, finance endpoint or canonical data schema is invented here.

## Brand source and isolation

The unchanged token values in `src/styles/brand-tokens.css` are a local subset of first-party [brand-kit tokens/tokens.css](https://github.com/Jevelopers-neatHack-2026/brand-kit/blob/3822635aff507cd5918a08a0c636bb0e41705261/tokens/tokens.css), commit `3822635aff507cd5918a08a0c636bb0e41705261`, blob `5201162d0c05062cb909e54b2176157a74cecfd1`. The selector changes from `:root` to `.team-dashboard` for isolation. The remote Google Fonts import, global theme selectors, unused decorative effects and motion tokens are excluded. No font file or third-party asset is redistributed. Installed host fonts may satisfy the brand family; native fallback works offline. This consumer subset does not certify brand-kit publication rights or full TD-10 acceptance.

## References

- [TD-01](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/3)
- [Host runtime owner](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/7)
- [Vite library mode](https://vite.dev/guide/build.html#library-mode)
- [Vitest requirements](https://vitest.dev/guide/)
- [Next client library boundaries](https://nextjs.org/docs/app/getting-started/server-and-client-components#third-party-components)
