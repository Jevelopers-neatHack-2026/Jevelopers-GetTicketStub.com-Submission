import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  bindPrivateAssetReleaseCandidates,
  createPrivateAssetReleaseAuthority,
  finalizePrivateAssetRelease,
  isPrivateAssetReleaseController,
  privateAssetReleaseAuthorityForController,
  privateAssetReleaseControllerMatches,
} from '../../src/research/private-asset-release.mjs';

const policyDigest = 'a'.repeat(64);

function issue(overrides = {}) {
  return createPrivateAssetReleaseAuthority({
    tenantId: 'tenant-a',
    runId: 'run-a',
    policyDigest,
    expiresAtMonotonic: performance.now() + 5_000,
    ...overrides,
  });
}

function bind(controller, candidateIds = ['candidate-a']) {
  bindPrivateAssetReleaseCandidates(privateAssetReleaseAuthorityForController(controller), {
    tenantId: 'tenant-a',
    runId: 'run-a',
    policyDigest,
    candidateIds,
  });
}

function binding(controller, candidateIds = ['candidate-a']) {
  return {
    tenantId: 'tenant-a',
    runId: 'run-a',
    policyDigest,
    deadlineAtMonotonic: performance.now() + 4_000,
    candidateIds,
  };
}

test('release controller is opaque, exact-scope, and binds a one-shot candidate set', () => {
  const controller = issue();
  assert.equal(isPrivateAssetReleaseController(controller), true);
  assert.equal(privateAssetReleaseControllerMatches(controller, {
    tenantId: 'tenant-a', runId: 'run-a', policyDigest, deadlineAtMonotonic: performance.now() + 1_000,
  }), true);
  for (const mismatch of [
    { tenantId: 'tenant-b', runId: 'run-a', policyDigest },
    { tenantId: 'tenant-a', runId: 'run-b', policyDigest },
    { tenantId: 'tenant-a', runId: 'run-a', policyDigest: 'b'.repeat(64) },
  ]) {
    assert.equal(privateAssetReleaseControllerMatches(controller, {
      ...mismatch, deadlineAtMonotonic: performance.now() + 1_000,
    }), false);
  }
  assert.equal(isPrivateAssetReleaseController(Object.freeze({ revoke: controller.revoke })), false,
    'copying the public revocation method does not copy the private capability');

  bind(controller);
  assert.throws(() => bindPrivateAssetReleaseCandidates(privateAssetReleaseAuthorityForController(controller), {
    tenantId: 'tenant-a', runId: 'run-a', policyDigest, candidateIds: ['candidate-b'],
  }));
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller, ['candidate-b']), () => 'forged',
  ));
  assert.equal(finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'projected',
  ), 'projected');
  assert.equal(controller.revoke('after_projection'), 'after_release');
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'replayed',
  ));
});

test('revocation during the synchronous release frame denies the projection', () => {
  const controller = issue();
  bind(controller);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => {
      assert.equal(controller.revoke('reentrant_before_projection'), 'before_release');
      return 'must_not_escape';
    },
  ));
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'replayed',
  ));
});

test('thenable projections and expired controllers fail closed and cannot be replayed', async () => {
  const thenableController = issue();
  bind(thenableController);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(thenableController), binding(thenableController), () => ({
      then() { throw new Error('then must not be invoked'); },
    }),
  ));
  assert.equal(thenableController.revoke('projection_failed'), 'before_release');

  const expiring = issue({ expiresAtMonotonic: performance.now() + 20 });
  bind(expiring);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(privateAssetReleaseControllerMatches(expiring, {
    tenantId: 'tenant-a', runId: 'run-a', policyDigest, deadlineAtMonotonic: performance.now() + 1_000,
  }), false);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(expiring), binding(expiring), () => 'expired',
  ));
  assert.equal(expiring.revoke('expired_before_release'), 'before_release');
});
