import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  bindPrivateAssetReleaseCandidates,
  createPrivateAssetReleaseAuthority,
  finalizePrivateAssetRelease,
  isPrivateAssetReleaseController,
  privateAssetReleaseAuthorityForController,
  privateAssetReleaseControllerMatches,
  subscribeToSupportedNativePromise,
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

test('rejected same-realm and foreign native projection promises are observed without release or replay', async () => {
  const delayed = new Promise((_, reject) => setTimeout(() => reject(new Error('delayed-native-rejection')), 5));
  const foreign = runInNewContext(
    'new Promise((_, reject) => setTimeout(() => reject(new Error("foreign-native-rejection")), 5))',
    { setTimeout },
  );
  assert.equal(subscribeToSupportedNativePromise(foreign, () => {}, () => {}), true,
    'ordinary native promises from another realm are supported without property access');
  for (const rejected of [Promise.reject(new Error('native-rejection')), delayed, foreign]) {
    const controller = issue();
    bind(controller);
    assert.throws(() => finalizePrivateAssetRelease(
      privateAssetReleaseAuthorityForController(controller), binding(controller), () => rejected,
    ));
    assert.throws(() => finalizePrivateAssetRelease(
      privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'replay',
    ));
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
});

test('promise constructor and species accessors are rejected without invocation', async () => {
  let constructorGetterCalls = 0;
  const ownConstructor = Promise.reject(new Error('prehandled-own-constructor'));
  Promise.prototype.then.call(ownConstructor, undefined, () => {});
  Object.defineProperty(ownConstructor, 'constructor', {
    get() { constructorGetterCalls += 1; throw new Error('constructor getter must not run'); },
  });

  let speciesGetterCalls = 0;
  class PoisonedSpeciesPromise extends Promise {}
  const subclass = new PoisonedSpeciesPromise((_, reject) => reject(new Error('prehandled-poisoned-species')));
  Promise.prototype.then.call(subclass, undefined, () => {});
  Object.defineProperty(PoisonedSpeciesPromise, Symbol.species, {
    get() { speciesGetterCalls += 1; throw new Error('species getter must not run'); },
  });
  const foreignSpecies = runInNewContext('Promise.reject(new Error("prehandled-foreign-species"))');
  Promise.prototype.then.call(foreignSpecies, undefined, () => {});
  const foreignConstructor = Object.getPrototypeOf(foreignSpecies).constructor;
  Object.defineProperty(foreignConstructor, Symbol.species, {
    get() { speciesGetterCalls += 1; throw new Error('foreign species getter must not run'); },
  });

  for (const rejected of [ownConstructor, subclass, foreignSpecies]) {
    const controller = issue();
    bind(controller);
    assert.throws(() => finalizePrivateAssetRelease(
      privateAssetReleaseAuthorityForController(controller), binding(controller), () => rejected,
    ));
    assert.throws(() => finalizePrivateAssetRelease(
      privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'replay',
    ));
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(constructorGetterCalls, 0);
  assert.equal(speciesGetterCalls, 0);
});

test('hostile then accessors and throwing projections are denied without invoking accessors or allowing replay', () => {
  let getterCalls = 0;
  const hostile = Object.create(null);
  Object.defineProperty(hostile, 'then', { get() { getterCalls += 1; throw new Error('must not run'); } });
  const controller = issue();
  bind(controller);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => hostile,
  ));
  assert.equal(getterCalls, 0);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(controller), binding(controller), () => 'replay',
  ));

  let proxyTrapCalls = 0;
  const hostileProxy = new Proxy(Object.create(null), {
    get() { proxyTrapCalls += 1; throw new Error('proxy get must not run'); },
    getOwnPropertyDescriptor() { proxyTrapCalls += 1; throw new Error('proxy descriptor must not run'); },
    getPrototypeOf() { proxyTrapCalls += 1; throw new Error('proxy prototype must not run'); },
  });
  const proxyController = issue();
  bind(proxyController);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(proxyController), binding(proxyController), () => hostileProxy,
  ));
  assert.equal(proxyTrapCalls, 0);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(proxyController), binding(proxyController), () => 'replay',
  ));

  const throwing = issue();
  bind(throwing);
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(throwing), binding(throwing), () => { throw new Error('projection-failure'); },
  ));
  assert.throws(() => finalizePrivateAssetRelease(
    privateAssetReleaseAuthorityForController(throwing), binding(throwing), () => 'replay',
  ));
});
