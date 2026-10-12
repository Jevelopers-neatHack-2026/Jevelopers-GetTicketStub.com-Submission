# Tombstone fingerprint key management

**Status:** implemented as a private package helper with synthetic offline fixtures. No secret manager is connected and no key has been provisioned. Provisioning the key set in the host's approved server-side secret manager is an owner action ([getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27)).

[Security](security.md) requires a stable, server-held tombstone fingerprint key. The key must be separate from supplier API credentials, and every key version must stay available until all tombstones created with it expire. `createTombstoneFingerprintKeyring` in `src/security.ts` implements that key. It plugs into `purgeSensitiveRecord` as the existing `TombstoneFingerprinter` port.

## What it does

- **Versioned HMAC.** Each fingerprint is HMAC-SHA256, base64url, over `fulfillment-connectors/tombstone-fingerprint/v1`, the key version, the purpose (`authorization_action` or `idempotency_key`) and the canonical identity, separated by newlines. The key version is inside the HMAC input, so a digest cannot be relabelled as another version's. Identities must be well-formed UTF-16 (no lone surrogates), so two distinct identities can never encode to the same bytes.
- **Issued with a retention bound.** `fingerprint` returns `{ keyVersion, digest, maxRetainUntil }`. `maxRetainUntil` is `now + retiredKeyRetentionMs - maxClockSkewMs`: the latest `retainUntil` a tombstone storing that fingerprint may use, because the issuing key stays verifiable at least that long. The bound is data on the result, so it survives a logging or metrics wrapper. `purgeSensitiveRecord` requires it from every `TombstoneFingerprinter`: a result without it fails as `retention_unavailable`, and a `retainUntil` above it fails as `retention_policy_invalid`. The tombstone stores only `{ keyVersion, digest }`. **Trust model:** `maxRetainUntil` is trusted data from the fingerprinter. It guards against mistakes (a wrong `retainUntil`, a wrapper that drops the bound), not against a hostile wrapper: a wrapper can raise it and `purgeSensitiveRecord` cannot tell. That case is covered by the backstop below, where a tombstone that outlives its key makes `matches` and `candidates` fail closed.
- **Verification across versions.** `matches` checks a stored fingerprint in constant time (WebCrypto `verify`) against its own version. That version can be the active key or a retired key still inside retention. Only the canonical base64url digest is accepted, so a store that looks up by digest string agrees with `matches`. `candidates` returns one fingerprint per verifiable version, active first, for a store lookup across every retained version. While the key set still holds a version past its retention window (`status().purgeableKeyVersions` is non-empty), `candidates` throws `retention_unavailable` instead of leaving that version out: a lookup that skipped it would read a live tombstone under it as "never deleted". Lookups resume once the host has purged that version's tombstones and removed it from the set (see [Retired-key removal](#rotation)). A store must look up only through `candidates` or `matches`, and must not compute digests itself.
- **Fail closed, never false.** A missing source, a missing or empty key set, zero or several active keys, a key under 32 bytes or with 16 or fewer distinct byte values, duplicate versions or key bytes, a broken rotation chain, a timestamp more than `maxClockSkewMs` in the future, an unknown field, and an over-age active key all fail as `retention_unavailable`. So does a stored fingerprint whose version is unknown **or past its retention window**. Such a tombstone outlived its key, which breaks the retention invariant; it is a fault, never "no tombstone", because answering `false` could make a deleted purchase action reusable.
- **No key exposure.** Key bytes are copied, imported as non-extractable WebCrypto keys and zeroed. They are never returned, serialized, logged or included in errors. `status()` reports versions and rotation state only.

## Host injection (no new environment variables)

The package reads no environment variables and defines no configuration name for this key. The host passes:

- a `FingerprintKeySource` whose `load({ keyringReference })` resolves the **complete** key set from the approved server-side secret manager on every call (no caching across rotation): `{ keys: [{ keyVersion, key: Uint8Array, state: "active" | "retired", activatedAt, retiredAt? }] }`. Pass raw key bytes: decode a hex or base64 secret before passing it. ASCII hex text passed as bytes carries half the entropy and is rejected;
- a `keyringReference` naming that key set by reference, never by value, following the provider secret-reference style (for example `fulfillment/tombstone-fingerprint/keyset`);
- a `policy` with the approved `retiredKeyRetentionMs`;
- optionally `minActiveGeneration`, the persisted `highWaterGeneration` (see [rebuilds and restores](#key-versions-and-the-rotation-chain)).

A multi-version binary key set does not fit one environment variable, so no `.env` binding is proposed. If the owner wants one, its name and encoding are an owner decision to add to `.env.example`.

## Policy

Overridable defaults are exported as `TOMBSTONE_FINGERPRINT_KEY_POLICY_DEFAULTS`; hard limits that no policy can override are exported separately as `TOMBSTONE_FINGERPRINT_KEY_LIMITS`.

| Setting | Default | Bound | Enforced in code |
| --- | --- | --- | --- |
| `rotationIntervalMs` (scheduled rotation) | 90 days | ≤ `maxActiveKeyAgeMs` | `status().rotationDue` turns true |
| `maxActiveKeyAgeMs` | 180 days | | `fingerprint` fails closed. `matches` and `candidates` keep working, so existing tombstones stay enforceable |
| `retiredKeyRetentionMs` | **none: required** | > `maxClockSkewMs`, ≤ 100 years (`TOMBSTONE_FINGERPRINT_KEY_LIMITS.maxRetiredKeyRetentionMs`, hard) | Creation fails with `retention_policy_invalid` without it. A retired key verifies until `retiredAt + retiredKeyRetentionMs + maxClockSkewMs` and is then `purgeable`. The 100-year cap keeps `maxRetainUntil` and every purge time a safe integer, so an oversized value fails at creation instead of making every purge fail later |
| `maxKeyVersions` | 64 | 2–256 | Creation fails unless `ceil((retiredKeyRetentionMs + maxClockSkewMs) / rotationIntervalMs) + 2 ≤ maxKeyVersions`. A **scheduled** rotation is refused above it (removable versions not counted), and also before the active key is `rotationIntervalMs` old, so scheduled rotations can never run faster than the cadence the formula assumes. It never applies to loading, verification or incident rotation |
| `maxClockSkewMs` | 5 minutes | 0–60 minutes | Key timestamps up to this far in the future are accepted |
| Key size | | 32–1024 bytes, more than 16 distinct byte values | Load fails closed otherwise |
| Versions per key set | | 256 (hard) | Load and every rotation fail closed above it |

**Capacity.** With 90-day rotation the default cap of 64 fits retention up to about 15 years (`62 × 90` days, less the skew). A 7-year retention needs 31 versions. A policy that cannot fit, for example 7 years with `maxKeyVersions: 16`, fails when the keyring or plan is created, not years later. Incident rotations add versions beyond the cadence. They are never refused by the policy cap or by key age, and a set above the cap still loads and verifies; only the hard limit of 256 stops a set. The `+ 2` in the formula leaves `maxKeyVersions − ceil((retiredKeyRetentionMs + maxClockSkewMs) / rotationIntervalMs) − 1` versions of headroom for incidents within one retention window (one version at the default formula with the cap set exactly to it). Once the incidents inside a retention window exceed that headroom, scheduled rotations are refused until older versions become removable; rotate with `reason: "incident"` meanwhile, or raise `maxKeyVersions`.

**The retention invariant.** A tombstone is fingerprinted while its key is active and must use `retainUntil ≤ maxRetainUntil = now + retiredKeyRetentionMs - maxClockSkewMs`. The key stays verifiable until `retiredAt + retiredKeyRetentionMs + maxClockSkewMs`, where `retiredAt` is at or after issuance. **`retainUntil` is exclusive:** the tombstone is live while `now < retainUntil` and expired from `now = retainUntil`, and the key is purgeable from `now = retiredAt + retiredKeyRetentionMs + maxClockSkewMs`. A store must treat `retainUntil` as exclusive in the same way. With host clocks within `maxClockSkewMs` of each other, a live tombstone never meets a purgeable key, and if it ever does, `matches` and `candidates` throw. Set `retiredKeyRetentionMs` to at least the longest approved legal or product tombstone retention. This package still invents no retention period.

**Clock skew.** Hosts may disagree by up to `maxClockSkewMs`. A worker whose clock is behind the rotating host keeps fingerprinting and verifying through the rotation; beyond the tolerance the set fails closed. Set `maxClockSkewMs: 0` for strict checks. The rotation planner applies **no** skew: its `now` must be strictly after the active key's `activatedAt` and not before any recorded timestamp, and a scheduled plan needs the full `rotationIntervalMs` on the planner's own clock. A host up to `maxClockSkewMs` behind the host that last rotated gets `retention_policy_invalid` (also for an incident rotation) until its clock catches up. This is deliberate and safe; run the planner on one host, or retry after the skew has passed.

## Key versions and the rotation chain

A key version is `<label>-g<generation>`, for example `tombstone-g7`. The label is 1–48 characters of `[A-Za-z0-9._-]`; the generation is a positive integer without leading zeros. Every load and plan checks that the set is one rotation chain. Ordered by generation:

- generations are unique, and activation times strictly increase;
- exactly the newest generation is active;
- every retired key's `retiredAt` equals its successor's `activatedAt`.

So a hand-edited `retiredAt` earlier than the moment the successor took over (a backdated retirement), a gap or overlap, or a removed older generation reissued as active **alongside the newer versions** all fail closed.

**Rebuilds and restores.** The chain check only sees the set it is given. If a key set is rebuilt from scratch (disaster recovery, a lost secret, a lost high-water mark) and reuses the old label, a fresh `tombstone-g1` loads without error, and an old `tombstone-g1` tombstone then gets `matches → false`. The loader cannot detect this from the set alone. After a rebuild the host must either use a **new `keyVersionLabel`**, or continue from the persisted `highWaterGeneration` (pass it to the planner so the next version is above it). `highWaterGeneration` is what prevents reuse after a reset; during normal operation the chain already keeps generations increasing. As an extra guard, pass the persisted mark to `createTombstoneFingerprintKeyring({ minActiveGeneration })`: a set whose active generation is below it fails closed as `retention_unavailable`. The chain timestamps remain trusted host metadata: a history backdated consistently in both timestamps cannot be detected. It still cannot negate a live tombstone, because a version past retention makes `matches` throw instead of answering `false`.

## Rotation

`planTombstoneFingerprintKeyRotation({ keys, reason, now, policy, highWaterGeneration?, keyVersionLabel? })` works on metadata only. It refuses records that carry key bytes and a set that is not a valid chain. It derives the new version: the next generation after both the newest generation in the set and the persisted `highWaterGeneration`, with the active key's label unless `keyVersionLabel` is given. Generations only increase, so a removed version is never reissued while the set or the persisted `highWaterGeneration` remembers it (see rebuilds and restores above). A `highWaterGeneration` behind the set is refused as inconsistent history. A `scheduled` plan is refused before the active key is `rotationIntervalMs` old; an `incident` plan is allowed at any age.

The plan has two separate outputs:

- `keys`: the **next set**, newest first. The new version is active, the previous active key is retired at `now`, and every other retired version is kept, including removable ones.
- `removableKeyVersions`: retired versions past retention, **oldest first**, which may be dropped **only after** their tombstones are purged.

It also returns `newActiveKeyVersion` and `highWaterGeneration`, which the host persists.

**Scheduled rotation** (when `rotationDue`, at least every 90 days):

1. Generate at least 32 random bytes for `newActiveKeyVersion` inside the secret manager.
2. Write `plan.keys` atomically: new key active, previous key retired, removable keys still present. Persist `plan.highWaterGeneration`.
3. The next `load` picks it up. Tombstones made with the previous key keep matching through retention.

**Retired-key removal** (a separate step, after the rotation is written):

1. For each version in `removableKeyVersions` (or `status().purgeableKeyVersions`), first delete or confirm expired every tombstone with that `keyVersion`.
2. Only then remove the key from the set in the secret manager. Both lists are **oldest first**. Remove versions in that order, one at a time, or all in one write: removable versions are always the oldest generations, so each intermediate set is still a valid chain. Removing a newer removable version before an older one leaves a gap, and every operation then fails closed until the older one is removed too.
3. A key becomes purgeable at `retiredAt + retiredKeyRetentionMs + maxClockSkewMs`, without a rotation, and `candidates` fails closed from that moment until the version is removed. Compute that time from the chain metadata ahead of time and do steps 1 and 2 promptly, so store lookups are not blocked for long. By the retention invariant, tombstones that followed `maxRetainUntil` have already expired by then.
4. Never remove a version that is not yet removable. `matches` on its tombstones fails closed (unknown version), but `candidates` cannot know about a version that is no longer in the set, so a lookup would miss its live tombstones. The same applies to a key source that serves an outdated set.

**Incident rotation** (suspected exposure of a fingerprint key):

1. Rotate immediately with `reason: "incident"`, whatever the age of the key and whatever `maxKeyVersions` says.
2. Keep the exposed key **retired, not deleted**, until it becomes removable. Deleting it would stop deleted purchase actions from being recognized, and it would break the rotation chain. An exposed fingerprint key lets someone test guessed identities against tombstones; it does not grant ordering authority, and removing it from the secret manager would not undo the exposure.
3. Re-fingerprint retained tombstones with the new key if the store can do so atomically, so lookups no longer depend on the exposed version.
4. Record the incident without key material in the private incident log.

Rotating a supplier API credential never changes this key or any action or idempotency fingerprint.

## Not provided

There is no secret manager, key generation, key-set storage, tombstone store or re-fingerprint job, and no evidence of a provisioned key. These remain host and owner work.
