# Private asset permission selection and handoff

`src/verification/asset-permissions/` implements a bounded, in-memory EI-08 selection boundary. Its local API is versioned `asset-permission-selection/1`; the request and handoff shapes are private implementation interfaces, not shared-contracts transfer schemas. Local requirement IDs are EI-08 and JEV-EI-01/02/03/05. The contribution is scoped to AGT-01, AGT-04, AGT-05, ART-05, CON-02, CON-03, and FIN-01. Global ownership remains Agent and research for AGT/CON, Creative and fulfillment for ART-05, and Finance and reliability for FIN-01. This component verifies none of those global criteria by itself.

## Selection boundary

The caller supplies an exact request scope: tenant, authenticated scope, organization, occurrence, edition, package version, and intended use. Each candidate repeats those bindings and includes its asset version, source and evidence references, claimed source and transformed hashes, bytes, structured role observation references, and an externally issued approval reference with declared expiry and revocation reference. Inputs are copied from plain data records; getters, proxies, unknown keys, duplicate candidate/asset identities, malformed references, invalid hashes, and oversized batches fail closed with fixed error codes.

The component snapshots each source byte buffer, invokes the existing `inspectSafeAssetBytes` primitive, and only keeps `action: 'transformed'` SVG results. It compares the computed source and transformed hashes with the candidate claims and retains the inspector's immutable transformed snapshot. It never forwards the submitted bytes or uses the source bytes as fallback. Raster input and unsupported SVG features remain excluded under the inspector's `review` behavior; active SVG content is rejected by the inspector without rendering or network access.

The role observation must bind `Q-EI-BRAND-ROLE:v1`, its registry/schema/rubric definition, candidate and asset versions, both hashes, organization and occurrence scope, observation, observer, model, region, uncertainty, and target references. The role text is a recommendation. Only a configured trusted role-evidence adapter can return an exact, current, eligible role with confirmed organization association. `unknown`, `unrelated`, review, missing, malformed, or mismatched observations cannot enter the reference set. The component does not call JEV or accept a Choice answer as permission. The checked-in registry remains `2.1.0-draft.1` with proposed/unapproved policy metadata; an accepted role adapter and policy are still external release preconditions.

## Host authority and handoff

The host must install `readAuthorization`, `verifyPermission`, `recheckPermission`, and `publishHandoff`; role-evidence promotion also requires `verifyRoleEvidence` and `recheckRoleEvidence`. Missing authorities produce an empty original-artwork fallback or a typed denial. The selector never issues approvals and does not treat caller booleans, local records, a public URL, an asset role, or a favorable classification as authority.

The permission verifier is called for every bounded candidate with a transformed snapshot, including candidates whose declared scope differs from the request. Its identity carries the exact requested scope and the candidate's declared tenant/scope/organization/occurrence/edition/package, asset version, source/evidence refs, source hash, transformed hash, intended use, approval ref, expiry, and revocation ref. The local scope check still excludes a mismatched candidate even if an injected verifier says authorized. A rejected or review-only inspection has no transformed hash, so it cannot reach the permission decision or handoff path.

The verifier must check the actual external issuer and approver authority and exact tenant/scope/organization/occurrence/edition/package, asset version, source hash, transformed hash, intended use, expiry, and current revocation state. A permission decision must bind `approvedHash` to the transformed bytes. Approval of different source bytes does not transfer to the transformed snapshot. The returned verifier, issuer, actor, decision, authority, permission, and revocation references remain opaque identifiers; this module does not verify signatures or confer authority locally.

Every awaited role or permission check is followed by a synchronous host authorization refresh and current role/permission revision checks. Handoff consumes a private one-use handle, rechecks the same authenticated principal and exact request, repeats role and permission verification, rechecks current versions after each await, and checks cancellation and deadline before publication. The 60-second handle lifetime is only a short in-memory bound; it grants no continuing permission. A timeout, cancellation, principal change, stale/revoked permission, malformed verifier result, or failed inspection prevents publication of the selected asset set. A failed batch cannot publish a partially validated subset.

Async host verifiers receive the operation's `AbortSignal` and must stop work when it aborts or times out. A detached lookup must not later publish bytes or initiate unmetered paid work. This module bounds how long it waits; it cannot forcibly stop a host callback that ignores cancellation. Any paid work in a future role adapter must preserve its own attempt/request/observation/usage lineage.

The host `publishHandoff` callback is the final authority boundary. It receives only cloned transformed bytes, exact hashes and scope, the latest host revision references, and the current signal/deadline. It must synchronously and atomically revalidate current authentication and permissions at actual dispatch, publishing the exact payload or rejecting without publishing. If the host cannot provide that atomic check, it must reject. This repository has no accepted identity/approval lookup contract or creative dispatch implementation yet, so callback behavior is a required, unverified host precondition. A local unit-test adapter is only a boundary double.

When no candidate qualifies, the explicit payload has mode `original-artwork`, empty `permittedAssets` and `referenceImages`, and no image-generation call. This module performs no persistence, visual classification call, provider call, or financial operation. Its local byte inspection is non-billable. If a future host role adapter performs paid work, that adapter owns its attempt, request, observation, and usage lineage under the agreed metering contract; this module invents no receipt and does not turn unknown usage into zero.

The module bounds each batch to 8 candidates, 1 MiB total source bytes, 128 KiB per source asset (the inspector limit), 1.5 seconds per operation, and 60 seconds per selection handle. Excluded candidate references and fixed diagnostic codes are retained only in bounded private memory for the handle lifetime; they are not returned as a public manifest or persisted.

## Local verification

With Node 22.23.3 and the repository lockfile installed:

```sh
node --test tests/assets/permissions/*.test.mjs
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --types node --skipLibCheck false tests/assets/permissions/types-consumer.mts
```

These tests exercise local bytes and injected host-boundary fixtures only. They do not verify the real approval issuer, authenticated product identity, accepted JEV transport or role policy, creative consumer, live dispatch, paid usage receipts, or production hosting. EI-08 #18 and its downstream release gates therefore remain open.
