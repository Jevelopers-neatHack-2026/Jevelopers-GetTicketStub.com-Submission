import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { createEvidenceStore } from '../../src/evidence/store.mjs';
import { createDiscoveryFrontierStore } from '../../src/discovery/planner/frontier.mjs';
import { runPrivateRetrieval } from '../../src/research/private-retrieval.mjs';
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
    assetAcquisitionPolicyFor, frontier: frontierStore = frontier, store = evidenceStore }) => ({
    frontier: frontierStore,
    evidenceStore: store,
    safeFetcher: safeFetcher ?? makeFetcher(server),
    request: request(),
    runId,
    seeds,
    ...(limits ? { limits } : {}),
    ...(signal ? { signal } : {}),
    ...(assetAcquisitionPolicyFor ? { assetAcquisitionPolicyFor } : {}),
    retentionHandleFor: retentionHandleFor ?? (() => createRetention()),
    authorizeCurrent: authorizeCurrent ?? (() => true),
  });
  return {
    root, frontierDirectory, frontier, scope, openFrontier, evidenceStore, evidenceScope,
    evidenceConfig,
    createRetention, makeFetcher, makeInput, requests,
    currentlyAuthorized() { return currentAcl; },
    setAcl(value) { currentAcl = value; },
  };
}


for (const mode of ['control', 'policy-revoked', 'asset-auth-revoked', 'source-expired',
  'materialize-policy-revoked', 'materialize-asset-auth-revoked', 'multi-asset-policy-revoked']) {
 test(`reviewer final release: ${mode}`, async (t) => {
  const paths=[];const events=[];let evidenceNow=Date.now();
  const assetPaths=mode.startsWith('multi-asset')?['/logo.svg','/logo-2.svg']:['/logo.svg'];
  const page=Buffer.from('<!doctype html>'+assetPaths.map((assetPath)=>`<meta property="og:image" content="${assetPath}">`).join('')+'<script type="application/ld+json">{"@type":"Event","name":"Final Release","startDate":"2027-06-20"}</script>');
  const svg='<svg height="10" width="10" xmlns="http://www.w3.org/2000/svg"><rect height="3" width="2"/></svg>';
  const server=await startFixture((req,res)=>{const pathname=new URL(req.url,'http://fixture.example.org').pathname;paths.push(pathname);const isAsset=assetPaths.includes(pathname);respond(res,200,{'content-type':isAsset?'image/svg+xml':'text/html'},isAsset?svg:page);});
  t.after(()=>server.close());
  const h=await harness(t,{evidenceOptions:{now:()=>evidenceNow}});let revoked=false;let callsAfterRevoke=0;let materializationCalls=0;
  const revokeAfterMaterialize=mode.startsWith('materialize-');
  const frontier=frontierWithSealHook(h.frontier,async(fn,...args)=>{const r=await fn(...args);if(!revokeAfterMaterialize){revoked=true;events.push("seal-complete:revoked");if(mode==="source-expired")evidenceNow+=240_000;}return r;});
  const store={...h.evidenceStore,materializeSelected:async(...args)=>{const result=await h.evidenceStore.materializeSelected(...args);materializationCalls+=1;const selection=args[1];events.push(`materialization:${materializationCalls}:${selection?.evidence?.length??-1}:${selection?.facts?.length??-1}`);if(revokeAfterMaterialize&&(selection?.evidence?.length??0)>1){revoked=true;events.push("final-materialization-complete:revoked");}return result;}};
  const policy={schemaVersion:1,policyVersion:'ei-private-svg-acquisition/1',policyId:'reviewer-final-policy',allowedOrigins:['http://fixture.example.org']};
  const result=await runPrivateRetrieval(h.makeInput({runId:`review-final-${mode}`,server,frontier,store,seeds:[{url:sourceUrl('/event')}],assetAcquisitionPolicyFor:()=>{events.push(`policy:${revoked}`);if(revoked)callsAfterRevoke++;return mode.includes('policy-revoked')&&revoked?null:policy;},authorizeCurrent:(_r,c)=>{events.push(`authorization:${c.stage}:${revoked}`);return !(mode.includes('asset-auth-revoked')&&revoked&&c.stage==='asset-acquisition');}}));
  console.log(JSON.stringify({mode,revoked,callsAfterRevoke,materializationCalls,paths,events,status:result.status,acquisitions:result.assetAcquisitions?.length,limitations:result.limitations}));
  assert.equal(revoked,true);assert.deepEqual([...paths].sort(),['/event',...assetPaths].sort());
  if(revokeAfterMaterialize)assert.ok(events.includes('final-materialization-complete:revoked'),'Revocation occurs only after final selected materialization completes');
  if(mode==='control')assert.equal(result.assetAcquisitions?.length,1);
  else if(mode==='multi-asset-policy-revoked')assert.equal(result.assetAcquisitions?.length??0,0,'Final release revalidates every cached acquisition without dispatching again');
  else assert.equal(result.assetAcquisitions?.length??0,0,'A policy or asset-stage authorization revoked before final release must suppress acquired plans');
 });
}
