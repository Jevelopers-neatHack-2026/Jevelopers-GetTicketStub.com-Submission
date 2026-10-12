import { expect, type Page } from '@playwright/test';

/** Namespaced `history.state` key of the fixture host's private paging context (integration/fixture-host/paging-context.ts). */
export const CONTEXT_KEY = 'tdFinancePagingContext';

type StoredContext = { version: number; cursor: string; binding: Record<string, unknown> } | null;

/** The host's private paging context as stored in history.state (or null). Test-only inspection: it is not a rendered surface. */
export const contextOf = (page: Page) => page.evaluate((key) => ((window.history.state as Record<string, unknown> | null)?.[key] ?? null) as StoredContext, CONTEXT_KEY);

/**
 * The raw cursor and the host token must appear NOWHERE the user or a link can see: not in the markup (text, hrefs, aria labels, hidden fields, data attributes, any attribute),
 * not in any URL (address, referrer, resolved anchors, loaded resources) and not in web storage. Each secret is checked raw and URL-encoded as independent assertions.
 */
export async function expectPrivate(page: Page, secrets: readonly string[]) {
  const html = await page.locator('body').innerHTML();
  const surfaces = await page.evaluate(() => ({
    attributes: [...document.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`)),
    urls: [window.location.href, document.referrer, ...[...document.querySelectorAll<HTMLAnchorElement>('a[href]')].map((anchor) => anchor.href),
      ...performance.getEntriesByType('resource').map((entry) => entry.name)],
    storage: JSON.stringify({ local: { ...window.localStorage }, session: { ...window.sessionStorage } }),
  }));
  for (const secret of secrets) {
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      const label = secret.slice(0, 40);
      expect(html, `markup ${label}`).not.toContain(form);
      expect(surfaces.attributes.filter((entry) => entry.includes(form)), `attribute ${label}`).toEqual([]);
      expect(surfaces.urls.filter((entry) => entry.includes(form)), `url ${label}`).toEqual([]);
      expect(surfaces.storage, `storage ${label}`).not.toContain(form);
    }
  }
  expect(surfaces.urls.filter((entry) => /[?&#]cursor(=|&|$)/u.test(entry)), 'no cursor parameter in any URL').toEqual([]);
}

/** Rewrites the CURRENT history entry's private context (and optionally its address) and reloads, so the host restores from exactly that stored context. */
export async function reseed(page: Page, edit: { cursor?: string; binding?: Record<string, unknown>; extra?: Record<string, unknown>; replaceState?: unknown }, search?: string) {
  await page.evaluate(({ key, change, query }) => {
    const state = window.history.state as Record<string, { cursor: string; binding: Record<string, unknown> }>;
    const stored = state[key]!;
    const next = 'replaceState' in change ? change.replaceState
      : { [key]: { ...stored, ...(change.cursor !== undefined ? { cursor: change.cursor } : {}), ...(change.extra ?? {}), binding: { ...stored.binding, ...(change.binding ?? {}) } } };
    window.history.replaceState(next, '', window.location.pathname + (query ?? window.location.search));
  }, { key: CONTEXT_KEY, change: edit, query: search });
  await page.reload();
}
