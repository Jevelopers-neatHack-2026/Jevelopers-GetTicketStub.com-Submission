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
`/dev` and PID-namespace `/proc`, retains `--unshare-pid`, `--die-with-parent`, and
`--unshare-net`, and receives an offline seccomp filter compiled with the system
`libseccomp.so.2`. The filter rejects socket creation/use, socketpair, and io_uring
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

The native tests exercise positive checkout reads, task writes, retained owner
output and real canonical source/package execution alongside outside-file and
metadata denial, traversal, symlinks, sibling archive and synthetic home paths,
input-write denial, unrelated inherited descriptors, and a task-owned Unix socket.
Only synthetic sentinels are used. macOS cancellation tests prove fork denial;
Linux cancellation tests prove detached descendant cleanup. Linux-only filter and
syscall tests must run on Linux and their macOS skips are not Linux evidence.
The added CI read/filter lane runs as the ordinary runner user. No new root-owner
execution, capabilities, kernel policy change, Docker daemon, or unconfined
fallback is provided. A runner that cannot create the required namespaces fails.

The trusted evaluator/runtime installation and launcher-controlled input roots are
part of the boundary. This is not isolation from a hostile process already running
as the evaluator's host user or from malicious changes to those trusted inputs by
that user. Generic owner redispatch remains denied by its existing guards; this
change does not authorize it, actual print integration, or product acceptance.

Implementation references: [Linux network namespaces](https://www.man7.org/linux/man-pages/man7/network_namespaces.7.html) describe abstract-socket isolation; [libseccomp rule semantics](https://github.com/seccomp/libseccomp/blob/main/doc/man/man3/seccomp_rule_add.3) describe native syscall resolution and multiplexed-syscall rewriting.
