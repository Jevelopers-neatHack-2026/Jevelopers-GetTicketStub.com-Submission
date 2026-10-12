# PP-16 bundle handoff corpus (synthetic, unapproved, ineligible)

Diagnostic evidence for bounded offline byte inspection by the
fulfillment-connectors #10 validator. It establishes no customer approval,
rights, supplier or product eligibility, or order authority. No provider call,
charge, order or real/customer data is involved.

## What it contains

The `pp16-bundle-handoff-<attempt>` Linux CI artifact (30-day retention; readable
by anyone with read access to this repository's Actions artifacts) holds:

- `bundle/`: the exact files from `canonical-production-flow.test.ts`'s real
  offline Chromium export through the candidate `exportArtifactBundle`:
  SVG/PNG/PDF payloads, `preflight.json`, `lineage.json`, `manifest.json`
  (ProductionBundle `2.0.0`), `archive.zip`, `detached.json`, plus
  `trusted-commitment.json` (the owner `ProductionBundleRef` returned by export).
- `CORPUS.json`: baseline inventory (name, length, SHA-256), the vendored
  shared-contracts pin, production revision, toolchain, and per-variant expected
  outcomes alongside the outcomes actually observed.
- `variants/<id>/`: full file sets, derived from the baseline without changing it.

| Variant | Expected |
| --- | --- |
| `valid` | accepted by the owner verifier and the byte reference check |
| `tampered-payload`, `tampered-manifest`, `tampered-detached` | rejected; `hash-mismatch:<file>` |
| `missing-payload`, `missing-manifest` | rejected; `missing:<file>` |
| `extra-file` | rejected; `extra:extra.bin` |

The CI phase `pp16-bundle-handoff` fails unless every variant's observed outcome
matches (owner `verifyProductionBundleFiles` and the independent
roster/length/SHA-256 reference check, which also covers the control files).
`trusted-commitment.json` is the owner verifier's trusted input, not a payload,
so it is outside `baseline_inventory` and the variants. The complete
`ProductionBundleRef` (bundle_ref, file_set, detached_ref, row scope,
composition_ref, eligibility) is passed unchanged to the owner verifier. Its own
exact name, length and SHA-256 are pinned in `CORPUS.json` `control_inventory`
(role `owner-verifier-trusted-commitment`): a consumer should verify those bytes
before using it as the trust anchor. It is produced by the same synthetic export and
carries no more authority than the bundle (`handoff_eligible:false`).

## Reproduce

Authoritative bytes come only from the Linux `runtime` workflow (digest-pinned
Playwright image, Node 24.21.0, npm 11.19.0, networking disabled); the phase is
defined in `scripts/ci-offline.sh`. Download `pp16-bundle-handoff-<attempt>` from
the run for the commit under test. Equivalent command inside that environment
after `npm ci && npm run build`:

```sh
PP_CANONICAL_EVIDENCE_DIR=out/pp16-bundle-handoff/bundle node --test --test-concurrency=1 \
  dist/tests/integration/canonical-production-flow.test.js
node dist/scripts/diagnostics/pp16-bundle-handoff.js out/pp16-bundle-handoff
```

The generator refuses to run on non-Linux platforms; macOS output must not be
used as authoritative rendered bytes. Local macOS checks cover only the
non-renderer variant logic:
`node --test dist/tests/unit/pp16-bundle-handoff-variants.test.js` (stand-in
bytes, not renderer output). Output hashes are in `CORPUS.json` of the run
artifact; none are committed here, since they exist only once Linux CI has run.

## Explicit limits

- `accepted:false`, `handoffEligible:false`; the candidate pin is
  `unaccepted-development-candidate` (`vendor/shared-contracts/candidate-pin.json`).
- `canonical_usage_intake` is `unavailable`, `finance_receipt` is `null`,
  `usage_refs` is empty. The generator rejects a bundle that says otherwise.
- Supplier eligibility is blocked (`LEGACY_UNREPRESENTABLE`).
- `stale-spec` is blocked: no second genuine supplier specification exists.
- An approved-valid package is blocked on an application-issued approval binding,
  accepted shared-contracts mapping and genuine supplier spec
  (fulfillment-connectors #10, shared-contracts #24).
- This is not the canonical approved ProductionBundle and does not close PP #16.
