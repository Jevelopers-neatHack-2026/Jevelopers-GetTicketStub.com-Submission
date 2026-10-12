# Team Dashboard documentation map

The [ownership guide](architecture/OWNERSHIP.md) explains the package's responsibility and current host boundary. The [local acceptance view](architecture/ACCEPTANCE.md) links the relevant master criteria; `integration-evals` owns their status and evidence.

## Develop and verify

- [Development guide](development.md): pinned Node/npm toolchain, installation, local commands, fixture host, and CI boundary.
- [TD-01 runtime/mount decision](decisions/TD-01-runtime-mount.md): implemented library/toolchain decisions versus the unaccepted host mount.
- [TD-11 CI validation](integration/TD-11-ci.md): local CI suites and report gates.
- `integration/fixture-host/`: local browser host and synthetic examples; it is not the product application or host conformance.

## Integration decisions and contracts

- [Mount contract](integration/mount-contract.md) and [TD-07 trusted host](integration/TD-07-trusted-host.md): proposed mount interface and server-side verifier boundary.
- [TD-01 coverage](integration/TD-01-coverage.md): requirement-by-requirement local implementation coverage.
- [TD-01B shared contracts](integration/TD-01B-shared-contracts.md) and [TD-10 components](integration/TD-10-components.md): contract and visual component status.
- Finance v2 and report/export integration notes under `integration/` describe the individual proposal, source snapshot, fixture evidence and remaining owner gates. Read their status before relying on an example.

The actual getticketstub.com mount and cross-repository mode are recorded in the host's source-pinned [current architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) (available after its companion documentation PR merges). Local package tests, fixture HMAC checks, build output or a copied context shape do not prove production host wiring or integration acceptance.
