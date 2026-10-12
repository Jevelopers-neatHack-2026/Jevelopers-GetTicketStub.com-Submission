# Fulfillment bundle consumer DEVELOPMENT

This standalone component reads the exact captured print-production corpus through
fulfillment-connectors at `a1c04e6424626475c7c6db3d397cc6e3392c1600` and its vendored
shared-contracts SDK 0.9.7. It adds consumer evidence without changing formal
scenarios, acceptance criteria, current print runtime pins, or existing components.

```sh
node fulfillment_component_tests/run.mjs /exact-clean-fulfillment /approved-print-corpus.zip /new-output
```

The hosted lane requires Linux, Node 24.21.0, npm 11.19.0 and TypeScript 6.0.3.
The checkout and output paths must be absolute; output must not exist. The driver
verifies all tracked source bytes and creates its own private source clone, HOME,
cache and TMPDIR. Locked installation and build run before fixture execution.
No inherited provider settings or credentials enter the execution environment.

`fixtures/print-corpus.zip` retains the original 6,437,762 downloaded bytes from
print-production run 38216826905, artifact 11733229451, source
`01a7b13813b27e5b925b1363543c2577e860ffff`. SHA256 is
`eb9af5b9aae788561d2a7f8f67f3fce579cb53323751856e079f8c77db4d0300`.
The pin records all 65 member names, lengths and hashes, independently joined to
the exact consumer provenance file. The outer archive reader uses Python's
standard `zipfile` library, rejects symlinks, duplicate or unexpected members and
bounded-size violations before extraction, and never renders or executes files.
The SDK alone validates the nested production bundle ZIP and business contracts.
No variant is reconstructed, recommitted or substituted.

After bootstrap, the existing repository pattern `sudo unshare --net -- runuser`
executes the unchanged owner command and the narrow direct scenarios as the
ordinary runner user. A child verifies a different network namespace, only the
loopback interface, and an empty IPv4 route table. This evidence supports network
namespace separation only; it does not claim the formal runner's complete OS
containment. No host kernel or LSM settings are changed.

The unchanged control command is:

```sh
./scripts/verify-fulfillment --suite package --mode simulated --evidence-dir evidence/FC-08
```

Its result is separately labeled `owner_assertion`, including the 166-test
aggregate. Absolute output paths in that report become portable origin labels;
the original returned bytes are bound by SHA256. No provider-call or financial
scalar is inferred from this aggregate.

Direct execution imports the public `resolveTrustAnchor`,
`validateProductionBundleBytes`, `createProductionBundleGate` and
`FulfillmentConnectorRuntime` implementations. The owner's fixture publication,
byte-source, submit and counting-runtime helpers supply explicitly synthetic ports.
Seven archived variants produce retained raw reports: the valid baseline is
`integrity_passed_blocked`; six negatives are `integrity_failed` with the owner's
`INTEGRITY_FAILURE`. Input and output hashes join the captured archive, and the
original bytes must remain unchanged. Eligibility, authority, acceptance and
handoff remain blocked or false.

Three direct controls retain read/resolve traces, requested byte hashes and read
bounds, errors, counters and attempt-state projections:

- Wrong scope rejects with `BUNDLE_UNPUBLISHED` through the actual gate and
  `bundle_invalid/not_dispatched` through the runtime, without reading bytes.
- Use-time drift switches the existing byte-read hook to the actual archived
  tampered lineage bytes at recheck. It yields `bundle_changed/not_dispatched`,
  a retained not-dispatched attempt and zero simulated submit transport writes.
- A sandbox-labeled fixture with forged accepted bindings calls actual submit and
  fails before any injected port. Its full zero-counter vector is retained.
  This is an adversarial simulation, never an actual sandbox call.

Quote preparation for simulated recheck tests is recorded in the before-counters;
submit deltas distinguish those existing fixture calls from denied submit writes.
No fake authority is promoted. Order-authorization expansion, genuine approval,
Finance, supplier orders, owner-gated sandbox reads, OwnerResponse/Assembly and
full journey acceptance are outside this component.

Children have bounded output, deadlines and process-group termination. The owner
`cleanupMockMeteringArtifacts()` runs in the direct scenarios' finally block.
Private source/install/cache/temp files are removed only after every child,
including the nested owner control, has confirmed termination. Missing execution
completion or uncertain lifetime produces a failed receipt and quarantines the
private run root on the disposable runner. Raw stdout/stderr are withheld and
hashed; only named JSON/TAP evidence is uploaded. Failure receipts are retained.

Local safety controls run without provider or service access:

```sh
node --test --test-reporter=tap fulfillment_component_tests/receipt.test.mjs
```

`FC_TEST_SOURCE` adds exact clean source custody validation; `FC_TEST_EVIDENCE`
retains synthetic control artifacts. Direct API regression tests additionally need
`FC_BUILT_SOURCE`, `FC_CORPUS`, and a nonexistent `FC_BUNDLE_EVIDENCE` directory:

```sh
node --test --test-reporter=tap fulfillment_component_tests/bundle.test.mjs
```

Local fixture results do not constitute a passing Linux driver receipt. The hosted
workflow must produce all ten direct scenario artifacts, source/dependency/runtime
custody, the complete archive member join, owner-control result, namespace evidence,
cleanup receipt and final artifact hash manifest.
