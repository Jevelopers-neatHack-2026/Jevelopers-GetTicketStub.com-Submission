import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateArtifact } from '../artifact.mjs';
import { validateContent } from './content.mjs';
import { validateProof } from './proof.mjs';
import { validateCtaSource } from './cta.mjs';

export default async function run({ root, artifactDir, mode = 'release' }) {
  assert.ok(['draft', 'release'].includes(mode), 'Unknown governance mode');
  for (const path of ['review/content-policy.md', 'review/content-change-checklist.md']) {
    assert.ok((await readFile(resolve(root, path), 'utf8')).trim(), `Missing content governance document: ${path}`);
  }
  await validateArtifact(root, artifactDir);
  const html = await readFile(resolve(artifactDir, 'index.html'), 'utf8');
  const copy = JSON.parse(await readFile(resolve(root, 'src/content/copy.json'), 'utf8'));
  const proof = JSON.parse(await readFile(resolve(root, 'review/examples.json'), 'utf8'));
  const cta = JSON.parse(await readFile(resolve(root, 'src/content/cta.json'), 'utf8'));
  // Reuse the actual inventory, immutable-source, expiry and native-link checks.
  // These local author audits cannot confer Product/marketing/rights approval.
  validateContent(html, copy, { root, mode: 'draft' });
  await validateProof({ root, html, manifest: proof, mode: 'draft' });
  validateCtaSource(html, cta);
  const tests = spawnSync(process.execPath, ['--test', 'tests/governance.test.mjs'], { cwd: root, stdio: 'inherit' });
  if (tests.error || tests.status !== 0) throw new Error(tests.error?.message || `Governance dry runs exited ${tests.status}`);
  if (mode === 'release') throw new Error('LP-09 release blocked: named maintainer/backup and Product, marketing, brand/rights, Finance/reliability acceptance are unconfirmed. Local dry runs and navigation-only approval do not approve publication; see review/content-policy.md.');
  console.log('governance: supported historical update replayed as draft; unsupported/stale evidence rejected; synthetic local withdrawal/replacement/rollback exercised; release acceptance PENDING');
  return { status: 'PASS_DRAFT' };
}
