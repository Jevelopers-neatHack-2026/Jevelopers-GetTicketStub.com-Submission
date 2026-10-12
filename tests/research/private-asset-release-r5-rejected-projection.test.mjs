// R4 adapter for the sealed seven-case Astra R3 probe: the host fixture now issues and revokes the additive scoped release capability. The R3 probe remains preserved unchanged in the evidence packet.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { createEvidenceStore } from '../../src/evidence/store.mjs';
import { createDiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import { createPrivateAssetReleaseAuthority, runPrivateRetrieval } from '../../src/research/private-retrieval.mjs';
import { SafeFetcher } from '../../src/security/controlled-fetch.mjs';
import { fixtureUrl, localTestSeam, respond, startFixture } from '../security/support.mjs';

const STOP_WORKER = new URL('./frontier-stop-worker.mjs', import.meta.url);
const TENANT = 'tenant-a';
const LOCAL_FIXTURE_HOST = 'fixture.example.org';

function sourceUrl(pathname = '/') {
  return fixtureUrl(80, pathname, LOCAL_FIXTURE_HOST);
}

function frontierWithSealHook(frontier, hook) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.sealPrivateDraft = (...args) => hook(frontier.sealPrivateDraft.bind(frontier), ...args);
  return wrapped;
}

function frontierWithDelayedCreateRun(frontier, gate, onAttempt) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]) wrapped[name] = frontier[name].bind(frontier);
  wrapped.createRun = async (...args) => {
    await gate;
    try { return await frontier.createRun(...args); }
    finally { onAttempt(); }
  };
  return wrapped;
}

function frontierWithMethodOverrides(frontier, overrides) {
  const wrapped = Object.create(null);
  for (const name of [
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'getCandidateReceiptBinding', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]) wrapped[name] = Object.hasOwn(overrides, name) ? overrides[name] : frontier[name].bind(frontier);
  return wrapped;
}

async function waitUntilPerfAtOrAfter(targetPerfMs) {
  while (performance.now() < targetPerfMs) {
    const remainingMs = targetPerfMs - performance.now();
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.ceil(remainingMs))));
  }
  return performance.now();
}

function request(allowPrivate = true) {
  return { principal: { tenantId: TENANT }, allowPrivate };
}

function releaseAuthorityFor(_authenticated, context) {
  return createPrivateAssetReleaseAuthority({
    tenantId: TENANT,
    runId: context.runId,
    policy: context.policy,
    expiresAtMonotonic: context.deadlineAtMonotonic,
  });
}

function eventHtml({ name = 'Moonlight Market', date = '2027-06-20', city = 'Boston', asset = false } = {}) {
  const event = {
    '@type': 'Event', name, startDate: date,
    location: { name: 'Civic Hall', address: { addressLocality: city } },
  };
  return Buffer.from(`<!doctype html>${asset ? '<meta property="og:image" content="/poster.jpg">' : ''}`
    + `<script type="application/ld+json">${JSON.stringify(event)}</script>`);
}

function eventHtmlWithCanonicalLinks(urls) {
  const event = {
    '@type': 'Event', name: 'Bounded Link Event', startDate: '2027-06-20',
    location: { name: 'Civic Hall', address: { addressLocality: 'Boston' } },
  };
  const links = urls.map((url) => `<link rel="canonical" href="${url}">`).join('');
  return Buffer.from(`<!doctype html>${links}<script type="application/ld+json">${JSON.stringify(event)}</script>`);
}

async function runStopWorker(directory, runId) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [STOP_WORKER.pathname, directory, runId], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (exitCode) => {
      if (exitCode !== 0) reject(new Error(`stop worker failed (${exitCode}): ${stderr.slice(0, 500)}`));
      else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('stop worker returned invalid result')); }
      }
    });
  });
}

async function harness(t, { evidenceOptions = {}, hostnames = [LOCAL_FIXTURE_HOST], addresses } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ei-private-retrieval-'));
  const frontierDirectory = path.join(root, 'frontier');
  const evidenceDirectory = path.join(root, 'evidence');
  const requests = new Set();
  const permitted = new WeakMap();
  let currentAcl = true;
  let activeReleaseController = null;
  const createRetention = (expiresAtMs = Date.now() + 120_000) => {
    const handle = Object.freeze(Object.create(null));
    permitted.set(handle, { tenantId: TENANT, expiresAtMs });
    return handle;
  };
  const evidenceConfig = {
    directory: evidenceDirectory,
    resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      const selectedKeyId = `${purpose}-test-v1`;
      if (keyId && keyId !== selectedKeyId) throw new Error('private key selection denied');
      return { keyId: selectedKeyId, key: createHash('sha256').update(`${tenantId}:${purpose}:private-retrieval-test`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const stored = permitted.get(retentionHandle);
        if (!stored || stored.tenantId !== tenantId) throw new Error('retention denied');
        return { expiresAtMs: stored.expiresAtMs, policyId: 'offline-private-test', policyVersion: '1', accessPolicy: 'tenant_private' };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: 'offline-private-fact-test', policyVersion: '1', accessPolicy: 'tenant_private',
      };
    },
    authorizePrivateAccess({ tenantId, request: authenticated }) {
      return currentAcl && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true;
    },
    authorizePrivateAccessCurrent({ tenantId, request: authenticated }) {
      return currentAcl && authenticated?.principal?.tenantId === tenantId && authenticated.allowPrivate === true;
    },
    now: () => Date.now(),
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 180_000,
    ...evidenceOptions,
  };
  const evidenceStore = createEvidenceStore(evidenceConfig);
  const frontierStores = new Set();
  const openFrontier = () => {
    const store = createDiscoveryFrontierStore({
      directory: frontierDirectory,
      resolveTenant: (authenticated) => authenticated?.principal?.tenantId,
      lockTimeoutMs: 10_000,
    });
    frontierStores.add(store);
    return store;
  };
  const frontier = openFrontier();
  const scope = await frontier.scopeForAuthenticatedRequest(request());
  const evidenceScope = await evidenceStore.scopeForAuthenticatedRequest(request());
  t.after(async () => {
    for (const store of frontierStores) store.close();
    await rm(root, { recursive: true, force: true });
  });
  const makeFetcher = (server) => new SafeFetcher(localTestSeam({
    port: 80, dialPort: server.port, hostnames, addresses,
    onDial: () => requests.add('dial'),
  }));
  const makeInput = ({ runId, server, seeds, limits, authorizeCurrent, retentionHandleFor, safeFetcher, signal,
    assetAcquisitionPolicyFor, assetAcquisitionReleaseAuthorityFor, frontier: frontierStore = frontier, store = evidenceStore }) => ({
    frontier: frontierStore,
    evidenceStore: store,
    safeFetcher: safeFetcher ?? makeFetcher(server),
    request: request(),
    runId,
    seeds,
    ...(limits ? { limits } : {}),
    ...(signal ? { signal } : {}),
    ...(assetAcquisitionPolicyFor ? {
      assetAcquisitionPolicyFor,
      assetAcquisitionReleaseAuthorityFor: assetAcquisitionReleaseAuthorityFor ?? ((_authenticated, context) => {
        activeReleaseController = releaseAuthorityFor(request(), context);
        return activeReleaseController;
      }),
    } : {}),
    retentionHandleFor: retentionHandleFor ?? (() => createRetention()),
    authorizeCurrent: authorizeCurrent ?? (() => true),
  });
  return {
    root, frontierDirectory, frontier, scope, openFrontier, evidenceStore, evidenceScope,
    evidenceConfig,
    createRetention, makeFetcher, makeInput, requests,
    currentlyAuthorized() { return currentAcl; },
    setAcl(value) { currentAcl = value; },
    releaseController() { return activeReleaseController; },
  };
}




test('R4 independent rejected native projection promise is safely denied', async(t)=>{
 const paths=[];
 const page=Buffer.from('<!doctype html><meta property="og:image" content="/logo.svg"><script type="application/ld+json">{"@type":"Event","name":"Rejected Projection Event","startDate":"2027-06-20"}</script>');
 const svg='<svg height="10" width="10" xmlns="http://www.w3.org/2000/svg"><rect height="3" width="2"/></svg>';
 const server=await startFixture((req,res)=>{paths.push(req.url);respond(res,200,{'content-type':req.url==='/logo.svg'?'image/svg+xml':'text/html'},req.url==='/logo.svg'?svg:page);});t.after(()=>server.close());
 const h=await harness(t); let entered=false;
 const store={...h.evidenceStore,finalizeControlledAssetRelease:(scope,check,request,signal,input)=>h.evidenceStore.finalizeControlledAssetRelease(scope,check,request,signal,{...input,project(current){entered=true;input.project(current);return Promise.reject(new Error('owned-rejected-projection'));}})};
 const policy={schemaVersion:1,policyVersion:'ei-private-svg-acquisition/1',policyId:'r4-rejected-projection',allowedOrigins:['http://fixture.example.org']};
 const result=await runPrivateRetrieval(h.makeInput({runId:'r4-rejected-projection',server,store,seeds:[{url:sourceUrl('/event')}],assetAcquisitionPolicyFor:()=>policy}));
 console.log(JSON.stringify({entered,result,paths}));assert.equal(entered,true);assert.notEqual(result.status,'draft');assert.deepEqual(paths,['/event','/logo.svg']);
 await new Promise(r=>setTimeout(r,25));
});

for (const mode of ['same-realm', 'foreign-realm']) {
 test(`R5 outer finalization adapter rejected ${mode} promise is observed`, async(t)=>{
  const paths=[];
  const page=Buffer.from('<!doctype html><meta property="og:image" content="/logo.svg"><script type="application/ld+json">{"@type":"Event","name":"Outer Adapter Event","startDate":"2027-06-20"}</script>');
  const svg='<svg height="10" width="10" xmlns="http://www.w3.org/2000/svg"><rect height="3" width="2"/></svg>';
  const server=await startFixture((req,res)=>{paths.push(req.url);respond(res,200,{'content-type':req.url==='/logo.svg'?'image/svg+xml':'text/html'},req.url==='/logo.svg'?svg:page);});t.after(()=>server.close());
  const h=await harness(t); let entered=false;
  const store={...h.evidenceStore,finalizeControlledAssetRelease:(...args)=>{
   const projection=h.evidenceStore.finalizeControlledAssetRelease(...args);assert.equal(typeof projection,'object');entered=true;
   return mode==='same-realm'
    ?Promise.reject(new Error('outer-owned-rejection'))
    :runInNewContext('new Promise((_, reject) => setTimeout(() => reject(new Error("outer-foreign-rejection")), 5))',{setTimeout});
  }};
  const policy={schemaVersion:1,policyVersion:'ei-private-svg-acquisition/1',policyId:`r5-outer-${mode}`,allowedOrigins:['http://fixture.example.org']};
  const result=await runPrivateRetrieval(h.makeInput({runId:`r5-outer-${mode}`,server,store,seeds:[{url:sourceUrl('/event')}],assetAcquisitionPolicyFor:()=>policy}));
  console.log(JSON.stringify({mode,entered,result,paths}));assert.equal(entered,true);assert.notEqual(result.status,'draft');assert.deepEqual(paths,['/event','/logo.svg']);
  await new Promise(r=>setTimeout(r,25));
 });
}
