# FC-11 local security boundaries

**Status:** private, provider-neutral policy helpers for the FC-11.1–3 development slice. This file and `src/security.ts` are not connected to the public package entry point, provider adapter, runtime submit path, verifier wrapper, or CI. Local fixtures establish the behavior of injected ports only. They do not establish production security, cross-repository conformance, or FC-11 closure.

No accepted upstream SC8 artifact, provider callback specification, encrypted store, secret manager, replay database, or sandbox account is available in this checkout. Do not invent those integrations or claim the local fixtures provide them.

## Tenant and project scoped data

`resolveEncryptedScopedReference` accepts an opaque reference and a trusted scope supplied by authenticated server ingress. It sends both tenant and project IDs to the encrypted-store port, checks the returned record against both IDs, and calls the decryptor only after that check. Missing records, cross-scope rows, storage errors, and decrypt errors share a safe unavailable result. The port must enforce scope predicates in its lookup; the local post-check is defense in depth.

The storage port returns ciphertext and a key version. The implementation does not provide encryption. Production storage must encrypt sensitive values at rest, bind ciphertext to tenant/project and purpose as authenticated encryption data, keep decryption keys server-side, restrict the decrypting service identity, and avoid plaintext caches and logs. The selected storage, key lifecycle, backup, access audit, and deletion controls remain unverified.

`minimizeProviderPayload` projects only fields listed by the caller. Nested objects and arrays require a nested selection; selecting a whole object is rejected. Callers should define a reviewed per-operation field policy and pass only the values needed by that supplier action. A field such as a delivery address may be explicitly included in the outbound order; it must still be excluded from logs, traces, errors, and evidence.

`purgeSensitiveRecord` creates a tombstone containing tenant/project scope, a keyed authorization/action fingerprint, a keyed idempotency-key fingerprint, and deletion/retention times. It passes that tombstone and the sensitive record reference to one retention-port operation. The production port must atomically erase personal fields and retain the tombstone so deletion cannot make a purchase action reusable. Configure the retention deadline from an approved legal/product policy; this helper intentionally invents no retention period.

Use a stable, server-held tombstone fingerprint key that is separate from supplier API credentials. Keep the fingerprint key version available until all tombstones created with it expire, or make the store query every retained key version. Rotating a supplier credential must not change action or idempotency fingerprints. The fixture fingerprinter is test-only, not cryptographic storage.

## Supplier credentials and modes

`withServerSecret` resolves a credential from an injected server-side secret source for the exact `simulated` or `sandbox` mode on every operation. A mismatched lease, missing secret, invalid mode, or source failure stops before the callback. The secret is exposed only to that callback; returned values and errors must not include it. The helper does not cache credentials or provide a `live` mode.

The application must bind each provider/mode pair to a distinct secret reference in its approved secret manager. Rotate supplier API credentials without changing the stable authorization/action claim or tombstone identity. During rotation, make the new credential available before revoking the old credential, preserve unresolved attempt identity, and do not retry an uncertain purchase merely because a credential changed. A real secret manager and provider rotation procedure are not present here.

## Remote asset retrieval and signed access

`retrieveApprovedAsset` is a policy layer around injected DNS and HTTP ports; it performs no network access by itself. It accepts HTTPS on port 443 only, rejects URL userinfo and fragments, and allows exact ASCII hostnames from a caller-owned allowlist. Wildcards, IP-literal hosts, unapproved hosts, and all unapproved redirect targets are rejected.

For every hop it resolves the hostname, rejects the entire answer set if any result is private, loopback, link-local, reserved, multicast, or otherwise outside the supported public ranges, and passes the validated addresses to the transport with manual redirects and the hostname required for TLS verification. The transport must connect only to one of those pinned addresses, preserve certificate validation for the requested hostname, report the connected peer address, never follow redirects itself, avoid unbounded body buffering, and close or cancel redirect response bodies. The helper rejects peer mismatches. The transport port is part of the security boundary and still requires an implementation review before production use.

The default local media allowlist is limited to PNG, JPEG, and WebP. The helper checks the declared media type, content length when present, actual streamed byte count, file signature, redirect count, and total time. The hard limits are 20 MiB, five redirects, and 30 seconds; callers set stricter per-operation limits. Timeout aborts the injected operation. The result includes the bytes, media type, SHA-256 digest, length, final approved host, and redirect count; it omits the signed URL.

`refreshSignedAssetAccess` accepts a refreshed URL and expiry only when the artifact ID, approved content digest, media type, byte length, and terms fingerprint exactly match the previous approval and both URLs use approved hosts. `assertRetrievedAssetMatchesApproval` hashes the current bytes again before use so mutation after retrieval is detected. Callers must validate the exact retrieved bytes against the approved identity immediately before dispatch. The refreshed URL remains a credential: do not persist it in diagnostics or expose it to clients.

Only supported public address ranges are accepted. This deliberately fails closed for unusual or special-use addressing; add an exception only through a reviewed host/network policy and a corresponding threat analysis. DNS resolution and the request use injected ports in tests; no provider or asset host is contacted by the fixture suite.

## Callback trust

`ingestProviderCallback` requires a caller-injected verifier that implements the selected supplier's documented authenticity method. This module defines no signature header, digest, secret derivation, timestamp tolerance, or provider algorithm. A verifier failure is rejected and cannot be downgraded to an unverified hint.

Without a verifier, callbacks are disabled by default. An application can explicitly allow unverified hints; the result then requires authenticated polling and always has `authoritativeMutationAllowed: false`. The parser can contribute only a bounded event ID and optional provider request ID; other body fields are discarded. The raw body limit is at most 1 MiB. Replay claims are scoped by provider, tenant, project, and event ID, and the injected store must claim atomically across workers and restarts.

The helper emits observations, not order-state mutations. Even an authenticated callback remains subject to an accepted provider event contract and a provider-specific consumer. No supplier callback format, signature, replay store, or event-to-order mapping is implemented here.

## Diagnostics and evidence

Use `safeSecurityDiagnostic` for error reporting. It returns only an allowlisted security code, a bounded diagnostic reference, and a fixed safe message; it never copies an exception message or stack. `redactSensitive` recursively removes fields whose names indicate addresses, contacts, credentials, tokens, URLs, and payment data; it also scrubs URLs, bearer tokens, email addresses, and common secret query parameters from strings. Treat this redactor as a secondary safeguard: it cannot reliably detect an address embedded in arbitrary prose. Do not log raw provider errors, callback bodies, request headers, credential leases, or signed URLs.

Sanitized evidence should include only mode, provider fixture identity, test result, safe error code, and synthetic diagnostic reference. Keep full addresses, contacts, credentials, access tokens, signed URLs, and raw provider responses out of tracked files and public reports.

## Local module checks

`tests/security-suite.mjs` runs against a compiled isolated copy of `src/security.ts` and uses synthetic addresses, keys, callbacks, DNS answers, and transport responses. It does not invoke a provider, fetch an asset, or contact another repository. A passing run is only a local fixture result.

The repository's stable verifier currently has only contract, sandbox, and release suites. FC-02 owns shared package exports, verifier integration, and CI wiring. Keep the issue's future security-verifier acceptance pending until that integration is reviewed and wired.
