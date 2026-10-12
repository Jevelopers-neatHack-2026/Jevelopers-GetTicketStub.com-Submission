# Tombstone fingerprint key management

**Status:** implemented as a private package helper with synthetic offline fixtures. No secret manager is connected and no key has been provisioned. Provisioning the key set in the host's approved server-side secret manager is an owner action ([getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27)).

[Security](security.md) requires a stable, server-held tombstone fingerprint key. The key must be separate from supplier API credentials, and every key version must stay available until all tombstones created with it expire. `createTombstoneFingerprintKeyring` in `src/security.ts` implements that key. It plugs into `purgeSensitiveRecord` as the existing `TombstoneFingerprinter` port.

## What it does

- **Versioned HMAC.** Each fingerprint is HMAC-SHA256, base64url, over `fulfillment-connectors/tombstone-fingerprint/v1`, the key version, the purpose (`authorization_action` or `idempotency_key`) and the canonical identity, separated by newlines. The result is `{ keyVersion, digest }`. The key version is inside the HMAC input, so a digest cannot be relabelled as another version's.
- **Verification across versions.** `matches` checks a stored fingerprint in constant time (WebCrypto `verify`) against its own version. That version can be the active key or a retired key still inside retention. `candidates` returns one fingerprint per verifiable version, active first, for a store lookup across every retained version.
- **Fail closed.** A missing source, a missing or empty key set, zero or several active keys, a key under 32 bytes, duplicate versions or key bytes, a retired key without `retiredAt`, a future timestamp, an unknown field, and an over-age active key all fail as `retention_unavailable`. So does a stored fingerprint whose version the source no longer returns. That is a configuration fault, never "no tombstone", because answering `false` could make a deleted purchase action reusable.
- **No key exposure.** Key bytes are copied, imported as non-extractable WebCrypto keys and zeroed. They are never returned, serialized, logged or included in errors. `status()` reports versions and rotation state only.

## Host injection (no new environment variables)

The package reads no environment variables and defines no configuration name for this key. The host passes:

- a `FingerprintKeySource` whose `load({ keyringReference })` resolves the **complete** key set from the approved server-side secret manager on every call (no caching across rotation): `{ keys: [{ keyVersion, key: Uint8Array, state: "active" | "retired", activatedAt, retiredAt? }] }`;
- a `keyringReference` naming that key set by reference, never by value, following the provider secret-reference style (for example `fulfillment/tombstone-fingerprint/keyset`);
- a `policy` with the approved `retiredKeyRetentionMs`.

A multi-version binary key set does not fit one environment variable, so no `.env` binding is proposed. If the owner wants one, its name and encoding are an owner decision to add to `.env.example`.

## Policy

| Setting | Default | Enforced in code |
| --- | --- | --- |
| `rotationIntervalMs` (scheduled rotation) | 90 days | `status().rotationDue` turns true |
| `maxActiveKeyAgeMs` (hard limit) | 180 days | `fingerprint` fails closed. `matches` and `candidates` keep working, so existing tombstones stay enforceable |
| `retiredKeyRetentionMs` | **none: required** | Creation fails with `retention_policy_invalid` without it. A retired key verifies until `retiredAt + retiredKeyRetentionMs` and is then reported `purgeable` |
| Tombstone lifetime | n/a | `purgeSensitiveRecord` with a keyring refuses `retainUntil > now + retiredKeyRetentionMs` (`retention_policy_invalid`) |
| Key size | 32–1024 bytes | Load fails closed outside the range |
| Versions per key set | 16 | Load and rotation planning fail closed above it |

The retention invariant: a tombstone is fingerprinted while its key is active. It must expire by `now + retiredKeyRetentionMs`, and the key stays verifiable until `retiredAt + retiredKeyRetentionMs`, where `retiredAt ≥ now`. So every tombstone expires before its key version is dropped. Set `retiredKeyRetentionMs` to at least the longest approved legal or product tombstone retention. This package still invents no retention period.

## Rotation

`planTombstoneFingerprintKeyRotation({ keys, newKeyVersion, reason, now, policy })` works on metadata only. It refuses records that carry key bytes. It returns the next key set: the new version active, the previous active key retired at `now`, and the retired versions still in retention. It also lists `removableKeyVersions`. It refuses a reused version, zero or several active keys, and a set over 16 versions.

**Scheduled rotation** (when `rotationDue`, at least every 90 days):

1. Generate at least 32 random bytes for a new, never-used version inside the secret manager.
2. Write the planned key set atomically: new key active, previous key retired.
3. The next `load` picks it up. Tombstones made with the previous key keep matching through retention.

**Retired-key retention and removal:**

1. When a version appears in `purgeableKeyVersions` or `removableKeyVersions`, first delete or confirm expired every tombstone with that `keyVersion`.
2. Only then remove the key from the secret manager. A version removed early makes `matches` fail closed rather than silently answer "no tombstone".

**Incident rotation** (suspected exposure of a fingerprint key):

1. Rotate immediately with `reason: "incident"`, whatever the age of the key.
2. Keep the exposed key **retired, not deleted**. Deleting it would stop deleted purchase actions from being recognized and make them reusable. An exposed fingerprint key lets someone test guessed identities against tombstones; it does not grant ordering authority.
3. Re-fingerprint retained tombstones with the new key if the store can do so atomically. Then shorten the exposed version's life by removing it once none of its tombstones remain.
4. Record the incident without key material in the private incident log.

Rotating a supplier API credential never changes this key or any action or idempotency fingerprint.

## Not provided

There is no secret manager, key generation, key-set storage, tombstone store or re-fingerprint job, and no evidence of a provisioned key. These remain host and owner work.
