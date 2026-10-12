import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, verifyProvenance } from './custody.mjs';
import { variantIds, validateVariant, validateBoundary } from './receipt.mjs';

const inputs = files => Object.fromEntries([...files].map(([name, bytes]) => [name, `sha256:${sha256(bytes)}`]));
const counterSnapshot = counters => structuredClone(counters);
const delta = (after, before) => Object.fromEntries(Object.entries(after).map(([key, value]) => [key,
  typeof value === 'number' ? value - before[key] : Object.fromEntries(Object.entries(value).map(([method, count]) => [method, count - (before[key][method] ?? 0)]))]));

export async function executeScenarios(source, context) {
  const { corpus, output, pin } = context;
  const load = path => import(pathToFileURL(join(source, path)).href);
  const api = await load('dist/production-bundle.js');
  const rootApi = await load('dist/index.js');
  const f = await load('tests/production-bundle-fixtures.mjs');
  const { cleanupMockMeteringArtifacts } = await load('tests/mock-fixtures.mjs');
  verifyProvenance(f.provenance, pin);
  const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n');
  const readFiles = async prefix => new Map(await Promise.all(pin.corpus.members.filter(row => row.path.startsWith(prefix))
    .map(async row => [row.path.slice(prefix.length), new Uint8Array(await readFile(join(corpus, row.path)))])));
  const commitmentBytes = new Uint8Array(await readFile(join(corpus, 'bundle/trusted-commitment.json')));
  const baseline = await readFiles('variants/valid/');
  const makeWorld = () => { const world = f.createWorld(); f.publishFromBaseline(world, baseline, commitmentBytes); return world; };
  const revision = pin.revision;
  const results = [];
  try {
    for (const id of variantIds) {
      const files = await readFiles(`variants/${id}/`); const before = inputs(files);
      const world = makeWorld();
      const resolved = await api.resolveTrustAnchor({ trustedScope: f.SCOPE, bundleDigest: f.BUNDLE_HASH },
        { publication: world.publication, bytes: world.bytes }, { limits: api.PRODUCTION_BUNDLE_DEFAULT_LIMITS, signal: new AbortController().signal });
      assert.equal(resolved.ok, true);
      const report = api.validateProductionBundleBytes({ files: [...files].map(([filename, bytes]) => ({ filename, bytes })) }, resolved.anchor,
        { clock: f.frozenClock, consumerRevision: revision });
      const observation = { id, basis: 'direct_owner_api', inputs: before, after: inputs(files), commitment_sha256: sha256(commitmentBytes), report, calls: world.calls };
      await save(`variant-${id}.json`, observation);
      validateVariant(observation, pin); results.push(`variant-${id}.json`);
    }
    for (const id of ['wrong-scope', 'use-time-drift', 'non-simulated-denial']) {
      const world = makeWorld();
      const gate = api.createProductionBundleGate({ publication: world.publication, bytes: world.bytes, clock: f.frozenClock, consumerRevision: revision });
      const h = f.createGateRuntime({ gate, ...(id === 'non-simulated-denial' ? { forgeAllBindingsAccepted: true, runtimeOptions: { mode: 'sandbox', sandboxEnabled: true } } : {}) });
      assert.ok(h.runtime instanceof rootApi.FulfillmentConnectorRuntime);
      let command; let scope = f.SCOPE; let gateReport = null;
      if (id === 'non-simulated-denial') {
        assert.equal(h.runtime.audit().sandboxReady, true);
        command = f.bundleSubmitCommand({ providerQuoteId: 'q-1', currency: 'USD', totalMinor: 100, expiresAt: '2099-01-01T00:00:00.000Z' });
      } else {
        ({ command } = await f.prepareBundleSubmit(h));
        if (id === 'wrong-scope') {
          scope = { tenantId: f.SCOPE.tenantId, projectId: '123e4567-e89b-42d3-a456-0000000000ff' };
          gateReport = await gate.checkBeforeSubmit(f.gateRequest({ trustedScope: scope }));
        } else {
          const tampered = new Uint8Array(await readFile(join(corpus, 'variants/tampered-payload/lineage.json')));
          world.hooks.read = async (request, dflt) => world.calls.resolve.length >= 2 && request.filename === 'lineage.json'
            ? { status: 'found', bytes: new Uint8Array(tampered) } : dflt();
        }
      }
      const before = counterSnapshot(h.counters); let error = null;
      try { await h.runtime.submit(f.envelopeFor(command, scope), scope); } catch (caught) {
        assert.ok(caught instanceof rootApi.ConnectorError);
        error = { code: caught.code, side_effect_state: caught.toJSON().side_effect_state, retryable: caught.retryable };
      }
      const after = counterSnapshot(h.counters);
      const result = { id, basis: 'direct_owner_runtime_with_synthetic_ports', gate_report: gateReport, error,
        counters_before: before, counters_after: after, counters_delta: delta(after, before),
        calls: world.calls, order: h.order, simulator_submit: h.base.simulator.dispatchCounters().submit,
        attempts: h.base.store.attempts.map(attempt => ({ side_effect_state: attempt.sideEffectState })),
        drift_origin: id === 'use-time-drift' ? 'variants/tampered-payload/lineage.json' : null,
        baseline_after: inputs(baseline), actual_sandbox_execution: false };
      await save(`boundary-${id}.json`, result);
      validateBoundary(result, pin); results.push(`boundary-${id}.json`);
    }
    return results;
  } finally {
    await cleanupMockMeteringArtifacts();
    await save('fixture-cleanup.json', { owner_helper: 'cleanupMockMeteringArtifacts', completed: true });
  }
}
