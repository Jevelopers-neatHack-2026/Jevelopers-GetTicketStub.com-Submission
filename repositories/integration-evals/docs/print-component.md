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

The unconditional `print-component` job in `.github/workflows/verification.yml`
runs on pull requests, main pushes and manual dispatch. It selects the explicit
TEST-ONLY guarded mock profile, stages the exact producer checkout, and runs
`bash component_tests/guarded-print-ci.sh`. All thirty-three genuine Linux cases
must pass: seventeen lifetime/native and sixteen original owner protocol/process
cases. Build installation
uses the source's checksum-verified Node 24.21.0 archive and npm 11.19.0. Actual
execution uses the exact amd64 Noble Playwright image from the source profile,
its existing browser revision 1248/version 156.0.8078.4, and the producer's exact
reviewed seccomp policy. The producer's own `--check-inspection` verifies real
Docker inspection before and after the workload. The workload has non-root
UID/GID, zero capabilities, no new privileges, docker-default AppArmor, private
IPC, 1 GiB shared memory, no network, a read-only root/source, and owned writable
temporary/evidence storage. No host security policy is changed.

The separate default-false manual input `legacy_print_containment=true` selects
`print-component-legacy-characterization` and runs the complete unchanged thirteen
cases via `bash component_tests/print-ci.sh`. It retains honest nonzero failures,
with no continue-on-error or converted pass. In that legacy characterization the
actual evaluator adds its ordinary Bubblewrap PID
and network isolation, read-only checkout, isolated HOME/TMPDIR and bounded
process group lifecycle. Both security boundaries must operate together. The
consumer does not claim they are compatible without a real successful run.
In particular, Bubblewrap's recreated `/dev` may affect the producer's shared
memory observation; an actual rejection must remain a failure, without policy
exceptions or timeout increases.

The focused legacy characterization invocation is:

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

## CI criterion mapping

| Existing obligation | Current mandatory evidence | Interpretation |
| --- | --- | --- |
| Original negative evaluator and all eight producer protocol controls | Guarded `print-component` executes the original owner path and identical response, retention, cleanup, SQL and hash oracles; positive control also executes actual compose | Test-only mock protocol compatibility |
| Lifetime, creator death, interruption, races and actual active compose | All thirty-three combined cases, including authenticated pending/start/key/DB-WAL-SHM phase and death evidence | Test-only contained execution and custody |
| Four portable sanitizer/privacy checks | Four unchanged explicit node IDs in mandatory `tooling` | Privacy behavior remains required |
| Harmless command under the original nested Bubblewrap boundary | Complete thirteen-case default-false manual legacy job and preserved failed receipts | Unsupported on the observed runner; failure remains failure |

No selected release, ART-03/ART-04/IE-05D, domain, supplier, permission or default-CLI
criterion is waived or relabeled. Scope is technical test-only compatibility and
CI repair. Paid/provider execution, source-policy changes and product release
remain outside this profile. Final exact-head review and fresh normal CI are
required before merge.

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
The normal CI artifact `print-guarded-development-<commit>` retains the run/release
audit when available, actual container inspections, both suites' JUnits and
diagnostics. The manual legacy artifact `print-component-<commit>` preserves its
complete characterization and actual failures. All four unchanged sanitizer/privacy
tests are also mandatory in the ordinary tooling job through explicit node IDs.
Local macOS
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
disposing unknown containers. The original thirteen legacy tests, manual job and
historical failures remain intact. The initial local characterization had no
running Docker daemon and could not establish these Linux effects. The actual
Linux receipts described below establish only the explicit test profile; official
producer/domain runtime acceptance remains a separate hold.

## Explicit guarded evaluator development path

The normal `print-component` job runs the explicit TEST-ONLY guarded profile.
The former manual `guarded_print_protocol` selector is removed because this
component check is unconditional on PR/main/manual events. Ordinary CLI execution
and current-main `contained_command` remain unchanged. The immutable evaluator/process settings
accept an explicit test invocation object, default `None`; environment variables
cannot choose this path. The job first reruns all nine original lifecycle
cases and eight native regressions, then runs the original evaluator fixture and eight producer protocol
controls through fresh containers. No skips, exception-to-pass conversion or
producer implementation replacement is added. The explicit manual legacy job
retains the complete nested Bubblewrap reproduction and its genuine failures.

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

The guarded test profile explicitly supplies logical scenario time
`2026-10-10T12:30:00+00:00`. The unchanged producer's synthetic capability capture
is retrieved at noon and fresh until 13:00; its pinned validator correctly rejects
the ordinary midnight clock with `CLOCK_BEFORE_CAPTURE`. `Settings.test_clock`
defaults to `None` and accepts only an aware UTC value with an explicit test
invocation, mock mode and no paid authorization. Live, recorded, sandbox, unguarded,
paid, naive and non-UTC overrides are rejected. CLI/environment/default execution
retain midnight. The evaluator run, original source protocol controls, retainer
and death/interruption workers share 12:30; actual `Run.started_at` remains wall
time, and the original fixture's collected timestamp stays midnight. This is
synthetic logical chronology, with no claim of live capture equivalence.

Additional readonly mounts expose only fresh clean tracked evaluator/configuration
and pinned print projections at their original paths, plus the verified Node
archive directory. The original producer checkout and its Git metadata are not
mounted into this backend. Only the single owned HOME/artifact root and canary diagnostic
staging are writable host binds. Each mounted checkout uses an owned shallow
one-commit Git projection: exact canonical config, detached HEAD, fresh index and
only the pinned commit/tree object closure. No remotes, headers, hooks, reflogs or
original checkout metadata are copied. The backend rejects added metadata,
credential-bearing config, side-directory symlinks, hardlinks and extra objects.
Ownership changes are limited to the owned print clone and isolated HOME;
escaping symlinks, hardlinks, alias roots and overlapping mounts are rejected first.
The print clone's root ownership is restored only after proved namespace teardown.

Every invocation runs hostile guard/init signal, ptrace, FD and control-socket
probes, a host-only read probe and a real denied network connection. A detached
closed-stdio sibling occupies the same namespace as the original Node command.
Additional SIGKILL tests pause the creator at Docker exec launch, attach, the
real original CLI owner awaiting its request, and an unfinished actual compose.
Only the fourth stage runs the producer's existing pinned positive-control command,
which calls the real candidate `composeArtifact` and private SVG composer with the
source fixture's real font/asset/render ports. Its host remains explicitly synthetic,
test/offline and simulated billing, with mock authorization callbacks. This grants
no real permission or domain acceptance. The first three stages retain the original
CLI command, and all eight original protocol controls retain their assertions.
The latter holds the original Node pidfd from initial authenticated binding before
request delivery. Initial stop checks that held handle, start time, executable
inode/argv, role, namespace and cgroup. Subsequent pulses fully authenticate the
already stopped Node, then send CONT, request a 20-millisecond scheduling quantum
subject to scheduler delay and the unchanged absolute deadline, and send STOP
through the same continuously held descriptor.
No expensive `/proc` round trip occurs while the Node runs; the kernel handle
cannot target a recycled PID, and a departed task fails without rebinding or retry.
After each STOP, full identity authentication and observed T state are mandatory
before any SQLite observation. It never reopens a stored numeric PID to signal it.
A rejected stale identity sends zero signals. A native departed-child check requires
both pulse signals to fail through its original held handle while a sentinel lives.
It stops that Node through the held pidfd,
and uses a readonly observer as the same nonroot container user. An explicit SQLite
read transaction must observe the original request-bound compose operation,
pending attempt and its `execution_started` event; actual opened DB/WAL/SHM
descriptors must match held nofollow source descriptors. SQLite opens the original
basename through a held parent directory FD so its real WAL/SHM siblings resolve;
individual file pins and exact actually-opened inode matching remain mandatory.
The expected operation key comes from the readonly original owner request fixture,
with fixture hash and actual command recorded in the root-owned phase receipt.
Positive-control does not write a mapping artifact; no mapping or pending state is
fabricated. Database readiness merely starts sampling and is not phase proof.
Actual Linux native checks exercise WAL-only schema/pending reads and reject replaced
symlink/FIFO sidecars. DB/WAL size limits,
query limits and the original absolute deadline bound this observation. Mapping
existence or request delivery alone is insufficient. Tests inspect kernel pidfds
for both Docker clients and the active original Node, require their death and
namespace termination within five seconds, and require an unrelated sentinel to
survive. This additional active-compose proof is required but has not yet run on
hosted Linux. Cancellation, original deadline and unreachable teardown tests preserve
errors. If termination/removal cannot be verified, the original HOME is renamed
into root-owned quarantine without copying or publishing its response, and all
unknown-container records remain intact for independent recovery. A same-device
check reserves the empty protected destination before dispatch. Atomic preservation
runs in a `finally` before any receipt work, even after an expired reap budget or
failed teardown diagnostic write. The predispatch digest is cached before execution;
a failed invocation-receipt write cannot skip quarantine. Response publication flushes
the original buffered capture only after verified namespace teardown; independent
file readers then see even small cleanup/positive responses. Failed preservation has
its own custody error and is never reported as successful.

The protected filesystem socket is bound through a held nofollow/CLOEXEC control
directory descriptor and the short `/proc/self/fd/N/lease` pathname. The same inode
remains under the exact readonly control mount, with original peer/EOF/UID checks
and 0700/0600 permissions. This avoids Linux AF_UNIX pathname limits for long
staging roots without an abstract socket. A real Linux long-root regression checks
the filesystem inode, permissions and EOF; a separate real pidfd regression rejects
a stale binding before any signal.

Owner-writable control receipts use bounded nonblocking nofollow regular-file
reads. Stdin and stdout share one nonblocking selector and absolute deadline;
a stalled Docker input consumer cannot postpone it. Guarded host Docker commands
use a fixed sanitized environment, and Node receives its exact allowlisted
environment. The TEST-ONLY component job separately prepares the unchanged image digest
with three bounded 180-second pulls and records each failed attempt. Its 30-minute
setup/test job budget leaves all 30-second owner and five-second reap bounds intact.
The earlier combined run `38238794152` was cancelled during image pull before any
guarded tests executed; it establishes neither success nor runtime failure.
The next frozen `c5fe871` dispatch failed all nine lifecycles before Docker creation
with controller `OSError`, consistent with its 108-byte lease pathname. Its sixteen
guarded cases did not run. The same head's legacy job reached thirteen-item test
collection and failed on an imported `TestInvocation` protocol warning, before
print assertions; the apt warning was nonfatal. Aliasing that import restores clean
collection with warnings still treated as errors. These failures remain historical
evidence; neither proves a current producer protocol or nested Bubblewrap result.
The combined script now executes and retains both suites independently and exits
nonzero if either fails. Sanitized controller failures retain phase, error class
and errno only.
The `f5a1e13` dispatch then passed all eleven lifecycle/native cases, and genuine
baseline run/cleanup executed with proved namespace teardown. The original
print oracle failed: the source returned `INCOMPATIBLE_TEMPLATE`, zero asset
resolutions and no execution attempts. Its retained capability capture was noon
while its request clock was midnight. The sixteen guarded cases therefore failed
shared baseline setup; no producer-control or active-compose pass is claimed.
The explicit guarded logical-clock correction leaves fixture/capability bytes,
source validity predicates, and all original comparison assertions intact.
The `e263b72` dispatch passed eleven lifecycle/native and thirteen guarded cases.
Replay repeat-cleanup and positive response checks failed because captured responses
were buffered without a publication flush: receipts retain their actual 76/1300
bytes and zero exits with proved teardown. Active-compose also failed its required
checkpoint; it is not an acceptance pass. The next candidate corrects publication
and WAL addressing, uses the unchanged source positive command only for that fourth
stage, and adds real native reader regressions. Fresh full Linux proof is required.
The `b417bcc` dispatch passed twelve lifecycle/native and fifteen guarded cases.
Four sidecar tests failed before observer execution because their setup left the
SQLite WAL-selection cursor unconsumed, so no real sidecars existed to replace.
Active-compose failed before DB observation: the unchanged original request fixture
is 225610 bytes and exceeded the reader's 64 KiB bound. The successor retains a
finite 256 KiB fixture bound, tests original-size and hostile replacements, and
requires confirmed WAL selection and actual regular sidecars before native tamper
checks. No active-compose or hostile-sidecar acceptance is claimed from that run.
The `d5a1c11` dispatch passed all sixteen lifecycle/native and fifteen guarded cases;
only active-compose failed. Its retained samples reached the real stopped-owner
observer twice while the schema was not ready or locked, then recorded a host-side
AssertionError before phase confirmation. The exact assertion location was lost
to discarded creator stderr, so a sampling gap remains a hypothesis. The successor
retains bounded, allowlisted source/function/line exception locations and one
root-owned phase/state marker, with no messages, source lines, locals or absolute
paths. Held-handle pulses separate owner progress from expensive observation while
preserving the deadline and every actual pending/start/key/inode acceptance oracle.
The `e79cc1d` dispatch passed seventeen lifecycle/native and fifteen guarded cases.
The remaining active failure is now identified by its root-owned phase marker:
the authenticated original Node was in D (uninterruptible disk sleep) while waiting
for a sent STOP to become effective. The waiter accepted only transient R/S states.
The successor also waits through authenticated D within the original deadline;
only actual T permits SQLite or checkpoint proof. Persistent D still times out,
and departed, zombie, wrong-identity and unknown states remain rejected. It retains
the deepest eight allowlisted exception frames so the failing assertion survives
the fixed diagnostic bound. The prior run supplies no pending/active acceptance.
The `e0ef085` dispatch again passed seventeen lifecycle/native and fifteen guarded
cases, but active-compose expired after 298 actual stopped snapshots without an
unfinished attempt. Its 500-microsecond quantum requests sum to about 149 ms;
this is requested scheduling time, not measured owner CPU progress. The successor
requests 5 ms per pulse within the same deadline and records bounded readonly
registration/admission/completion counts when no attempt is pending. Those
diagnostics are never phase acceptance; a completed or missed window still fails.
The current-main offline-read composition preserves its ordinary owner input
staging, network-filter descriptor, read closure and cleanup behavior. The print
test hook remains explicit and default-off, rejects the retrieval-private-IP
policy before dispatch, and records its requested deny policy separately from
the original producer container profile. This is no generic runtime promotion.
The `fad073b` dispatch still passed thirty-two of thirty-three cases. Its active
samples established no unfinished attempt at the observed instants; the filtered
expected-operation count was zero, which is not a global operation count. Source
inspection confirms the original positive command retains the fixture key and
uses the observed DB route; no key/path mismatch or stalled CPU is established.
The successor records capped global operation/attempt counts, exports no row
values, and binds the actual database path to the pinned command, request digest,
and original protocol/host/positive-source hashes. The original acceptance oracle,
5 ms requested quantum and deadline remain unchanged.
The `9e9a147` Linux dispatch `38257737320` passed all thirty-three cases: seventeen
lifecycle/native and sixteen guarded cases. Artifact `11750464719` has ZIP SHA-256
`7c0c3da1738b476474aaafbbad3d56246c75c2db4806c2ce79c2d5cd8e1b6aa3`.
The original positive-command active receipt observed an actual unfinished attempt,
null outcome, one `execution_started`, the request-bound fixture key, authenticated
stopped Node/held pidfd and matching DB/WAL/SHM identities at 25.356 seconds; its
creator-death assertion passed. This is actual synthetic test/offline/simulated
execution, with no real authorization or product/domain acceptance grant.
The fresh ordinary `118967e` PR run then passed thirty-two cases and expired its
active checkpoint. Artifact `11751143419` has ZIP SHA-256
`3e18e636d3c41cdf3df3aaa55e473daf0d8d4a1dd7f440c16beb3df0e724131d`.
Its 297 stopped snapshots included 296 schema-ready observations with both global
operation and attempt counts zero, under the same original command, key fixture
and source-bound DB path. This establishes no observed registration; starvation
is a hypothesis, and the prior passing run does not cure this failed merge gate.
The successor requests a fixed 20 ms pulse, clipped to the same remaining absolute
30-second budget, then authenticates T before the unchanged pending/start/key and
DB/WAL/SHM oracle. Requested scheduling time is neither measured CPU progress nor
a guaranteed runtime bound. The five-second reap, no-retry/held-task identity,
D-wait, source/profile, production defaults and all acceptance assertions remain
unchanged. Fresh exact review and all thirty-three normal CI cases are required.
The same `118967e` unprivileged offline-read run passed all 122 native cases but
then collected unrelated print tests without their image, inputs or host role.
Its final retrieval step now selects the unchanged `test_retrieval.py` collector
explicitly, preserving all seventeen retrieval cases and their assertions. No
native, canonical, environment, security or unprivileged checks change; all
thirty-three print cases and four privacy tests remain mandatory in their assigned
jobs. This corrects collection scope rather than converting failed tests to passes.

Root-owned receipts outside owner-writable storage name the selected development
backend and bind source/configuration/request hashes, actual owner process,
inspected mounts, captured full ID, output identity, owner exit and teardown.
Product acceptance stays blocked. This new combined path requires independent
whole-candidate security review and actual Linux execution; local macOS unit/type
checks do not establish those effects. The earlier nine-case Linux prototype pass
at `f0937ad` and the separately failing legacy workflow remain historical facts,
not proof for the new backend. No revised owner runtime profile, ART-03/ART-04
acceptance, paid execution authority or product release is claimed.

Following the actual complete Linux proof, this workflow selects the explicit
test backend in normal `print-component` CI and preserves the legacy nested
Bubblewrap path as default-false manual characterization with all historical red
results. Exact final workflow/current-base review and a fresh ordinary PR run
must pass the combined component job and existing required verification before
merge. This does not alter the production CLI, optional hook defaults, current-main
offline-read containment, fixture/capability bytes, or original protocol oracles.
Producer/domain profile approval and ART-03/ART-04/IE-05D owner acceptance remain
separate holds; this candidate does not grant them.
