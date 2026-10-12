import { readFile, writeFile, mkdir, mkdtemp, rm, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { root } from './generate.mjs';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';

const output = process.argv.length === 4 && process.argv[2] === '--output' ? process.argv[3] : null;
if (process.argv.length > 2 && !output) throw new Error('isolated-check [--output PATH]');
const source = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
if (source.status !== 0) throw new Error('Cannot enumerate candidate files');
const temporary = await mkdtemp(join(tmpdir(), 'shared-contracts-isolated-'));
const env = { PATH: process.env.PATH, HOME: process.env.HOME, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const checks = [], original = new Map();
let result;
try {
  for (const path of [...new Set(source.stdout.split('\0').filter(Boolean))]) {
    const target = join(temporary, path);
    await mkdir(dirname(target), { recursive: true });
    await cp(root + path, target);
    original.set(path, hashBytes(await readFile(target)));
  }
  for (const args of [['ci'], ['run', 'build'], ['test'], ['run', 'contracts:check'], ['run', 'contracts:fixtures'], ['run', 'contracts:compat'], ['run', 'docs:check'], ['run', 'generate', '--', '--check'], ['run', 'test:installed'], ['pack', '--dry-run', '--json']]) {
    const command = 'npm ' + args.join(' ');
    const run = spawnSync('npm', args, { cwd: temporary, encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024, env });
    let evidence = run.stdout.trim();
    if (args[0] === 'test') evidence = run.stdout.split('\n').filter(line => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(line)).join('\n');
    if (args[0] === 'pack' && run.status === 0) { const archive = JSON.parse(run.stdout)[0]; evidence = { filename: archive.filename, integrity: archive.integrity, files: archive.files.length }; }
    checks.push({ command, exit_code: run.status, evidence, stderr: run.stderr.trim() });
    if (run.status !== 0) break;
  }
  const drift = [];
  for (const [path, digest] of original) if (hashBytes(await readFile(join(temporary, path))) !== digest) drift.push(path);
  result = { status: checks.every(check => check.exit_code === 0) && drift.length === 0 ? 'passed_isolated_candidate_snapshot' : 'failed', source_kind: 'exact_current_working_files_without_git_metadata', candidate_source_digest: hashManifest(Object.fromEntries(original)), git_commit_acceptance: 'not_claimed_supervisor_checkpoint_required', runtime: process.version, dependency_mode: 'locked_prewarmed_offline', provider_calls: 0, candidate_files: original.size, checks, source_drift: drift };
  if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, checks: checks.length, candidate_files: original.size, source_drift: drift }));
  if (result.status === 'failed') process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
