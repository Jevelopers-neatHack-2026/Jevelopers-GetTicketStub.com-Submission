import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function createContainer(image, home) {
  const nonce = randomBytes(16).toString('hex');
  const name = `finance-eval-${nonce}`;
  const password = randomBytes(32).toString('base64url');
  const env = { PATH: process.env.PATH, HOME: home, POSTGRES_PASSWORD: password };
  const receipt = { name, nonce, id: null, image, creationAttempted: false, started: false, removed: false, cleanupConfirmed: false };
  const saveIdentity = () => writeFileSync(join(home, '../container-identity.json'), JSON.stringify(receipt, null, 2));
  const docker = args => spawnSync('docker', args, { env, encoding: 'utf8', timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
  function checked(args) {
    const result = docker(args);
    assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr}`);
    return result.stdout.trim();
  }
  return {
    receipt, secrets: [password],
    start() {
      checked(['info', '--format', '{{.ServerVersion}}']);
      checked(['pull', image]);
      receipt.creationAttempted = true;
      saveIdentity();
      const id = checked(['create', '--name', name, '--label', `finance-evaluation=${nonce}`, '--publish', '127.0.0.1::5432',
        '--env', 'POSTGRES_USER=ci_test_user', '--env', 'POSTGRES_DB=ci_test', '--env', 'POSTGRES_PASSWORD', image]);
      assert.match(id, /^[a-f0-9]{64}$/);
      receipt.id = id;
      saveIdentity();
      checked(['start', id]);
      receipt.started = true;
      const inspection = JSON.parse(checked(['inspect', id]))[0];
      assert.equal(inspection.Id, id);
      assert.equal(inspection.Config.Labels['finance-evaluation'], nonce);
      assert.equal(inspection.Config.Image, image);
      const ports = inspection.NetworkSettings.Ports['5432/tcp'];
      assert.equal(ports.length, 1);
      assert.equal(ports[0].HostIp, '127.0.0.1');
      return { host: '127.0.0.1', port: Number(ports[0].HostPort), user: 'ci_test_user', password,
        database: 'ci_test', connectionTimeoutMillis: 5000, statement_timeout: 15000 };
    },
    cleanup() {
      if (!receipt.creationAttempted) { receipt.cleanupConfirmed = true; return ''; }
      if (receipt.id === null) {
        const ids = checked(['ps', '-aq', '--filter', `label=finance-evaluation=${nonce}`]);
        assert.equal(ids, '', 'creation outcome uncertain; retain nonce for recovery');
        receipt.cleanupConfirmed = true;
        return '';
      }
      const live = JSON.parse(checked(['inspect', receipt.id]))[0];
      assert.equal(live.Id, receipt.id);
      assert.equal(live.Config.Labels['finance-evaluation'], nonce);
      const logs = docker(['logs', receipt.id]);
      checked(['rm', '--force', '--volumes', receipt.id]);
      receipt.removed = true;
      const after = docker(['inspect', receipt.id]);
      assert.equal(after.status, 1);
      assert.match(after.stderr, /No such (object|container)/i);
      receipt.cleanupConfirmed = true;
      return `${logs.stdout ?? ''}\n${logs.stderr ?? ''}`;
    },
  };
}
