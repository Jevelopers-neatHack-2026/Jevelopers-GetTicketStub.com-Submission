import { readFile, access, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/style.css.d.ts', 'export {};\n');
await writeFile('dist/index.d.ts', "export * from './src/index';\n");
for (const target of Object.values(pkg.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))) await access(target);
const js = await readFile('dist/index.js', 'utf8');
if (!js.includes('use client')) throw new Error('Client boundary directive missing.');
if (/react.production|react.development|createRoot/.test(js)) throw new Error('React runtime or fixture root was bundled.');
console.log('Package exports, declaration entry, stylesheet and client boundary verified.');
// Walk every chunk the server entry reaches through static or dynamic imports, not only server.js itself.
const SPECIFIER = /^[ \t]*(?:import|export)\b[^;'"]*?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gmu;
const serverGraph = new Map();
const pending = ['dist/server.js'];
while (pending.length > 0) {
  const file = pending.pop();
  if (serverGraph.has(file)) continue;
  const source = await readFile(file, 'utf8');
  serverGraph.set(file, source);
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(`Server graph ${file} imports a bare module (${specifier}); the server entry must be self-contained.`);
    pending.push(posix.normalize(posix.join(posix.dirname(file), specifier)));
  }
}
for (const [file, source] of serverGraph) {
  if (/use client|from ['"]react|react-dom|createElement|jsx-runtime/.test(source)) throw new Error(`Server graph chunk ${file} must not include the client directive or React.`);
}
if (!/createDashboardAuthorizer/.test(serverGraph.get('dist/server.js'))) throw new Error('Server entry is missing the trusted host authorizer.');
console.log(`Server entry and its ${serverGraph.size - 1} imported chunk(s) are React-free and export the trusted host authorizer.`);
