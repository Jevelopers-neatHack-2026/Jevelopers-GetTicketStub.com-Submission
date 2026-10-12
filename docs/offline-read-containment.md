# Offline command read containment

Mock and recorded invocations run with a filesystem read allowlist. The evaluator
requires dedicated, prevalidated owner checkout and task-output directories. It
rejects root, home, their ancestors, the shared temporary root, and paths addressed
through caller-created symlinks or traversal components. A checkout grant is a
capability for that checkout: callers must not put unrelated cases, retained
archives, credentials, or host services inside it. The owner assembly and canonical
producer guards remain responsible for validating source ownership and pins.
There is no caller-provided arbitrary directory or external-file read grant.

The child can read its checkout and task output. Host writes are confined to the task output.
Symlinks inside either directory do not grant access to their outside targets.
The evaluator's exact Python interpreter additionally receives its standard library, current environment packages (excluding unrelated base
site-packages when using a virtual environment),
shared runtime libraries, and the evaluator source package. It does not receive
its installation root, user home, source repository parent, or retained reports.
Other runtimes must reside within the declared input checkout and use the supported
OS library closure; an unsupported dependency fails closed.

On macOS, sandbox-exec denies file reads by default and allows only these paths and
fixed OS binaries/libraries/time-zone resources. Metadata access is limited to
allowed paths and their ancestors. The loader requires literal directory access
to `/`; Python additionally needs literal standard-library and source-parent
directory access for import discovery. These rules expose those directory entries,
not recursive read access to their contents. Policy path strings escape quotes and
backslashes. Network access and process forks remain denied.

On Linux, bubblewrap starts with an empty filesystem and binds only the read
closure read-only plus the task-output directory writable. It creates its own
`/dev` and `/proc` mounts before remounting the root read-only. This nonrecursive
remount prevents writes to unmounted namespace paths while preserving the separate
task-output and device/proc mounts. It retains
`--unshare-pid`, `--die-with-parent`, and
`--unshare-net`, and receives an offline seccomp filter compiled with the system
`libseccomp.so.2`. The default filter rejects socket creation/use, socketpair, and io_uring
entry points with EPERM; this covers pathname Unix sockets that a mounted task
file could otherwise expose despite network namespace isolation. libseccomp owns
native syscall resolution, multiplexing, and architecture checks. Missing library,
unsupported rules, failed export, missing filter, or unavailable namespace support
rejects execution. The filter uses an unlinked, scoped descriptor; unrelated parent
file descriptors are closed. The existing bounded communicate, kill-group, and
five-second reap behavior is unchanged.

Canonical contract execution snapshots only Git-tracked producer files, the exact
verified runtime, the evaluator driver, and (when requested) the verified private
package into a separate temporary input checkout. Symlink producer paths are
rejected; the package verifier rejects links and changed/missing/extra files.
Copies are checked against original bytes and the original producer/runtime pins
are revalidated. Ignored/untracked data and `.git` are not inputs. The sandbox makes
this snapshot read-only to the child; chmod is not the enforcement boundary.
HOME, TMPDIR, stdout and artifacts use a separate writable directory. Receipts
continue to identify the original producer/evaluator and package pins. Staging
neither changes those pins nor grants acceptance.

The evaluator-owned `ssrf-egress` mock retrieval adapter has one explicit private-IP
capability. Selection requires its exact command/cleanup shape, evaluator location
and unchanged adapter-module bytes, reviewed case/mode/profile, clean pinned
assembly, and matching runtime digest. Neither owner output nor ambient environment
selects this capability. It requires Linux offline execution with the same new
network namespace, PID/parent-death controls, read closure and read-only root.
Its libseccomp rules permit AF_INET/AF_INET6 socket operations only inside that
namespace; AF_UNIX, other families, socketpair and io_uring remain denied, and
unrelated host socket descriptors close before execution. Generic offline owners
retain the default socket denial.

Retrieval stages tracked producer files, the exact runtime, unchanged evaluator
adapter modules, profile, catalog and negative fixture into one read-only owned
input checkout. It copies only the fixed OpenSSL configuration needed by the
existing certificate fixture and points OpenSSL at that staged copy; no host
configuration directory is granted. The original adapter and producer behavior is
unchanged. Run and bounded cleanup share the staged lifetime. Original manifest
commands/revisions and owner artifact roots remain intact. Evaluator-owned input
hash/origin records live under `input-staging/<run-id>/ssrf-egress.json` in the
artifact root, separate from owner business evidence; the component tests retain
these records and check source pins/bytes without changing their original oracles.

The native tests exercise positive checkout reads, task writes, retained owner
output and real canonical source/package execution alongside outside-file and
metadata denial, traversal, symlinks, sibling archive and synthetic home paths,
input-write denial, unrelated inherited descriptors, and a task-owned Unix socket.
Only synthetic sentinels are used. macOS cancellation tests prove fork denial;
Linux cancellation tests prove detached descendant cleanup. Linux-only filter and
syscall tests must run on Linux and their macOS skips are not Linux evidence.
No new root-owner execution, capabilities, kernel policy change, Docker daemon,
or unconfined fallback is provided. A runner that cannot create the required
namespaces rejects payload execution.

## Required CI contexts and tested capabilities

The mandatory `Offline Linux containment verification` workflow runs as the
ordinary user on the supported `ubuntu-22.04` hosted runner. It requires working
user, mount, PID and network namespaces, bubblewrap, and libseccomp. Its startup
control must succeed with a nonzero UID before the payload checks execute.

| Context | Required work | Evidence boundary |
| --- | --- | --- |
| Ubuntu 22.04, ordinary user | All original 98 native cases plus retrieval-input/private-IP regressions; all 17 actual retrieval component baseline/mutant cases; complete old and opt-in canonical scripts, including 21 old and 14 opt-in tests and eight source/installed CLI matrix runs | Mandatory unprivileged containment and canonical verification; test failures remain fatal |
| Ubuntu 24.04 standard workflow | Original ordinary, privileged-owner, canonical and retrieval regression selectors, including the reporting execution case | Existing baseline regression coverage; privileged execution is not unprivileged containment evidence |
| Ubuntu 24.04 ordinary-user diagnostics | Bounded baseline, explicit user-namespace and current-UID mapping probes, plus kernel/runtime facts and retained stderr/status | Diagnostic capture is mandatory; its completion does not mean the namespace startup succeeded |
| Native macOS | Existing read/write, owner, staging and cancellation scenarios | Fork-denial evidence; Linux-only skips do not establish Linux behavior |

The read/input/seccomp and retrieval-input/private-IP test files run on Ubuntu
22.04 and stay excluded from the Ubuntu 24.04 ordinary suite. All pre-existing Ubuntu 24.04 selectors remain.
The 52 owner cases and 8 history cases also run on Ubuntu 22.04; these are duplicate
platform invocations of the same case IDs. Canonical checks repeated across
workflows likewise do not create additional unique conformance cases.

Qualification run [38244476304](https://github.com/Jevelopers-neatHack-2026/integration-evals/actions/runs/38244476304)
at source tree `15810f2ccfab3a97ebcef8ae5305a9cdf9522b89` passed all 98 native,
21 old and 14 opt-in tests without skips, under UID 1001 on Ubuntu 22.04.5,
kernel 6.8.0-1064-azure, bubblewrap 0.6.1, Python 3.13.9 and Node 22.23.3.
The real checkout, outside and symlink write probes reported EROFS while task
writes succeeded. Later candidates must obtain fresh mandatory CI and review.

The observed Ubuntu 24.04 ordinary-user environment cannot initialize the required
network namespace: its retained probes fail at loopback `RTM_NEWADDR` with EPERM.
That context remains unavailable for normal-user payload execution; its failures
are preserved and are not relabeled as successful containment. No host/LSM policy
change or privilege fallback is used. Full product acceptance remains blocked
until the actual composed runtime is qualified.

The trusted evaluator/runtime installation and launcher-controlled input roots are
part of the boundary. This is not isolation from a hostile process already running
as the evaluator's host user or from malicious changes to those trusted inputs by
that user. Generic owner redispatch remains denied by its existing guards; this
change does not authorize it, actual print integration, or product acceptance.

Implementation references: [Linux network namespaces](https://www.man7.org/linux/man-pages/man7/network_namespaces.7.html) describe abstract-socket isolation; [libseccomp rule semantics](https://github.com/seccomp/libseccomp/blob/main/doc/man/man3/seccomp_rule_add.3) describe native syscall resolution and multiplexed-syscall rewriting.
