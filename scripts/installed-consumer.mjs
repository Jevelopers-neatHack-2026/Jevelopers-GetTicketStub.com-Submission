import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './generate.mjs';
import { hashBytes } from '../tooling/runtime.mjs';

const directory = await mkdtemp(join(tmpdir(), 'shared-contracts-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_offline: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
  if (result.status !== 0) throw new Error('Installed-consumer command failed: ' + command + '\n' + result.stderr + result.stdout);
  return result.stdout;
}
try {
  const first = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], root))[0];
  const digest = hashBytes(await readFile(join(directory, first.filename)));
  const second = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', directory], root))[0];
  if (hashBytes(await readFile(join(directory, second.filename))) !== digest) throw new Error('Archive bytes are not reproducible');
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, first.filename)], directory);
  await cp(root + 'examples/consumer.mjs', join(directory, 'consumer.mjs'));
  console.log(run(process.execPath, ['consumer.mjs'], directory).trim());
  await cp(root + 'examples/operations-consumer.mjs', join(directory, 'operations-consumer.mjs'));
  console.log(run(process.execPath, ['operations-consumer.mjs'], directory).trim());
  await cp(root + 'examples/research-creative-consumer.mjs', join(directory, 'research-creative-consumer.mjs'));
  console.log(run(process.execPath, ['research-creative-consumer.mjs'], directory).trim());
  console.log(JSON.stringify({ archive_hash: digest, reproducible: true, runtime_dependencies: 0 }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
