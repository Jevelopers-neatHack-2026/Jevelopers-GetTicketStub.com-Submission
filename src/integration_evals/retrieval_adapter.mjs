import { readFile, writeFile, realpath, readlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { probeRetrieval } from './retrieval_probe.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const request = JSON.parse(readFileSync(0, 'utf8'));
if (process.env.IE_MODE !== 'mock-only' || process.platform !== 'linux') throw new Error('Unsupported retrieval adapter mode/platform');
if (process.argv[2] !== '--runtime-sha256' || hash(await readFile(process.execPath)) !== process.argv[3]) throw new Error('Retrieval runtime mismatch');
if (process.argv[4] === '--cleanup') process.exit(0);
if (process.argv.length !== 4) throw new Error('Unsupported retrieval adapter arguments');
const profile = JSON.parse(await readFile(request.configuration_artifact, 'utf8'));
if (request.case.id !== 'ssrf-egress' || profile.case_id !== request.case.id || profile.mode !== 'mock-only'
  || request.component_revision !== profile.producer_revision || process.versions.node !== profile.node_version) throw new Error('Retrieval profile mismatch');
const root = await realpath(process.cwd());
const source = async name => {
  const target = await realpath(resolve(root, name));
  const displacement = relative(root, target);
  if (isAbsolute(displacement) || displacement.startsWith('..')) throw new Error('Unsafe retrieval source');
  return pathToFileURL(target).href;
};
const api = await import(await source('src/security/index.mjs'));
const fixtures = await import(await source('tests/security/support.mjs'));
const fixtureRoot = resolve(dirname(request.configuration_artifact), '../../fixtures');
const catalog = JSON.parse(await readFile(resolve(fixtureRoot, 'catalog.json'), 'utf8'));
const negative = catalog.fixtures.find(item => item.id === 'source-negative');
const negativeBytes = await readFile(resolve(fixtureRoot, 'data/source-negative.txt'));
if (!request.case.fixtures.includes('source-negative') || negative?.path !== 'data/source-negative.txt'
  || negative.sha256 !== hash(negativeBytes)) throw new Error('Retrieval fixture mismatch');
const metadata = JSON.parse(negativeBytes);
if (typeof metadata.url !== 'string') throw new Error('Invalid retrieval fixture');
const result = await probeRetrieval(api, fixtures, metadata.url);
const limitations = [
  'Source-only mock fixture hooks, not installed-package adoption or owner-accepted integration.',
  'Partial IE-11A coverage; fixture server counters are not authoritative external egress capture.',
  'No provider, composed release, research/JEV/creative handoff, or real infrastructure evidence.',
];
const artifact = { ...result, limitations,
  producer_revision: request.component_revision,
  input_fixture: { id: negative.id, sha256: negative.sha256 },
  network_namespace: await readlink('/proc/self/ns/net'),
};
const data = Buffer.from(JSON.stringify(artifact));
await writeFile(resolve(request.artifact_directory, 'retrieval.json'), data, { flag: 'wx' });
const evidence = request.case.requirements.map((requirement, index) => ({
  id: `retrieval-${index}`, requirement, case_id: request.case.id, run_id: request.run_id,
  component: 'event-intelligence', revision: request.component_revision,
  created_at: request.clock, original_cutoff: request.clock, mode: 'mock-only', origin: 'synthetic',
  path: 'retrieval.json', sha256: hash(data), permission_ref: 'original-inert-fixture',
  redaction_ref: 'scenario-ids-counts-error-codes-only', reviewer_access_ref: 'retained-local-artifact',
  kind: 'evaluation', limitations,
}));
console.log(JSON.stringify({ component_revision: request.component_revision,
  mode: 'mock-only', origin: 'synthetic', observations: result.observations, evidence,
  cost: null, cost_status: 'unknown' }));
