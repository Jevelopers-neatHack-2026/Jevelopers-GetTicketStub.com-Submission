import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const [sourceArgument, runtimeArgument, archiveArgument] = process.argv.slice(2);
const source = resolve(sourceArgument);
const runtime = resolve(runtimeArgument);
const pin = JSON.parse(readFileSync('contracts/producer-pin.json', 'utf8'));
if (process.versions.node !== pin.node_version) throw new Error('Node version mismatch');
const run = args => execFileSync('npm', args, { encoding: 'utf8', timeout: 120000 });
if (run(['--version']).trim() !== pin.package.npm_version) throw new Error('Packager mismatch');
if (existsSync(join(runtime, "node_modules"))) throw new Error("Cold install requires a fresh runtime");
mkdirSync(runtime, { recursive: true });
const pack = JSON.parse(run(['pack', '--ignore-scripts', '--json', '--pack-destination', runtime, source]))[0];
const packed = join(runtime, pack.filename);
const archive = archiveArgument ? resolve(archiveArgument) : packed;
for (const path of [packed, archive]) {
  const bytes = readFileSync(path);
  if (createHash('sha256').update(bytes).digest('hex') !== pin.package.archive_sha256 ||
      'sha512-' + createHash('sha512').update(bytes).digest('base64') !== pin.package.archive_sri) throw new Error('Archive identity mismatch');
}
run(['install', '--prefix', runtime, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
const packageRoot = join(runtime, 'node_modules/@jevelopers/shared-contracts');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'generated/package-content-manifest.json')));
if (manifest.digest !== 'sha256:' + pin.package.content_digest) throw new Error('Content digest mismatch');
const record = { path: process.execPath, sha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex') };
writeFileSync(join(runtime, 'source-runtime.json'), JSON.stringify(record));
writeFileSync(join(runtime, 'installed-runtime.json'), JSON.stringify({ ...record, installation: { root: packageRoot, archive } }));
console.log(JSON.stringify({ node: process.versions.node, npm: pin.package.npm_version, sha256: pin.package.archive_sha256, sri: pin.package.archive_sri, content_digest: manifest.digest, cold_install: true, lifecycle_scripts: false }));
