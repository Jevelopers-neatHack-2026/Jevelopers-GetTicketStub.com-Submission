import { describe, expect, it } from 'vitest';
import { normalizeBasePath, resolveRoute, routeHref, routes } from '../../integration';
describe('TD-01 route contract', () => {
  for (const base of ['/admin/finance', '/', '/alternate/team/']) for (const entry of routes) {
    it(`round trips ${entry.id} under ${base}`, () => {
      const href = routeHref(base, entry.id, { id: 'record 01' });
      expect(resolveRoute(base, href)).toMatchObject({ status: 'found', route: { id: entry.id } });
      expect(resolveRoute(base, href === '/' ? href : href + '/')).toMatchObject({ status: 'found', route: { id: entry.id } });
    });
  }
  it.each(['/admin/finances', '/admin/finance/missing', '/admin/finance/transactions/a/b', '/admin/finance/transactions/%2f', '/admin/finance/events/%00', '/admin/finance/events/%zz', '/admin/finance/events/..', '/admin/finance?scope=other'])('rejects unknown or unsafe route %s', (path) => expect(resolveRoute('/admin/finance', path)).toEqual({ status: 'not-found' }));
  it.each(['https://example.com', '//admin', '/admin/../finance', '/admin?x=1', '/admin\\finance', '/%2e%2e', '/admin finance', '/admin' + String.fromCharCode(0)])('rejects unsafe base %s', (base) => expect(() => normalizeBasePath(base)).toThrow());
  it('requires safe detail identifiers', () => { expect(() => routeHref('/', 'event-detail')).toThrow(); expect(() => routeHref('/', 'event-detail', { id: '../bad' })).toThrow(); });
});
