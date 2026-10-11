"use client";
// Pinned stand-in for the team-dashboard package until it is published. It draws what a real mount receives
// (the route path, the context summary, the nav), so reload and deep links can be tested against the host.
import Link from "next/link";
import type { AdminHostBridge, AdminMountProps } from "../contract";

export const FIXTURE_REVISION = "admin-fixture/1";

export function FixtureMount({ context, nav, path, host }: AdminMountProps & { host: AdminHostBridge }) {
  const crumbs = [{ label: nav.root.label, href: nav.root.href }, ...path.map((seg, i) => ({ label: seg, href: `${nav.base}/${path.slice(0, i + 1).join("/")}` }))];
  const { summary } = context;
  return (
    <div data-admin-fixture={FIXTURE_REVISION} data-admin-path={path.join("/")} data-admin-root={nav.root.label}>
      <ol data-admin-crumbs aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <li key={c.href}>
            {i > 0 ? <span aria-hidden>› </span> : null}
            {i === crumbs.length - 1 ? <span aria-current="page">{c.label}</span> : <Link href={c.href}>{c.label}</Link>}
          </li>
        ))}
      </ol>
      <h1>Admin</h1>
      <p style={{ margin: "var(--ts-space-2) 0 var(--ts-space-4)", color: "var(--admin-ink-soft)" }}>
        Fixture mount. The team-dashboard package renders here once it is published; the route, context and nav below are what it receives.
      </p>
      <section data-admin-card aria-label="Context">
        <dl>
          <dt>Path</dt>
          <dd>
            {nav.base}/{path.join("/")}
          </dd>
          <dt>Actor</dt>
          <dd>
            {summary.actorKind}, role {summary.role}
          </dd>
          <dt>Tenant</dt>
          <dd>{summary.tenantId}</dd>
          <dt>Environment</dt>
          <dd>
            {summary.environment}, mode {summary.mode}
          </dd>
          <dt>Capabilities</dt>
          <dd>{summary.capabilities.join(", ") || "none"}</dd>
          <dt>Token</dt>
          <dd>
            {summary.schema}, {summary.verified ? "verified by the server" : "NOT verified"}, expires {summary.expiresAt}
          </dd>
        </dl>
      </section>
      <nav aria-label="Admin" style={{ marginTop: "var(--ts-space-4)", display: "flex", gap: "var(--ts-space-4)", flexWrap: "wrap" }}>
        {nav.items.map((item) => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
        <button type="button" onClick={() => host.navigate(`${nav.base}/fixture/client-navigation`)}>
          Client navigation
        </button>
      </nav>
    </div>
  );
}
