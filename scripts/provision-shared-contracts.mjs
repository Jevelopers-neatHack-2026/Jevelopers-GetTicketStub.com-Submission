#!/usr/bin/env node
// Clones shared-contracts at the pinned head, builds and packs it, verifies the archive
// against contracts/shared-contracts.pin.json (fail closed), then installs it offline
// into the gitignored .shared-contracts/ prefix. Nothing produced here is committed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pin = JSON.parse(readFileSync(join(root, 'contracts/shared-contracts.pin.json'), 'utf8'));
const work = join(root, '.shared-contracts');
// Producer toolchain: SHARED_CONTRACTS_NODE_BIN (a bin directory) if set, otherwise whatever `node` is first on PATH.
// Either way the exact pinned version is asserted below; no machine-specific default exists.
const nodeBin = process.env.SHARED_CONTRACTS_NODE_BIN;
const installedPackage = join(root, 'node_modules/@jevelopers/shared-contracts');
const dropInstalled = () => rmSync(installedPackage, { recursive: true, force: true });
// Never leave a previously installed, now-unverified package behind: remove it first and on every failure path.
dropInstalled();
const fail = (message) => { dropInstalled(); console.error('PROVISION_FAILED: ' + message); process.exit(1); };
process.on('uncaughtException', (error) => fail('unexpected error: ' + (error && error.code ? error.code : error?.message ?? 'unknown')));
// Minimal environment for the clone, the producer's `npm ci`/build and the install: no inherited tokens or secrets.
const env = { PATH: nodeBin ? nodeBin + ':' + process.env.PATH : process.env.PATH, HOME: process.env.HOME ?? '', ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
  GIT_TERMINAL_PROMPT: '0', npm_config_fund: 'false', npm_config_audit: 'false', npm_config_update_notifier: 'false' };
const run = (cwd, cmd, args, extra = {}) => execFileSync(cmd, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const nodeCmd = nodeBin ? join(nodeBin, 'node') : 'node';
let nodeVersion = 'unavailable';
try { nodeVersion = run(root, nodeCmd, ['--version']).trim(); } catch { /* reported below */ }
if (nodeVersion !== 'v' + pin.producer_toolchain_node) fail('producer toolchain must be Node ' + pin.producer_toolchain_node + ', got ' + nodeVersion + '; put that Node first on PATH or set SHARED_CONTRACTS_NODE_BIN to its bin directory');

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const src = join(work, 'src');
run(work, 'git', ['clone', '--quiet', pin.repository, src]);
run(src, 'git', ['checkout', '--quiet', '--detach', pin.head]);
if (run(src, 'git', ['rev-parse', 'HEAD']).trim() !== pin.head) fail('head mismatch');
if (run(src, 'git', ['rev-parse', 'HEAD^{tree}']).trim() !== pin.tree) fail('tree mismatch');
const npmCli = nodeBin ? join(nodeBin, 'npm') : 'npm';
run(src, npmCli, ['ci']);
run(src, npmCli, ['run', 'build']);
const packed = run(src, npmCli, ['pack', '--pack-destination', work]).trim().split('\n').pop();
const archive = join(work, packed);
const bytes = readFileSync(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const sri = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
if (sha256 !== pin.archive_sha256) { rmSync(archive); fail('archive sha256 mismatch: ' + sha256); }
if (sri !== pin.package_integrity) { rmSync(archive); fail('archive SRI mismatch: ' + sri); }
console.log('archive verified', sha256, sri);

// Offline install of the verified archive into a private prefix (not the repo's package.json).
const prefix = join(work, 'install');
mkdirSync(prefix, { recursive: true });
writeFileSync(join(prefix, 'package.json'), JSON.stringify({ name: 'td01b-contract-consumer', private: true, type: 'module' }));
run(prefix, npmCli, ['install', '--offline', '--no-package-lock', '--ignore-scripts', archive]);
const installed = JSON.parse(readFileSync(join(prefix, 'node_modules/@jevelopers/shared-contracts/package.json'), 'utf8'));
if (installed.version !== pin.version) fail('installed version mismatch');
// Expose to the repo as a resolvable node_modules entry without touching package.json/lock.
const link = join(root, 'node_modules/@jevelopers');
mkdirSync(link, { recursive: true });
run(root, 'cp', ['-R', join(prefix, 'node_modules/@jevelopers/shared-contracts'), join(link, 'shared-contracts')]);
console.log('installed', installed.name + '@' + installed.version, readdirSync(link).join(','));
