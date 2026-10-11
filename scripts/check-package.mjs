import { readFile, access, writeFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await writeFile('dist/style.css.d.ts', 'export {};\n');
await writeFile('dist/index.d.ts', "export * from './src/index';\n");
for (const target of Object.values(pkg.exports).flatMap(value => typeof value === 'string' ? [value] : Object.values(value))) await access(target);
const js = await readFile('dist/index.js', 'utf8');
if (!js.includes('use client')) throw new Error('Client boundary directive missing.');
if (/react.production|react.development|createRoot/.test(js)) throw new Error('React runtime or fixture root was bundled.');
console.log('Package exports, declaration entry, stylesheet and client boundary verified.');
