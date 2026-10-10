import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = resolve(process.argv[2] ?? new URL("../dist/security.js", import.meta.url).pathname);
const security = await import(pathToFileURL(modulePath).href);
const scope = Object.freeze({ tenantId: "tenant-security-fixture", projectId: "project-security-fixture" });
const cases = [];

function test(name, run) {
  cases.push([name, run]);
}

async function expectSecurityFailure(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof security.SecurityBoundaryError);
    assert.equal(error.code, code);
    assert.equal(JSON.stringify(error.toJSON()).includes("private-canary"), false);
    return true;
  });
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x03]);
const ASSET_POLICY = Object.freeze({
  allowedHosts: Object.freeze(["assets.example.test"]),
  allowedMimeTypes: Object.freeze(["image/png"]),
  maxBytes: 1024,
  timeoutMs: 500,
  maxRedirects: 2
});

function assetResponse(request, overrides = {}) {
  return {
    status: 200,
    headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) },
    connectedAddress: request.connectTo[0],
    body: PNG,
    ...overrides
  };
}

function assetPorts(options = {}) {
  const state = { resolutions: [], requests: [] };
  const resolver = {
    async resolve(hostname, signal) {
      state.resolutions.push({ hostname, aborted: signal.aborted });
      return options.resolve?.(hostname, signal) ?? ["93.184.216.34"];
    }
  };
  const transport = {
    async request(request) {
      state.requests.push(request);
      return options.request?.(request, state) ?? assetResponse(request);
    }
  };
  return { state, resolver, transport };
}

const approvedIdentity = Object.freeze({
  artifactId: "artifact-fixture-1",
  sha256: `sha256:${createHash("sha256").update(PNG).digest("hex")}`,
  contentType: "image/png",
  byteLength: PNG.byteLength,
  termsFingerprint: "sha256:fixture-terms"
});

function callbackBytes(eventId = "event-fixture-1", providerRequestId = "request-fixture-1") {
  return new TextEncoder().encode(JSON.stringify({ eventId, providerRequestId, email: "private-canary@example.test" }));
}

function callbackDependencies() {
  const state = { claims: [] };
  const claimed = new Set();
  const replayStore = {
    async claim(input) {
      const key = `${input.providerId}/${input.trustedScope.tenantId}/${input.trustedScope.projectId}/${input.eventId}`;
      state.claims.push(key);
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }
  };
  return { state, replayStore };
}

test("encrypted references are scope-bound before decryption", async () => {
  let decryptCalls = 0;
  let storeScope;
  const input = {
    reference: "customer-shipment-reference",
    trustedScope: scope,
    purpose: "authorized_provider_submit",
    store: {
      async get(_reference, trustedScope) {
        storeScope = trustedScope;
        return { tenantId: "another-tenant", projectId: scope.projectId, ciphertext: new Uint8Array([1, 2, 3]), keyVersion: "enc-v1" };
      }
    },
    decryptor: {
      async decrypt() {
        decryptCalls += 1;
        return { address: "private-canary" };
      }
    }
  };
  await expectSecurityFailure(security.resolveEncryptedScopedReference(input), "reference_unavailable");
  assert.equal(decryptCalls, 0);
  assert.deepEqual(storeScope, scope);
  assert.equal(Object.isFrozen(storeScope), true);

  const value = await security.resolveEncryptedScopedReference({
    ...input,
    store: { async get(_reference, trustedScope) {
      return { tenantId: trustedScope.tenantId, projectId: trustedScope.projectId, ciphertext: new Uint8Array([1, 2, 3]), keyVersion: "enc-v2" };
    } },
    decryptor: { async decrypt(ciphertext, context) {
      decryptCalls += 1;
      assert.deepEqual([...ciphertext], [1, 2, 3]);
      assert.equal(context.keyVersion, "enc-v2");
      assert.deepEqual(context.trustedScope, scope);
      return { authorized: true };
    } }
  });
  assert.deepEqual(value, { authorized: true });
  assert.equal(decryptCalls, 1);
});

test("provider payload projection includes only reviewed nested fields", () => {
  const payload = security.minimizeProviderPayload({
    value: {
      orderId: "order-fixture-1",
      item: { sku: "book-1", quantity: 1, costCenter: "private-canary" },
      recipient: {
        name: "Buyer Fixture",
        address: { line1: "private-canary address", city: "Testville", postalCode: "00000", country: "US" },
        email: "private-canary@example.test",
        phone: "+15555550123"
      },
      internalToken: "private-canary"
    },
    fields: {
      orderId: true,
      item: { sku: true, quantity: true },
      recipient: { name: true, address: { line1: true, city: true, postalCode: true, country: true } }
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    orderId: "order-fixture-1",
    item: { sku: "book-1", quantity: 1 },
    recipient: { name: "Buyer Fixture", address: { line1: "private-canary address", city: "Testville", postalCode: "00000", country: "US" } }
  });
  assert.equal(JSON.stringify(payload).includes("private-canary@example.test"), false);
  assert.equal(JSON.stringify(payload).includes("private-canary\""), false);
  assert.equal(Object.isFrozen(payload.recipient.address), true);
  assert.throws(() => security.minimizeProviderPayload({ value: { item: { sku: "one" } }, fields: { item: true } }), (error) => error.code === "provider_payload_policy_invalid");
  assert.throws(() => security.minimizeProviderPayload({ value: { id: "one" }, fields: { constructor: true } }), (error) => error.code === "provider_payload_policy_invalid");
});

test("personal-data purge keeps only scoped keyed tombstone fingerprints", async () => {
  let captured;
  const fingerprinter = {
    async fingerprint(purpose, canonicalIdentity) {
      return {
        keyVersion: "tombstone-key-v1",
        digest: createHmac("sha256", "fixture-only-key").update(`${purpose}:${canonicalIdentity}`).digest("base64url")
      };
    }
  };
  const retentionPort = { async purgePersonalDataAndRetainTombstone(request) { captured = request; } };
  const tombstone = await security.purgeSensitiveRecord({
    reference: "encrypted-customer-ref",
    trustedScope: scope,
    providerId: "fixture-provider",
    authorizationId: "authorization-fixture-1",
    actionId: "action-fixture-1",
    idempotencyKey: "delivery-key-a",
    deletedAt: 1_800_000_000_000,
    retainUntil: 1_900_000_000_000,
    fingerprinter,
    retentionPort,
    address: "private-canary address",
    signedUrl: "https://assets.example.test/private-canary"
  });
  assert.deepEqual(captured.trustedScope, scope);
  assert.equal(captured.reference, "encrypted-customer-ref");
  assert.deepEqual(captured.tombstone, tombstone);
  assert.equal(JSON.stringify(tombstone).includes("delivery-key-a"), false);
  assert.equal(JSON.stringify(tombstone).includes("private-canary"), false);
  assert.equal(Object.isFrozen(tombstone), true);

  const second = await security.purgeSensitiveRecord({
    reference: "encrypted-customer-ref-2",
    trustedScope: scope,
    providerId: "fixture-provider",
    authorizationId: "authorization-fixture-1",
    actionId: "action-fixture-1",
    idempotencyKey: "delivery-key-b",
    deletedAt: 1_800_000_000_000,
    retainUntil: 1_900_000_000_000,
    fingerprinter,
    retentionPort
  });
  assert.deepEqual(second.actionFingerprint, tombstone.actionFingerprint);
  assert.notDeepEqual(second.idempotencyFingerprint, tombstone.idempotencyFingerprint);
  await expectSecurityFailure(security.purgeSensitiveRecord({
    reference: "encrypted-customer-ref",
    trustedScope: scope,
    providerId: "fixture-provider",
    authorizationId: "authorization-fixture-1",
    actionId: "action-fixture-1",
    idempotencyKey: "delivery-key-a",
    deletedAt: 10,
    retainUntil: 10,
    fingerprinter,
    retentionPort
  }), "retention_policy_invalid");
  await expectSecurityFailure(security.purgeSensitiveRecord({
    reference: "encrypted-customer-ref",
    trustedScope: scope,
    providerId: "fixture-provider",
    authorizationId: "authorization-fixture-1",
    actionId: "action-fixture-1",
    idempotencyKey: "delivery-key-a",
    deletedAt: 10.5,
    retainUntil: 20,
    fingerprinter,
    retentionPort
  }), "retention_policy_invalid");
});

test("server credentials are resolved by exact mode on each operation", async () => {
  const seen = [];
  let version = 0;
  const source = {
    async load(request) {
      seen.push(request);
      version += 1;
      return { secret: `fixture-secret-v${version}`, version: `provider-key-v${version}`, mode: request.mode };
    }
  };
  const first = await security.withServerSecret({
    providerId: "fixture-provider", secretReference: "sandbox-api-key", mode: "sandbox", source,
    async use(context) { return { version: context.version, mode: context.mode, usedSecret: context.secret === "fixture-secret-v1" }; }
  });
  const second = await security.withServerSecret({
    providerId: "fixture-provider", secretReference: "sandbox-api-key", mode: "sandbox", source,
    async use(context) { return { version: context.version, mode: context.mode }; }
  });
  assert.deepEqual(first, { version: "provider-key-v1", mode: "sandbox", usedSecret: true });
  assert.deepEqual(second, { version: "provider-key-v2", mode: "sandbox" });
  assert.equal(seen.length, 2);
  assert.equal(seen.every((call) => call.mode === "sandbox"), true);
  await expectSecurityFailure(security.withServerSecret({
    providerId: "fixture-provider", secretReference: "sandbox-api-key", mode: "live", source,
    async use() { return "must-not-run"; }
  }), "mode_mismatch");
  assert.equal(seen.length, 2);

  await expectSecurityFailure(security.withServerSecret({
    providerId: "fixture-provider", secretReference: "sandbox-api-key", mode: "simulated",
    source: { async load() { return { secret: "private-canary", version: "prod-v1", mode: "sandbox" }; } },
    async use() { return "must-not-run"; }
  }), "server_secret_unavailable");
  await expectSecurityFailure(security.withServerSecret({
    providerId: "fixture-provider", secretReference: "sandbox-api-key", mode: "sandbox", source,
    async use() { throw new Error("private-canary"); }
  }), "provider_operation_failed");
});

test("asset retrieval pins exact approved public host addresses and verifies bytes", async () => {
  const ports = assetPorts();
  const result = await security.retrieveApprovedAsset({
    url: "https://assets.example.test/design.png?signature=private-canary",
    mode: "simulated",
    trustedScope: scope,
    policy: ASSET_POLICY,
    resolver: ports.resolver,
    transport: ports.transport
  });
  assert.deepEqual(ports.state.resolutions.map((entry) => entry.hostname), ["assets.example.test"]);
  assert.equal(ports.state.requests.length, 1);
  assert.equal(ports.state.requests[0].redirect, "manual");
  assert.equal(ports.state.requests[0].tlsServerName, "assets.example.test");
  assert.deepEqual(ports.state.requests[0].connectTo, ["93.184.216.34"]);
  assert.equal("headers" in ports.state.requests[0], false);
  assert.equal("authorization" in ports.state.requests[0], false);
  assert.equal(result.sha256, approvedIdentity.sha256);
  assert.equal(result.byteLength, PNG.byteLength);
  assert.equal(result.finalHost, "assets.example.test");
  await security.assertRetrievedAssetMatchesApproval({ asset: result, approved: approvedIdentity });

  result.bytes[8] = 0x7f;
  await expectSecurityFailure(security.assertRetrievedAssetMatchesApproval({ asset: result, approved: approvedIdentity }), "asset_approval_mismatch");
});

test("asset retrieval rejects unsafe URL forms before DNS or transport", async () => {
  for (const url of [
    "http://assets.example.test/file.png",
    "https://user:password@assets.example.test/file.png",
    "https://evil.example.test/file.png",
    "https://127.0.0.1/file.png",
    "https://assets.example.test:444/file.png",
    "https://assets.example.test/file.png#fragment"
  ]) {
    const ports = assetPorts();
    await assert.rejects(security.retrieveApprovedAsset({
      url, mode: "simulated", trustedScope: scope, policy: ASSET_POLICY,
      resolver: ports.resolver, transport: ports.transport
    }), (error) => error instanceof security.SecurityBoundaryError && ["asset_url_rejected", "asset_host_rejected"].includes(error.code));
    assert.equal(ports.state.resolutions.length, 0);
    assert.equal(ports.state.requests.length, 0);
  }
});

test("private, link-local, reserved, and mapped IP answers are denied", () => {
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.10.20", "172.20.1.1",
    "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.2", "203.0.113.5", "224.0.0.1",
    "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "2002:7f00:1::1", "3fff::1"
  ]) assert.equal(security.isPublicIPAddress(address), false, `${address} should be prohibited`);
  for (const address of ["8.8.8.8", "93.184.216.34", "2001:4860:4860::8888"]) {
    assert.equal(security.isPublicIPAddress(address), true, `${address} should be globally reachable`);
  }
});

test("DNS answers and connected peer are checked before accepting asset bytes", async () => {
  const privateAnswer = assetPorts({ resolve: () => ["93.184.216.34", "10.0.0.7"] });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: ASSET_POLICY, resolver: privateAnswer.resolver, transport: privateAnswer.transport
  }), "asset_address_rejected");
  assert.equal(privateAnswer.state.requests.length, 0);

  const wrongPeer = assetPorts({ request: (request) => assetResponse(request, { connectedAddress: "127.0.0.1" }) });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: ASSET_POLICY, resolver: wrongPeer.resolver, transport: wrongPeer.transport
  }), "asset_peer_mismatch");
});

test("asset redirects are manual, bounded, and revalidated against the allowlist", async () => {
  const rejectedState = { requests: [], resolutions: [] };
  const rejected = await security.retrieveApprovedAsset({
    url: "https://assets.example.test/start.png", mode: "sandbox", trustedScope: scope,
    policy: ASSET_POLICY,
    resolver: { async resolve(host) { rejectedState.resolutions.push(host); return ["93.184.216.34"]; } },
    transport: { async request(request) {
      rejectedState.requests.push(request);
      return assetResponse(request, { status: 302, headers: { location: "https://evil.example.test/private.png" }, body: new Uint8Array() });
    } }
  }).then(() => undefined, (error) => error);
  assert.ok(rejected instanceof security.SecurityBoundaryError);
  assert.equal(rejected.code, "asset_host_rejected");
  assert.equal(rejectedState.requests.length, 1);
  assert.deepEqual(rejectedState.resolutions, ["assets.example.test"]);

  const requests = [];
  const allowedPolicy = { ...ASSET_POLICY, allowedHosts: ["assets.example.test", "cdn.example.test"] };
  const allowed = await security.retrieveApprovedAsset({
    url: "https://assets.example.test/start.png", mode: "sandbox", trustedScope: scope,
    policy: allowedPolicy,
    resolver: { async resolve() { return ["93.184.216.34"]; } },
    transport: { async request(request) {
      requests.push(request);
      return requests.length === 1
        ? assetResponse(request, { status: 302, headers: { location: "https://cdn.example.test/final.png" }, body: new Uint8Array() })
        : assetResponse(request);
    } }
  });
  assert.equal(allowed.redirectCount, 1);
  assert.deepEqual(requests.map((request) => request.hostname), ["assets.example.test", "cdn.example.test"]);
  assert.equal(requests.every((request) => request.redirect === "manual"), true);

  const redirectLimit = assetPorts({ request: (request) => assetResponse(request, { status: 302, headers: { location: "/again" }, body: new Uint8Array() }) });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/start.png", mode: "simulated", trustedScope: scope,
    policy: { ...ASSET_POLICY, maxRedirects: 0 }, resolver: redirectLimit.resolver, transport: redirectLimit.transport
  }), "asset_redirect_rejected");
});

test("asset byte count, media declaration, and magic bytes are enforced", async () => {
  const declaredOversize = assetPorts({ request: (request) => assetResponse(request, {
    headers: { "content-type": "image/png", "content-length": "2048" }
  }) });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: ASSET_POLICY, resolver: declaredOversize.resolver, transport: declaredOversize.transport
  }), "asset_too_large");

  const streamedOversize = assetPorts({ request: (request) => assetResponse(request, {
    headers: { "content-type": "image/png" },
    body: (async function* () { yield new Uint8Array(600); yield new Uint8Array(600); })()
  }) });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: ASSET_POLICY, resolver: streamedOversize.resolver, transport: streamedOversize.transport
  }), "asset_too_large");

  const wrongType = assetPorts({ request: (request) => assetResponse(request, {
    headers: { "content-type": "image/png" }, body: new TextEncoder().encode("<html>private-canary</html>")
  }) });
  await expectSecurityFailure(security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: ASSET_POLICY, resolver: wrongType.resolver, transport: wrongType.transport
  }), "asset_type_rejected");
});

test("asset retrieval times out and aborts its injected ports", async () => {
  let observedSignal;
  const pending = security.retrieveApprovedAsset({
    url: "https://assets.example.test/file.png", mode: "simulated", trustedScope: scope,
    policy: { ...ASSET_POLICY, timeoutMs: 25 },
    resolver: { resolve(_host, signal) { observedSignal = signal; return new Promise(() => {}); } },
    transport: { async request() { throw new Error("should not run"); } }
  });
  await expectSecurityFailure(pending, "asset_timeout");
  assert.equal(observedSignal.aborted, true);
});

test("signed access refresh changes only access URL and expiry", () => {
  const previous = {
    url: "https://assets.example.test/design.png?signature=old-private-canary",
    expiresAt: 1_800_000_000_000,
    approved: approvedIdentity
  };
  const refreshed = {
    url: "https://assets.example.test/design.png?signature=new-private-canary",
    expiresAt: 1_800_000_100_000,
    approved: { ...approvedIdentity }
  };
  const result = security.refreshSignedAssetAccess({
    previous, refreshed, allowedHosts: ["assets.example.test"], now: 1_800_000_000_001
  });
  assert.equal(result.url, refreshed.url);
  assert.equal(result.expiresAt, refreshed.expiresAt);
  assert.deepEqual(result.approved, approvedIdentity);
  assert.equal(JSON.stringify(security.redactSensitive({ signedAssetUrl: result.url })).includes("private-canary"), false);

  for (const changed of [
    { ...approvedIdentity, sha256: `sha256:${"a".repeat(64)}` },
    { ...approvedIdentity, termsFingerprint: "sha256:other-terms" },
    { ...approvedIdentity, byteLength: approvedIdentity.byteLength + 1 },
    { ...approvedIdentity, contentType: "image/jpeg" }
  ]) {
    assert.throws(() => security.refreshSignedAssetAccess({
      previous, refreshed: { ...refreshed, approved: changed }, allowedHosts: ["assets.example.test"], now: 1_800_000_000_001
    }), (error) => error instanceof security.SecurityBoundaryError && error.code === "refresh_changed_approval");
  }
  assert.throws(() => security.refreshSignedAssetAccess({
    previous, refreshed: { ...refreshed, url: "https://evil.example.test/design.png?signature=private-canary" },
    allowedHosts: ["assets.example.test"], now: 1_800_000_000_001
  }), (error) => error instanceof security.SecurityBoundaryError && error.code === "refresh_changed_approval");
});

test("callback ingress requires a verifier or explicit unverified-hint policy", async () => {
  const { state, replayStore } = callbackDependencies();
  let parsed = 0;
  const parseHint = (body) => { parsed += 1; return JSON.parse(new TextDecoder().decode(body)); };
  const base = {
    providerId: "fixture-provider", mode: "simulated", trustedScope: scope,
    headers: { "X-Test": "safe", "X-Callback-Token": "private-canary" }, rawBody: callbackBytes(),
    maxBodyBytes: 1024, parseHint, replayStore
  };
  await expectSecurityFailure(security.ingestProviderCallback({ ...base, allowUnverifiedHints: false }), "callback_disabled");
  assert.equal(parsed, 0);
  assert.equal(state.claims.length, 0);

  const unverified = await security.ingestProviderCallback({ ...base, allowUnverifiedHints: true });
  assert.equal(unverified.trust, "unverified");
  assert.equal(unverified.requiresAuthenticatedPoll, true);
  assert.equal(unverified.authoritativeMutationAllowed, false);
  assert.deepEqual(unverified.hint, { eventId: "event-fixture-1", providerRequestId: "request-fixture-1" });
  assert.equal("email" in unverified.hint, false);
  assert.equal(unverified.status, "accepted");

  const duplicate = await security.ingestProviderCallback({ ...base, allowUnverifiedHints: true });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.authoritativeMutationAllowed, false);

  const claimCountBeforeUnsafeHint = state.claims.length;
  await expectSecurityFailure(security.ingestProviderCallback({
    ...base,
    allowUnverifiedHints: true,
    parseHint: () => ({ eventId: "recipient@example.test" })
  }), "callback_invalid");
  assert.equal(state.claims.length, claimCountBeforeUnsafeHint);
});

test("callback verifier is injected, failure does not downgrade, and replay identity is scoped", async () => {
  const { state, replayStore } = callbackDependencies();
  let verifierCalls = 0;
  const verifier = {
    async verify(input) {
      verifierCalls += 1;
      assert.equal(input.headers["x-provider-signature"], "documented-fixture-signature");
      assert.deepEqual(input.trustedScope, scope);
      return true;
    }
  };
  const result = await security.ingestProviderCallback({
    providerId: "fixture-provider", mode: "sandbox", trustedScope: scope,
    headers: { "X-Provider-Signature": "documented-fixture-signature" }, rawBody: callbackBytes(),
    maxBodyBytes: 1024, allowUnverifiedHints: false, verifier,
    parseHint: (body) => JSON.parse(new TextDecoder().decode(body)), replayStore
  });
  assert.equal(result.trust, "verified");
  assert.equal(result.requiresAuthenticatedPoll, false);
  assert.equal(result.authoritativeMutationAllowed, false);
  assert.equal(verifierCalls, 1);

  await expectSecurityFailure(security.ingestProviderCallback({
    providerId: "fixture-provider", mode: "sandbox", trustedScope: scope,
    headers: { "X-Provider-Signature": "wrong-private-canary" }, rawBody: callbackBytes("event-bad"),
    maxBodyBytes: 1024, allowUnverifiedHints: true,
    verifier: { async verify() { return false; } },
    parseHint: (body) => JSON.parse(new TextDecoder().decode(body)), replayStore
  }), "callback_verification_failed");
  assert.equal(state.claims.length, 1);

  const otherScope = await security.ingestProviderCallback({
    providerId: "fixture-provider", mode: "simulated", trustedScope: { tenantId: "tenant-other", projectId: "project-security-fixture" },
    headers: {}, rawBody: callbackBytes(), maxBodyBytes: 1024, allowUnverifiedHints: true,
    parseHint: (body) => JSON.parse(new TextDecoder().decode(body)), replayStore
  });
  assert.equal(otherScope.status, "accepted");
  assert.equal(state.claims.length, 2);
});

test("callback limits reject oversized bodies before verification or parsing", async () => {
  let verifierCalls = 0;
  let parseCalls = 0;
  const { state, replayStore } = callbackDependencies();
  const body = new Uint8Array(16);
  await expectSecurityFailure(security.ingestProviderCallback({
    providerId: "fixture-provider", mode: "simulated", trustedScope: scope, headers: {}, rawBody: body,
    maxBodyBytes: 8, allowUnverifiedHints: true,
    verifier: { async verify() { verifierCalls += 1; return true; } },
    parseHint() { parseCalls += 1; return {}; }, replayStore
  }), "callback_oversized");
  assert.equal(verifierCalls, 0);
  assert.equal(parseCalls, 0);
  assert.equal(state.claims.length, 0);
});

test("diagnostic redaction removes nested PII, secrets, signed URLs, and raw errors", () => {
  const raw = {
    headers: { Authorization: "Bearer private-canary", "X-Api-Key": "private-canary", Cookie: "session=private-canary", auth: "private-canary" },
    providerPayload: {
      shippingAddress: { line1: "private-canary street", email: "private-canary@example.test", phone: "+15555550123" },
      destination: { contactName: "private-canary", token: "private-canary" }
    },
    signedAssetUrl: "https://assets.example.test/file.png?X-Amz-Signature=private-canary",
    trace: { url: "https://assets.example.test/private-canary" },
    message: "Bearer private-canary; mail private-canary@example.test; token=private-canary",
    error: new Error("private-canary raw provider error")
  };
  const redacted = security.redactSensitive(raw);
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes("private-canary"), false);
  assert.equal(serialized.includes("assets.example.test"), false);
  assert.equal(serialized.includes("555550123"), false);
  assert.equal(redacted.error.type, "Error");

  const safeError = security.safeSecurityDiagnostic(new Error("private-canary raw provider error"), "diag-FC11-01");
  assert.deepEqual(safeError, {
    code: "internal_failure",
    diagnosticReference: "diag-FC11-01",
    safeMessage: "The security operation failed."
  });
  assert.equal(JSON.stringify(safeError).includes("private-canary"), false);
  const boundaryError = new security.SecurityBoundaryError("asset_timeout", "bad private-canary ref");
  assert.equal(Object.isFrozen(boundaryError), true);
  assert.equal(JSON.stringify(boundaryError.toJSON()).includes("private-canary"), false);
  assert.throws(() => { boundaryError.diagnosticReference = "private-canary"; }, TypeError);
});

let failures = 0;
for (const [name, run] of cases) {
  try {
    await run();
    process.stdout.write(`PASSED ${name}\n`);
  } catch {
    failures += 1;
    process.stdout.write(`FAILED ${name}\n`);
  }
}
process.stdout.write(`Security fixture suite: ${cases.length - failures}/${cases.length} passed\n`);
if (failures > 0) process.exitCode = 1;
