# Reviewed print-invalid consumer slice

This development slice selects only the original `print-invalid` case. It invokes
print-production's reviewed `dist/scripts/integration-evals/cli.js run` and
`cleanup` commands through the existing evaluator. It does not render the hostile
fixture. `print-preflight`, supplier eligibility, genuine approval, Finance,
benchmark validity and composed product acceptance remain unsupported or blocked.

The source profile in `src/integration_evals/print-profile.json` pins producer
commit `0ef7398bb94caacf6b48068747142883470fbdaf`, its tree, lockfile, owner
implementation, supplement, exported schema, original metadata and runtime policy.
The original 20 fixture records and bytes, 42 cases, 142 obligations, 47 tracker
states and historical accepted evidence are unchanged. The supplement remains
producer-owned synthetic test authority. Source preparation rejects a mismatched
original Case projection, payload or provenance record.

`print_setup.configuration` hashes the actual Node executable and resolves the
existing browser directory. The fixture workspace commits this generated
`print-configuration.json` before `print_setup.prepare` creates an immutable
component assembly. The assembly declares and hashes that configuration, pins
all three actual clean checkouts, and selects only `print-invalid`. Existing
shared-contracts and retrieval pins remain unchanged; the print runtime is separate.

## Reproduction

The `print-component` job in `.github/workflows/verification.yml` stages the exact
producer checkout and runs `bash component_tests/print-ci.sh`. Build installation
uses the source's checksum-verified Node 24.21.0 archive and npm 11.19.0. Actual
execution uses the exact amd64 Noble Playwright image from the source profile,
its existing browser revision 1248/version 156.0.8078.4, and the producer's exact
reviewed seccomp policy. The producer's own `--check-inspection` verifies real
Docker inspection before and after the workload. The workload has non-root
UID/GID, zero capabilities, no new privileges, docker-default AppArmor, private
IPC, 1 GiB shared memory, no network, a read-only root/source, and owned writable
temporary/evidence storage. No host security policy is changed.

Within that environment the actual evaluator adds its unchanged Bubblewrap PID
and network isolation, read-only checkout, isolated HOME/TMPDIR and bounded
process group lifecycle. Both security boundaries must operate together. The
consumer does not claim they are compatible without a real successful run.
In particular, Bubblewrap's recreated `/dev` may affect the producer's shared
memory observation; an actual rejection must remain a failure, without policy
exceptions or timeout increases.

The focused invocation is:

```sh
IE_PRINT_SOURCE=/approved/print-production \
IE_CONTRACT_SOURCE=/approved/shared-contracts \
IE_PRINT_RUNTIME=/approved/node-runtime.json \
IE_PRINT_BROWSER_ROOT=/ms-playwright \
IE_PRINT_EVIDENCE=/owned/print-evidence \
.venv/bin/python -m pytest component_tests/test_print.py
```

These variables describe existing files inside the approved runtime; setting them
does not establish runtime authority. `node-runtime.json` uses the existing
`ContractRuntime` path/SHA-256 schema. The producer independently verifies runtime
versions, executable bytes, browser bytes and effective Linux security facts.

## Observables and limitations

The module fixture calls the real `runner.execute`, then saves the full 42-case
run and a 142-obligation release audit before any success assertion. It checks the
actual typed `PREFLIGHT_FAILED`/`preflight` result after asset resolution, zero SQL
publications and storage counts, trace/mapping hashes, configuration and source
joins, logical request clock and actual Linux runtime mapping. All six evidence
claims over three files must have been independently retained before cleanup.
The remaining 41 cases stay planned; product acceptance stays blocked and cost
stays null/unknown.

Protocol controls run only after that real baseline passes, using the same
`processes.invoke` boundary with the original 30-second deadline. They cover
invalid schema, binary hash, image runtime, case and mode; replay refusal; repeat
cleanup; interrupted cleanup lock; and the source's safe-counterpart compose
control. Successful replay/cleanup-lock setup captures and hash-checks all six
owner evidence claims before cleanup. The safe counterpart is solely a boundary
control and cannot pass `print-preflight`. Cleanup retains `owner.json`; its
`removed` status does not mean the directory was removed. Only evaluator-owned
isolated HOME disposal follows completed process teardown.

A missing runtime or failed baseline is an error, never a skipped or mocked pass.
The CI artifact `print-component-<commit>` retains the run/release audit when
available, actual container inspections, JUnit and diagnostics. Local macOS
execution is characterization only and cannot establish Linux acceptance.
The initial implementation's local execution was blocked (owner exit 1 and cleanup
failure under existing macOS containment); Docker had no running daemon. Linux
CI, independent review and producer acknowledgement remain required.
