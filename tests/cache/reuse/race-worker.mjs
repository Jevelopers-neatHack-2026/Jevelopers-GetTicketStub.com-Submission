import { createScopedReuseStore } from '../../../src/cache/reuse/store.mjs';

const { directory, tenantId, mode, profileRef, now } = JSON.parse(process.env.REUSE_RACE_CONFIG);
const authRequest = Object.freeze({ principal: Object.freeze({ tenantId, actorId: `actor-${tenantId}` }) });
let waiting = null;
const inputLines = [];
let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  for (;;) {
    const newline = inputBuffer.indexOf('\n');
    if (newline < 0) break;
    const line = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    const resolve = waiting;
    if (resolve) {
      waiting = null;
      resolve(line);
    } else inputLines.push(line);
  }
});
process.stdin.resume();

async function barrier() {
  process.stdout.write('ready\n');
  if (inputLines.length) return inputLines.shift();
  return new Promise((resolve) => { waiting = resolve; });
}

const indexKey = Buffer.alloc(32, tenantId.charCodeAt(0));
const store = createScopedReuseStore({
  directory,
  resolveTenant: (request) => request.principal.tenantId,
  resolveActor: (request) => request.principal.actorId,
  authorizeAction: () => true,
  resolveKey: async ({ tenantId: keyTenant, purpose, keyId }) => {
    if (mode === 'invalidate' && purpose === 'payload' && keyId) await barrier();
    return { keyId: `tenant_private:${purpose}:${keyTenant ?? 'global'}`, key: keyTenant ? indexKey : Buffer.alloc(32, 91) };
  },
  resolveRetention: ({ nowMs }) => ({ expiresAtMs: nowMs + 60_000, policyId: 'race', policyVersion: '1' }),
  verifySourceObservation: async ({ expectedContentHash }) => {
    if (mode === 'observe') await barrier();
    return {
      status: 'not_modified',
      contentHash: expectedContentHash,
      validatedAt: new Date(now).toISOString(),
    };
  },
  now: () => now,
});

try {
  const scope = await store.scopeForAuthenticatedRequest(authRequest);
  const outcome = mode === 'invalidate'
    ? await store.invalidate(scope, authRequest, { profileRef, scopeKind: 'tenant_private', reason: 'material_fact_change' })
    : await store.observe(scope, authRequest, { profileRef, scopeKind: 'tenant_private', observation: { source: 'cross-process-race' } });
  process.stdout.write(`${JSON.stringify({ outcome })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ errorCode: error?.code ?? 'unknown' })}\n`);
}
process.exitCode = 0;
