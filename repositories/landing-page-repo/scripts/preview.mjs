#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root } from './build.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.woff': 'font/woff', '.woff2': 'font/woff2', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.avif': 'image/avif', '.gif': 'image/gif' };
export function createPreview({ artifactDir = resolve(root, 'dist/site'), fixtures = new Map() } = {}) {
  return createServer(async (request, response) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET','HEAD'].includes(request.method)) return send(405, 'Method not allowed');
    let pathname;
    try { pathname = decodeURIComponent((request.url || '/').split('?')[0]); } catch { return send(400, 'Invalid path'); }
    if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '.' || part === '..')) return send(400, 'Invalid path');
    // Fixtures are injected only by local tests; no production app/auth/API simulation ships.
    if (fixtures.has(pathname)) {
      const fixture = fixtures.get(pathname);
      return send(fixture.status, fixture.body, fixture.type);
    }
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (pathname !== '/' && pathname !== '/index.html' && !/^\/assets\/[^/]/.test(pathname)) return send(404, 'Not found');
    try {
      const destination = resolve(artifactDir, name);
      const escaped = relative(await realpath(artifactDir), await realpath(destination));
      if (escaped.startsWith('..') || !(await lstat(destination)).isFile()) return send(404, 'Not found');
      send(200, await readFile(destination), types[extname(destination)] || 'application/octet-stream');
    } catch { send(404, 'Not found'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const port = args.length === 0 ? 8080 : args.length === 2 && args[0] === '--port' && /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('Usage: node scripts/preview.mjs [--port 8080]'); process.exitCode = 2; }
  else {
    try { await lstat(resolve(root, 'dist/site/index.html')); }
    catch { console.error('Missing artifact. Run node scripts/build.mjs first.'); process.exit(1); }
    const server = createPreview();
    server.on('error', error => { console.error(`Preview failed: ${error.message}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Local artifact preview: http://127.0.0.1:${port}/`));
  }
}
