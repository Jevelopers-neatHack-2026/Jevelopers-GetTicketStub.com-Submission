import { readFile, readdir } from 'node:fs/promises';
import { resolve, posix } from 'node:path';
import { assetFiles, sourceFiles, sha256 } from './build.mjs';
export async function validateArtifact(repository, artifactDir) {
  const source = resolve(repository, 'site');
  const expected = await sourceFiles(source);
  const actual = ['index.html', ...await assetFiles(resolve(artifactDir, 'assets'))].sort();
  const top = (await readdir(artifactDir)).sort();
  if (JSON.stringify(top) !== JSON.stringify(['assets', 'index.html', 'manifest.json'])) throw new Error('Unexpected or missing artifact root file');
  const manifest = JSON.parse(await readFile(resolve(artifactDir, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'ticketstub.landing-artifact/1' || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(expected) || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Artifact inventory differs from source/manifest');
  const known = new Set(expected);
  for (const name of expected) {
    const bytes = await readFile(resolve(artifactDir, name));
    const sourceBytes = await readFile(resolve(source, name));
    const record = manifest.files[name];
    if (!bytes.equals(sourceBytes) || record.bytes !== bytes.length || record.sha256 !== sha256(bytes)) throw new Error(`Artifact hash/source mismatch: ${name}`);
    if (!/\.(?:html|css|js|mjs|gltf|json)$/.test(name)) continue;
    const text = bytes.toString('utf8');
    const urls = new Set();
    // Covers runtime assets held in JS strings as well as HTML/CSS references.
    for (const match of text.matchAll(/["'`](assets\/[^"'`\s<>]+)["'`]/g)) urls.add(match[1]);
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) urls.add(match[1]);
    for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) urls.add(match[1]);
    if (/\.(?:gltf|json)$/.test(name)) {
      const json = JSON.parse(text);
      for (const item of [...(json.buffers || []), ...(json.images || [])]) if (item.uri) urls.add(item.uri);
    }
    for (const url of urls) {
      if (url.includes('${')) continue; // Dynamic templates resolve from checked literal asset records.
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) continue;
      const path = decodeURIComponent(url).split(/[?#]/)[0];
      if (!path) continue;
      const target = path.startsWith('/') ? path.slice(1) : posix.normalize(posix.join(posix.dirname(name), path));
      if (!known.has(target)) throw new Error(`Missing local reference ${url} from ${name}`);
    }
  }
  return expected;
}
