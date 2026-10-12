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

## Guarded container lifetime prototype

The default-off prototype in `component_tests/container_*.py` exercises only a
synthetic lifetime canary. It is not an evaluator backend or a print acceptance
launcher. The earlier identity-equality blocker in commit `75e75fe` was an
incorrect inference: the source inspection checks its submitted `Config.User`,
while the source runtime checks its own UID independently. Producer clarification
permits recording distinct roles in this authorized development prototype. It
does not approve that profile for official owner execution. Source revision
`0ef7398` and both validators stay unchanged.

Each invocation creates one fresh private PID namespace. Required Docker init and
its main guard child run as UID/GID 61001; the one synthetic owner invocation runs
as UID/GID 61002. No container is reused. The host creator listens on a Unix socket
inside a guard-owned mode-0700 directory, with a mode-0600 socket and a readonly
control mount. The guard connects and blocks on that socket. Only the creator
holds the peer endpoint; neither endpoint is inherited by Docker clients. Creator
SIGKILL closes the endpoint in the kernel. EOF exits the guard, which must cause
init to exit and terminate every namespace member, including detached processes.
If the creator dies before connection, the guard must fail connecting and exit.
Docker attach, shell traps and client exit are not the lifetime mechanism.

Before starting the owner, the controller runs the actual source inspection
validator, checks the exact bind mount allowlist, verifies socket peer credentials
against the guard's real host PID, and records init/guard namespace, cgroup,
UID/GID, supplementary groups, zero capability sets, NNP, seccomp and AppArmor.
It also checks actual directory/socket ownership and mode. The owner calls the
unchanged source `observeLinuxContainerSecurity`, then attempts guard/init
SIGSTOP/SIGKILL/SIGTERM, ptrace, guard-FD opening and control-socket access. Its
double-forked, setsid descendant closes stdio and remains alive for the test.
Host `/proc` observations joined to Docker's actual process list bind the owner
receipt to the captured full container ID and private namespace. Separate source
checks alone are never treated as approval of the cross-role policy.

The container preserves the existing exact image, seccomp, docker-default,
nonroot roles, zero capabilities, NNP, private PID/IPC/network, 1-GiB shm,
readonly root and 2-GiB `/tmp` tmpfs. Only canary code, the managed Python runtime,
pinned producer, owner staging, guard control directory and host namespace receipt
are mounted; only owner staging is a writable host bind. The host controller uses
existing authorized Linux host privileges for ownership and `/proc` observations.
No root process, daemon socket, credentials or added capabilities enter the container.

Run the explicit workflow-dispatch input `guarded_print_lifetime=true` to select
the additive `print-container-lifetime-prototype` job. It has the original
15-minute budget. After source staging and build its command is:

```sh
IE_PRINT_CONTAINER_PROTOTYPE=guarded-development \
IE_PRINT_SOURCE=/approved/pinned-print-source \
IE_PRINT_LIFETIME_EVIDENCE=/owned/lifetime-evidence \
bash component_tests/container-prototype-ci.sh
```

Nine Linux tests cover SIGKILL after create-client launch, after recorded creation,
after start/attach-client launch, after lease arming and after detached owner
startup; each runs a separate live sentinel. They also cover normal lease release,
handled cancellation, the original 30-second deadline, and an unreachable
teardown-only Docker endpoint. The checkpoints identify client lifecycle
boundaries, not every instruction inside the daemon. The outage test does not
stop the shared daemon. Every operation counts against the original 30-second
invocation and five-second final reap budgets. No producer cleanup is invoked.

Raw inspections and requested IDs are retained before validation. Teardown checks
the returned immutable ID and ownership before removing only that ID. Unknown or
live termination produces ERROR/quarantine and preserves staging; even successful
canary staging is kept as diagnostics. Root-owned evidence is archived without
disposing unknown containers. The original print job, tests and acceptance
failure remain intact. Local Docker has no daemon: these Linux tests are
**unexecuted until a real job receipt exists**. Independent review, hostile-test
results and an explicit reviewed role profile are required before any subsequent
official backend integration or feasibility claim.

## Explicit guarded evaluator development path

The additional `guarded_print_protocol=true` workflow-dispatch input runs the
experimental `print-guarded-protocol-development` job. Ordinary CLI execution and
`contained_command` remain unchanged. The immutable evaluator/process settings
accept an explicit test invocation object, default `None`; environment variables
cannot choose this path. The new job first reruns all nine original lifecycle
cases, then runs the original evaluator fixture and eight producer protocol
controls through fresh containers. No skips, exception-to-pass conversion or
producer implementation replacement is added. The original `print-component`
job retains its failing nested Bubblewrap reproduction.

The host evaluator commits the same typed synthetic negative configuration with
`/ms-playwright` as the original image's browser path. Its existence and exact
browser bytes are checked by the unchanged producer inside the actual container.
Each actual `run` or `cleanup` command gets its own container and kernel EOF lease.
The exact image, source revision `0ef7398`, seccomp, AppArmor, non-root roles, zero
capabilities, private namespaces and resource limits are preserved. The host
checks the real Node PID, executable hash, argv, exact sanitized environment,
role, capabilities, seccomp, namespace and cgroup before forwarding the identical
bounded request. Successful responses are buffered with a 1-MiB limit and written
to evaluator capture only after inspected namespace termination and removal.
The original response, retention, cleanup, SQL, hash, logical-clock and protocol
oracles continue to decide the result.

Additional readonly mounts expose only fresh clean tracked evaluator/configuration
and pinned print projections at their original paths, plus the verified Node
archive directory. The original producer checkout and its Git metadata are not
mounted into this backend. Only the single owned HOME/artifact root and canary diagnostic
staging are writable host binds. Git configuration checks inspect key names only
and reject credential header/helper keys. Guarded workflow preparation uses a
fresh local clone instead of mounting the Actions checkout's Git metadata.
Ownership changes are limited to the owned print clone and isolated HOME;
escaping symlinks, hardlinks, alias roots and overlapping mounts are rejected first.
The print clone's root ownership is restored only after proved namespace teardown.

Every invocation runs hostile guard/init signal, ptrace, FD and control-socket
probes, a host-only read probe and a real denied network connection. A detached
closed-stdio sibling occupies the same namespace as the original Node command.
Additional SIGKILL tests pause the creator at Docker exec launch, attach and the
real original owner awaiting its request. They inspect kernel pidfds for both
live Docker clients, require their death and namespace termination within five
seconds, and require an unrelated live sentinel to survive. These checkpoints
explicitly do **not** claim death midway through producer compose after request
delivery. Cancellation, original deadline and unreachable teardown tests preserve
errors. If termination/removal cannot be verified, the original HOME is renamed
into root-owned quarantine without copying or publishing its response, and all
unknown-container records remain intact for independent recovery.

Root-owned receipts outside owner-writable storage name the selected development
backend and bind source/configuration/request hashes, actual owner process,
inspected mounts, captured full ID, output identity, owner exit and teardown.
Product acceptance stays blocked. This new combined path requires independent
whole-candidate security review and actual Linux execution; local macOS unit/type
checks do not establish those effects. The earlier nine-case Linux prototype pass
at `f0937ad` and the separately failing legacy workflow remain historical facts,
not proof for the new backend. No revised owner runtime profile, ART-03/ART-04
acceptance, paid execution authority or product release is claimed.
