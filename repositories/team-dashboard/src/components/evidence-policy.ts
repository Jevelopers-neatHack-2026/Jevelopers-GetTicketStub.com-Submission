export type EvidencePolicy = Readonly<{ origin: string; allowedOrigins: readonly string[]; allowedPathPrefixes: readonly string[]; allowedQueryKeys?: readonly string[] }>;
function hasControl(value: string): boolean { return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); }
function credentialKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return /token|secret|password|signature|credential|authorization|apikey|accesskey|bearer/u.test(normalized) || ['auth', 'key', 'sig', 'code', 'jwt', 'session', 'sessionid'].includes(normalized);
}
/** Defensive presentation check, not server access control or URL fetching. */
export function approvedEvidenceHref(href: string, policy: EvidencePolicy): string | undefined {
  try {
    if (!href || href !== href.trim() || hasControl(href) || href.includes('\\') || href.startsWith('//')) return;
    // Inspect before URL normalization can erase literal or encoded dot segments.
    const suppliedPath = href.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/iu, '').split(/[?#]/u)[0]!;
    if (decodeURIComponent(suppliedPath).split('/').some((segment) => segment === '.' || segment === '..')) return;
    const origin = new URL(policy.origin);
    if (origin.origin !== policy.origin || origin.username || origin.password) return;
    const url = new URL(href, origin);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === origin.origin))) return;
    if (url.origin !== origin.origin && !policy.allowedOrigins.includes(url.origin)) return;
    const decodedPath = decodeURIComponent(url.pathname);
    if (hasControl(decodedPath) || decodedPath.includes('\\') || decodedPath.includes('%') || /%2f/iu.test(url.pathname)) return;
    if (!policy.allowedPathPrefixes.some((prefix) => prefix.startsWith('/') && !prefix.includes('..') && !prefix.includes('%') && (decodedPath === prefix || decodedPath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)))) return;
    for (const key of url.searchParams.keys()) if (credentialKey(key) || !policy.allowedQueryKeys?.includes(key)) return;
    return url.origin === origin.origin ? url.pathname + url.search : url.href;
  } catch { return; }
}
