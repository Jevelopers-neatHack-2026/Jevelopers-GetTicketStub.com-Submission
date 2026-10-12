# Local exporter conformance

Run on the pinned Node 24.21.0 / npm 11.19.0 profile with UTC and C.UTF-8:

```sh
npm ci --offline
npm run build
npm run verify -- --suite exporters --mode offline --evidence-dir out/evidence
```

A successful command means `local-exporter-adapter-conformance` only. The verifier
owns execution: 51 existing output tests and 13 canonical bundle tests must pass
with no missing, skipped, cancelled or failing checks. It executes two independent
canaries, binds evidence to distinct fresh execution nonces, checks actual payload
lengths/hashes, and re-verifies the newly supplied canonical manifest and ZIP bytes
against the separately produced commitment. A caller's claimed execution is not
an input. False/stale canaries, missing tests/evidence, changed measured source/build/
tests, or changed earlier payloads fail the command and overwrite its success receipt.

`exporters.json` is a scoped receipt without absolute execution directories.
`exporters-local.json` retains the local runner locations. The `exporters/local/`
execution directories contain actual SVG/PNG/PDF/ZIP files, parsed-file and PDF
semantic reports, adversarial controls, renderer/environment/font/profile records,
the normalized byte/semantic/pixel reproducibility comparison, and a full bounded
evidence inventory. The canonical phase retains its actual bundle, commitment,
preflight result, supplied-manifest hash, ZIP order/repack comparison and post-restart
publication read. Missing/extra/tampered payloads and ZIP entries are tested against
the real current canonical route. Fonts, color profile, dimensions, unsupported
requests and active-content controls remain in the existing output selection.

Normalized visual files repeat in independent browsers. ZIP equality is measured
for repacking the same supplied canonical manifest, including reversed payload
input order. Rebuilding canonical manifests generates fresh identifiers, so this
receipt does not claim byte equality for independently rebuilt canonical manifests.
Semantic/layout equality and normalized file byte equality remain separate observations.

Source Git revision/tree labels and measured source/build/test digests are distinct.
The reused custody primitive measures the finite source/build inventories before
and between executions; `gitCorrespondence: unproven` remains explicit. Evidence
inventories cover regular files with bounds of 4,096 entries, 32 path components,
32,000,000 bytes per file and 512 MiB total. These observations do not establish
continuous filesystem immutability. Tamper tests operate on disposable copies.

The retained shared-contracts 0.9.7 helper still has `SC-PFB-PARENT-LEGACY009`:
`parseProductionCanonicalBytes` reads an own `byteLength` property, invokes its
getter, and can accept an oversized real manifest when that property lies. The
ordinary export route builds `jsonBytes`/`outputFile` buffers before
`assembleCanonicalBundle -> verifyProductionBundleFiles`; the read route uses
`LocalArtifactStore.verifiedFiles` SQLite BLOB views before
`readBundleRecord -> verifyProductionBundleFiles`. The fresh evidence proof checks
these real SQLite views for absent own buffer/offset/length metadata, actual lengths
and hashes, and ordinary `maximum=1` rejection. Evidence rechecks use fresh Node
filesystem Buffers. No arbitrary SDK typed-array validation is certified safe, and
no vendor source, package pin, renderer/parser or manifest schema is changed.
The upstream reviewed archive and acceptance remain a concrete dependency hold.

Every local success retains `accepted:false`, `live_integration:false`,
`handoff_eligibility:unproven`, `externalState:external-blocked` and injected test
authority. Real approved supplier/SKU/spec/font/format policies, creative/fact/input
approvals, permitted repair policy, accepted shared-contracts, exact-preview approval
mapping, app/Fulfillment/Finance acceptance and reviewer sign-off remain outstanding.
The fixture's integrity result is passed while eligibility is blocked; it is not a
genuine approved bundle or FC consumer acceptance. Release still returns
`RELEASE_INCOMPLETE`. Other leaves retain their gates. Issue #15 remains open.

For focused validation after a build:

```sh
node --test --test-concurrency=1 dist/tests/integration/exporter-conformance-command.test.js dist/tests/unit/exporter-conformance-controls.test.js
node --test --test-concurrency=1 dist/tests/unit/storage-conformance-custody.test.js
```

The preserved source `01a7b13813b27e5b925b1363543c2577e860ffff` Linux 760/760
run and final corpus belong to that original revision. Fresh matching macOS checks
are supplemental. Integrate the preflight PR first, then obtain a fresh current-base
independent full criterion/command review of this PR before any permitted merge;
neither this worker nor these receipts close issues or grant release acceptance.
