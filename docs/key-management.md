# Tombstone fingerprint key management

**Status:** implemented as a private package helper with synthetic offline fixtures. No secret manager is connected and no key has been provisioned. Provisioning the key set in the host's approved server-side secret manager is an owner action ([getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27)).

[Security](security.md) requires a stable, server-held tombstone fingerprint key. The key must be separate from supplier API credentials, and every key version must stay available until all tombstones created with it expire. `createTombstoneFingerprintKeyring` in `src/security.ts` implements that key. It plugs into `purgeSensitiveRecord` as the existing `TombstoneFingerprinter` port.

## What it does

- **Versioned HMAC.** Each fingerprint is HMAC-SHA256, base64url, over `fulfillment-connectors/tombstone-fingerprint/v1`, the key version, the purpose (`authorization_action` or `idempotency_key`) and the canonical identity, separated by newlines. The key version is inside the HMAC input, so a digest cannot be relabelled as another version's. Identities must be well-formed UTF-16 (no lone surrogates), so two distinct identities can never encode to the same bytes.
- **Issued with a retention bound.** `fingerprint` returns `{ keyVersion, digest, maxRetainUntil }`. `maxRetainUntil` is `now + retiredKeyRetentionMs - maxClockSkewMs`: the latest `retainUntil` a tombstone storing that fingerprint may use, because the issuing key stays verifiable at least that long. The bound is data on the result, so it survives a logging or metrics wrapper. `purgeSensitiveRecord` requires it from every `TombstoneFingerprinter`: a result without it fails as `retention_unavailable`, and a `retainUntil` above it fails as `retention_policy_invalid`. The tombstone stores only `{ keyVersion, digest }`.
- **Verification across versions.** `matches` checks a stored fingerprint in constant time (WebCrypto `verify`) against its own version. That version can be the active key or a retired key still inside retention. Only the canonical base64url digest is accepted, so a store that looks up by digest string agrees with `matches`. `candidates` returns one fingerprint per verifiable version, active first, for a store lookup across every retained version.
- **Fail closed, never false.** A missing source, a missing or empty key set, zero or several active keys, a key under 32 bytes or with 16 or fewer distinct byte values, duplicate versions or key bytes, a broken rotation chain, a timestamp more than `maxClockSkewMs` in the future, an unknown field, and an over-age active key all fail as `retention_unavailable`. So does a stored fingerprint whose version is unknown **or past its retention window**. Such a tombstone outlived its key, which breaks the retention invariant; it is a fault, never "no tombstone", because answering `false` could make a deleted purchase action reusable.
- **No key exposure.** Key bytes are copied, imported as non-extractable WebCrypto keys and zeroed. They are never returned, serialized, logged or included in errors. `status()` reports versions and rotation state only.

## Host injection (no new environment variables)

The package reads no environment variables and defines no configuration name for this key. The host passes:

- a `FingerprintKeySource` whose `load({ keyringReference })` resolves the **complete** key set from the approved server-side secret manager on every call (no caching across rotation): `{ keys: [{ keyVersion, key: Uint8Array, state: "active" | "retired", activatedAt, retiredAt? }] }`. Pass raw key bytes: decode a hex or base64 secret before passing it. ASCII hex text passed as bytes carries half the entropy and is rejected;
- a `keyringReference` naming that key set by reference, never by value, following the provider secret-reference style (for example `fulfillment/tombstone-fingerprint/keyset`);
- a `policy` with the approved `retiredKeyRetentionMs`.

A multi-version binary key set does not fit one environment variable, so no `.env` binding is proposed. If the owner wants one, its name and encoding are an owner decision to add to `.env.example`.

## Policy

Overridable defaults are exported as `TOMBSTONE_FINGERPRINT_KEY_POLICY_DEFAULTS`; hard limits that no policy can override are exported separately as `TOMBSTONE_FINGERPRINT_KEY_LIMITS`.

| Setting | Default | Bound | Enforced in code |
| --- | --- | --- | --- |
| `rotationIntervalMs` (scheduled rotation) | 90 days | ≤ `maxActiveKeyAgeMs` | `status().rotationDue` turns true |
| `maxActiveKeyAgeMs` | 180 days | | `fingerprint` fails closed. `matches` and `candidates` keep working, so existing tombstones stay enforceable |
| `retiredKeyRetentionMs` | **none: required** | > `maxClockSkewMs` | Creation fails with `retention_policy_invalid` without it. A retired key verifies until `retiredAt + retiredKeyRetentionMs + maxClockSkewMs` and is then `purgeable` |
| `maxKeyVersions` | 64 | 2–256 | Creation fails unless `ceil((retiredKeyRetentionMs + maxClockSkewMs) / rotationIntervalMs) + 2 ≤ maxKeyVersions`. A **scheduled** rotation is refused above it (removable versions not counted). It never applies to loading, verification or incident rotation |
| `maxClockSkewMs` | 5 minutes | 0–60 minutes | Key timestamps up to this far in the future are accepted |
| Key size | | 32–1024 bytes, more than 16 distinct byte values | Load fails closed otherwise |
| Versions per key set | | 256 (hard) | Load and every rotation fail closed above it |

**Capacity.** With 90-day rotation the default cap of 64 fits retention up to about 15 years (`62 × 90` days, less the skew). A 7-year retention needs 31 versions. A policy that cannot fit, for example 7 years with `maxKeyVersions: 16`, fails when the keyring or plan is created, not years later. Incident rotations add versions beyond the cadence. They are never refused by the policy cap, and a set above it still loads and verifies; only the hard limit of 256 stops a set.

**The retention invariant.** A tombstone is fingerprinted while its key is active and must use `retainUntil ≤ maxRetainUntil = now + retiredKeyRetentionMs - maxClockSkewMs`. The key stays verifiable until `retiredAt + retiredKeyRetentionMs + maxClockSkewMs`, where `retiredAt` is at or after issuance. **`retainUntil` is exclusive:** the tombstone is live while `now < retainUntil` and expired from `now = retainUntil`, and the key is purgeable from `now = retiredAt + retiredKeyRetentionMs + maxClockSkewMs`. A store must treat `retainUntil` as exclusive in the same way. With host clocks within `maxClockSkewMs` of each other, a live tombstone never meets a purgeable key, and if it ever does, `matches` throws. Set `retiredKeyRetentionMs` to at least the longest approved legal or product tombstone retention. This package still invents no retention period.

**Clock skew.** Hosts may disagree by up to `maxClockSkewMs`. A worker whose clock is behind the rotating host keeps fingerprinting and verifying through the rotation; beyond the tolerance the set fails closed. Set `maxClockSkewMs: 0` for strict checks.

## Key versions and the rotation chain

A key version is `<label>-g<generation>`, for example `tombstone-g7`. The label is 1–48 characters of `[A-Za-z0-9._-]`; the generation is a positive integer without leading zeros. Every load and plan checks that the set is one rotation chain. Ordered by generation:

- generations are unique, and activation times strictly increase;
- exactly the newest generation is active;
- every retired key's `retiredAt` equals its successor's `activatedAt`.

So a hand-edited `retiredAt` earlier than the moment the successor took over (a backdated retirement), a gap or overlap, or a removed older generation reissued as active all fail closed. The chain timestamps remain trusted host metadata: a history backdated consistently in both timestamps cannot be detected. It still cannot negate a live tombstone, because a version past retention makes `matches` throw instead of answering `false`.

## Rotation

`planTombstoneFingerprintKeyRotation({ keys, reason, now, policy, highWaterGeneration?, keyVersionLabel? })` works on metadata only. It refuses records that carry key bytes and a set that is not a valid chain. It derives the new version: the next generation after both the newest generation in the set and the persisted `highWaterGeneration`, with the active key's label unless `keyVersionLabel` is given. Generations only increase, so a removed version is never reissued. A `highWaterGeneration` behind the set is refused as inconsistent history.

The plan has two separate outputs:

- `keys`: the **next set**, newest first. The new version is active, the previous active key is retired at `now`, and every other retired version is kept, including removable ones.
- `removableKeyVersions`: retired versions past retention, which may be dropped **only after** their tombstones are purged.

It also returns `newActiveKeyVersion` and `highWaterGeneration`, which the host persists.

**Scheduled rotation** (when `rotationDue`, at least every 90 days):

1. Generate at least 32 random bytes for `newActiveKeyVersion` inside the secret manager.
2. Write `plan.keys` atomically: new key active, previous key retired, removable keys still present. Persist `plan.highWaterGeneration`.
3. The next `load` picks it up. Tombstones made with the previous key keep matching through retention.

**Retired-key removal** (a separate step, after the rotation is written):

1. For each version in `removableKeyVersions` (or `status().purgeableKeyVersions`), first delete or confirm expired every tombstone with that `keyVersion`.
2. Only then remove the key from the set in the secret manager. Removable versions are always the oldest generations, so the remaining set is still a valid chain. A version removed early makes `matches` fail closed rather than silently answer "no tombstone".

**Incident rotation** (suspected exposure of a fingerprint key):

1. Rotate immediately with `reason: "incident"`, whatever the age of the key and whatever `maxKeyVersions` says.
2. Keep the exposed key **retired, not deleted**, until it becomes removable. Deleting it would stop deleted purchase actions from being recognized, and it would break the rotation chain. An exposed fingerprint key lets someone test guessed identities against tombstones; it does not grant ordering authority, and removing it from the secret manager would not undo the exposure.
3. Re-fingerprint retained tombstones with the new key if the store can do so atomically, so lookups no longer depend on the exposed version.
4. Record the incident without key material in the private incident log.

Rotating a supplier API credential never changes this key or any action or idempotency fingerprint.

## Not provided

There is no secret manager, key generation, key-set storage, tombstone store or re-fingerprint job, and no evidence of a provisioned key. These remain host and owner work.
