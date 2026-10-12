import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
assert.ok(process.env.FINANCE_SOURCE, 'Unit canary test requires exact producer source');
const { sanitizeOutput } = await import(pathToFileURL(join(resolve(process.env.FINANCE_SOURCE), 'scripts/sanitize.mjs')));

test('owner sanitizer withholds generated passwords, database URLs and bearer canaries', () => {
  const secrets = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  const raw = JSON.stringify({ error: `database password ${secrets[0]}`, ports: { password: secrets[1] },
    url: `postgres://synthetic:${secrets[2]}@127.0.0.1:1234/ci_test`, header: 'Authorization: Bearer PRIVATE_EVALUATION_CANARY' });
  const clean = sanitizeOutput(raw, secrets);
  for (const secret of secrets) assert.equal(clean.includes(secret), false);
  assert.equal(clean.includes('postgres://'), false);
  assert.equal(clean.includes('PRIVATE_EVALUATION_CANARY'), false);
  assert.doesNotThrow(() => JSON.parse(clean));
});
