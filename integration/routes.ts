export const routes = [
  { id: 'overview', path: '', label: 'Overview', navigation: true },
  { id: 'ai-costs', path: 'ai-costs', label: 'AI costs', navigation: true },
  { id: 'sales', path: 'sales', label: 'Sales and revenue', navigation: true },
  { id: 'fulfillment', path: 'fulfillment', label: 'Fulfillment costs', navigation: true },
  { id: 'budgets', path: 'budgets', label: 'Budgets', navigation: true },
  { id: 'transactions', path: 'transactions', label: 'Transactions', navigation: true },
  { id: 'transaction-detail', path: 'transactions/:id', label: 'Transaction detail', navigation: false },
  { id: 'events', path: 'events', label: 'Events', navigation: true },
  { id: 'event-detail', path: 'events/:id', label: 'Event detail', navigation: false },
  { id: 'reports', path: 'reports', label: 'Reports', navigation: true },
  { id: 'exports', path: 'reports/exports', label: 'Exports', navigation: true },
] as const;
export type RouteId = (typeof routes)[number]['id'];
export type ResolvedRoute = { id: RouteId; label: string; params: Readonly<Record<string, string>> };
export type RouteResolution = { status: 'found'; route: ResolvedRoute } | { status: 'not-found' };

export function normalizeBasePath(basePath: string): string {
  if (!basePath.startsWith('/') || hasControlCharacters(basePath) || /[?#\\\s]/u.test(basePath) || basePath.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(basePath) || basePath.includes('%')) {
    throw new Error('Dashboard basePath must be an absolute, plain host pathname.');
  }
  return basePath.replace(/\/$/u, '') || '/';
}
function hasControlCharacters(value: string): boolean { return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); }
function validId(id: string): boolean { return id.length > 0 && id !== '.' && id !== '..' && !id.includes('/') && !id.includes('\\') && !hasControlCharacters(id); }
export function routeHref(basePath: string, id: RouteId, params: Readonly<Record<string, string>> = {}): string {
  const base = normalizeBasePath(basePath);
  const route = routes.find((item) => item.id === id);
  if (!route) throw new Error('Unknown dashboard route.');
  const path = route.path.replace(':id', () => {
    if (!params.id || !validId(params.id)) throw new Error('A safe record identifier is required.');
    return encodeURIComponent(params.id);
  });
  return `${base === '/' ? '' : base}/${path}`.replace(/\/$/u, '') || '/';
}
export function resolveRoute(basePath: string, pathname: string): RouteResolution {
  const base = normalizeBasePath(basePath);
  if (!pathname.startsWith('/') || /[?#\\]/u.test(pathname) || hasControlCharacters(pathname) || pathname.includes('//')) return { status: 'not-found' };
  const path = pathname.replace(/\/$/u, '') || '/';
  if (base !== '/' && path !== base && !path.startsWith(`${base}/`)) return { status: 'not-found' };
  const relative = base === '/' ? path.slice(1) : path.slice(base.length).replace(/^\//u, '');
  for (const entry of routes) {
    if (entry.path === relative) return { status: 'found', route: { id: entry.id, label: entry.label, params: {} } };
    if (entry.path.endsWith('/:id')) {
      const prefix = entry.path.slice(0, -3);
      if (relative.startsWith(prefix)) {
        const rawId = relative.slice(prefix.length);
        try {
          const id = decodeURIComponent(rawId);
          if (validId(id)) return { status: 'found', route: { id: entry.id, label: entry.label, params: { id } } };
        } catch { /* Malformed encoded identifiers are not dashboard routes. */ }
      }
    }
  }
  return { status: 'not-found' };
}
