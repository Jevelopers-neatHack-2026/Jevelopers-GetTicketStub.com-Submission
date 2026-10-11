# Linux renderer security policy

`playwright-1.64.0.seccomp` is an unchanged copy of Playwright's official
Docker seccomp profile from commit `606ecd8b34bac100db32561b6278ffd76e5eb3cd`:

https://github.com/microsoft/playwright/blob/606ecd8b34bac100db32561b6278ffd76e5eb3cd/utils/docker/seccomp_profile.json

SHA-256: `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
The upstream project licenses this file under Apache-2.0:
https://github.com/microsoft/playwright/blob/606ecd8b34bac100db32561b6278ffd76e5eb3cd/LICENSE

The profile denies unlisted syscalls with `SCMP_ACT_ERRNO`. Its namespace
exception permits `clone`, `setns` and `unshare`, as documented by
[Playwright](https://playwright.dev/docs/docker#crawling-and-scraping).
This permits an unprivileged Chromium process to construct its user/PID/network
sandbox. It does not grant host capabilities. Capability-dependent rules in the
upstream profile remain inactive because the container drops **all** capabilities.
The runner checks the exact profile bytes before asking Docker to use it, then
compares the daemon's inspected seccomp JSON with that pinned profile.

`run-offline.mjs` runs on the Linux CI host using the checksum-verified Node
archive. It records the host IPC/network namespace identifiers from `/proc`,
mounts that run-specific file read-only, and creates the verification container
as the non-root checkout owner. It requires private IPC, a private 1 GiB `/dev/shm`,
network `none`, zero added capabilities, capability drop `ALL`, no new privileges,
read-only root filesystem, and enforced `docker-default` AppArmor. It validates
actual Docker inspect results before starting and after completion and logs
only the selected security facts. It does not edit host policies or sysctls.

The runtime additionally observes UID/GID, all capability sets, seccomp filtering,
no-new-privileges, AppArmor enforcement, `/dev/shm` filesystem/size, network
interfaces and namespace identifiers. IPC/network identifiers must differ from
the host; only loopback may exist. Missing or unknown observations reject the
render. This is evidence within trusted immutable CI, not cryptographic attestation
against a malicious checkout or host.

Every Linux browser launch probes `chrome://sandbox` before opening the offline
calibration context. Chromium's pinned implementation obtains these fields from
the live zygote's renderer sandbox status:

https://github.com/chromium/chromium/blob/156.0.8078.4/chrome/browser/ui/webui/sandbox/sandbox_internals_ui.cc

The corresponding table labels are defined in:

https://github.com/chromium/chromium/blob/156.0.8078.4/chrome/browser/resources/sandbox_internals/sandbox_internals.ts

The probe requires namespace layer 1, PID/network namespaces, Seccomp-BPF and
TSYNC. It also obtains live renderer PIDs via browser CDP `SystemInfo.getProcessInfo`
and reads their `/proc/<pid>/status`: non-root UID, nested PID namespaces, no
effective/permitted/inheritable/ambient capabilities, no new privileges and at
least two seccomp filters (the container filter plus Chromium's additional filter).
Any failed probe or launch fails closed with `SANDBOX_POLICY_FAILURE`; there is
no fallback. Playwright's `--disable-dev-shm-usage` default is removed so Chromium
can use the sized private shared-memory mount.

`linux-browser.test.mjs` executes only as an additional mandatory Linux CI suite.
It fails immediately on another OS. It observes an accepted real browser, rejects
a deliberately unsandboxed **negative-test browser**, and forces a real failed
sandbox launch to verify one attempt with no retry. The negative test is not a
rendering path or a security exception. Unit tests exercise missing/disabled
probe fields and forbidden inspected container overrides on macOS too.

Run the revised workflow on the exact candidate before claiming Linux success.
If the host's AppArmor/kernel policy or pinned profile denies namespace creation,
retain the failed job evidence and diagnose it. Do not replace a control with
unconfined policy, host IPC, capabilities, privileged mode or a kernel change.

## Bounded launch diagnosis

The candidate `336e14b` failed on Linux runs `38093120634` and `38093124265`.
Docker inspect confirmed its required container settings; build/typecheck/format
passed, but the first sandboxed browser launch failed and the integration before
hook caused 19 failures. The original sanitized error omitted Chrome's reason.
These failures do not establish a namespace, AppArmor, seccomp or filesystem cause.

Launch failures now preserve only a closed list of cause categories from bounded
Playwright Chrome stderr lines. Command lines, paths, URLs, raw stderr, stack
traces, arbitrary error properties and unknown messages are never copied into
the runtime failure receipt. `UNKNOWN_LAUNCH_FAILURE` remains an explicit result.
Several recognized signatures may be reported together; none certifies the
enforcing policy layer. In particular `SANDBOX_UNAVAILABLE` does not prove
AppArmor denied user namespaces, and `THREAD_CREATE_DENIED` does not prove seccomp.

Before the unchanged mandatory test suites, `launch-diagnostic.mjs` logs actual
container observations plus two bounded unprivileged namespace probes (user and
user/PID/network), a run-specific temporary-file create/read/lock probe, numeric
UID's passwd-entry presence and two read-only kernel policy indicators. Each
subprocess has a three-second timeout and 16 KiB output limit. Outputs are fixed
status/reason enums; raw child output and identity data are discarded. The probes
do not create Chrome configuration directories or modify host/kernel policies.
Their success is not renderer sandbox attestation, and an EPERM reports its
enforcing layer as unknown. The renderer still requires its original effective
sandbox probes, and every existing suite remains required.

No policy repair is justified until the revised remote execution observes a
specific cause. Chromium's [AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)
describes kernel/unconfined workarounds that are prohibited in this task. If
observed host policy blocks the permitted configuration, retain the cause
evidence and stop that path; do not silently adopt those workarounds.

### Actual Chromium startup probe

Full logs of `b6de184` runs `38094541342` and `38094543656` report
`ZYGOTE_START_FAILURE`, with both namespace probes successful. This is a downstream
startup symptom, not an identified syscall or enforcing layer. Playwright can
rewrite sandbox startup logs before returning an exception, so classifying that
exception alone can lose information.

`browser-launch-probe.mjs` runs a fixed subprocess that calls the unchanged
`openOfflineBrowser(loadPins())` adapter. Only that subprocess enables
`DEBUG=pw:browser`, with colors and debug timestamps disabled. Its stdout is
discarded, stderr is drained while retaining at most 64 KiB in memory, and the
probe has a 40-second limit. On timeout it kills its own launched browser process
group (identified by Playwright's launch event) and subprocess. Cleanup errors
are reported as a fixed boolean. The probe adds no browser flags or input surface.

The parser accepts only Playwright-framed browser stderr lines, bounds lines and
their lengths, and maps a static list of Chromium source names to finite source
enums. Known operation names and errno text become finite enums; unknown source
names, messages, paths, URLs, command lines, stdout, environment and exception
strings never escape. Browser process signals and launch/exit event presence are
also finite observations. An unknown cause stays unknown. Raw streams are never
saved or uploaded. Source recognition alone does not identify the enforcing layer.

The parser/lifecycle tests run before the diagnostic and existing mandatory
suites. Their synthetic credential/zygote examples verify sanitization; they are
not evidence that this Linux failure is caused by chroot, capabilities or seccomp.
The real adapter lifecycle test also verifies the installed Playwright debug
format and confined subprocess capture; success on macOS does not prove Linux.
After this diagnostic commit, the supervisor must execute fresh Linux CI and
inspect `launchDiagnostic.browserLaunch` before selecting a repair. Every original
render/security test remains mandatory; no probe success resolves ROOT-R1.

### Validated source locations and raw startup categories

Runs `38095530640` and `38095533118` on `7c5e93e` observed a fatal zygote-host
premature exit, browser `SIGABRT` and an unmapped severe line. Capture completed
without truncation or cleanup failure. The lower cause remains unknown; that
unmapped line could be an ancillary error rather than the cause.

Schema 3 adds `browserLaunch.sourceSites`, `startupCauses` and
`unvalidatedSevereLine`. A source location is emitted only when its canonical
relative path or unambiguous basename belongs to `chromium-launch-sources.json`,
and its positive decimal line is within the verified file's line count (also
bounded to five digits). Bounded build-relative `../` prefixes are removed before
catalog lookup. Arbitrary/absolute paths, URIs, unknown filenames, out-of-range
lines and raw messages are discarded. Only the upstream basename, numeric line,
severity and a fixed cause category reach the receipt. `UNKNOWN_CAUSE` is explicit.
The original capture limits and privacy boundary remain unchanged.

The 208-source catalog is derived from Chromium commit
`f842f52ef39fd97b449eb27cff414bf05a98ddce` (tag `156.0.8078.4`). Each source's bytes
were fetched and matched to its upstream Git blob hash before counting lines.
Coverage includes base process/posix/threading, content zygote/app/browser-main,
Linux sandbox/policy, D-Bus, check/logging and Linux Crashpad client sources;
tests/fuzzers/benchmarks are excluded. It is a finite diagnostic catalog, not
complete Chromium coverage. Unknown sources remain undisclosed and flagged.
The test binds its browser version to the existing renderer pin.

`startupCauses` recognizes exact upstream `RAW_LOG`/`RAW_CHECK` strings, which
can lack a source header. Their implementation references are:

- [pre-exec failures](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/base/process/launch_posix.cc#L401)
- [UID/GID/setgroups checks](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/sandbox/linux/services/namespace_sandbox.cc#L57)
- [chroot check](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/sandbox/linux/services/credentials.cc#L56)
- [raw-check formatting](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/base/check.h#L338)

No inferred source/line is attached to a raw signature. Zygote-host premature-exit
logs additionally classify the child exit as `-1`, `1`, `127` or other using fixed
categories. [The pinned wait implementation](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/base/process/process_posix.cc#L385)
returns `-1` for a signaled child; browser `SIGABRT` alone does not identify the
child signal. Exit `127` has several possible pre-exec causes, so it does not
certify an exec or filesystem diagnosis.

The next parent CI run must capture these new fields, then compare an observed
location against its catalogued blob at the pinned commit. A raw category can
select a specific syscall/map/exec probe; an unknown cause cannot justify a flag,
policy, capability or host change. Synthetic test locations/categories exercise
the parser and do not assert that any is the actual Linux failure.

### Chroot policy derivation for ROOT-R1

Runs `38096242798` and `38096245793` on `4953e2b` observed
`SANDBOX_CHROOT_CHECK_FAILURE`, followed by the zygote-host hello-message fatal
at line 254. The pinned Chromium `credentials.cc:56` requires
`chroot("/proc/self/fdinfo/")`; it then changes cwd to `/`, exits the helper and
leaves the sandbox process rooted in that deleted fdinfo directory. Namespace
creation and temporary-file success do not establish this filesystem step.

The original Playwright profile permits `chroot` only with `includes.caps =
["CAP_SYS_CHROOT"]`. [Docker's profile compiler](https://github.com/moby/profiles/blob/2ceae35d351c156cb5a8efc0fdc4a08cf94569d8/seccomp/seccomp_linux.go#L144)
filters that rule against the container's initial bounding capabilities.
With drop `ALL`, the rule is absent and the inherited deny-by-default filter
blocks `chroot`, including after Chromium creates its private user namespace.
This is a specific missing syscall permission; it is not evidence that all user
namespace operations or the host's AppArmor policy are unavailable.

`playwright-1.64.0.seccomp` remains byte-identical upstream, SHA-256
`cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`.
`playwright-1.64.0.chromium-chroot.seccomp` is the full original parsed policy plus
one unconditional `SCMP_ACT_ALLOW` rule for **only `chroot`**, SHA-256
`6190132a2eccb9bd3b06819a2d80887039f295ad91ef11fb0125c527ca9d3a79`.
`seccomp-policy.mjs` validates both hashes and rejects every other structural
change. The original conditioned rule is retained, as are the original default
action, architecture mappings and all other syscall rules. The upstream license
and commit provenance above still apply; this derived file is not claimed to be
the unmodified official profile.

Seccomp cannot validate a pathname through a syscall pointer. The narrow rule
therefore permits the syscall to reach its native permission checks.
[Linux still requires CAP_SYS_CHROOT in the caller's current user namespace and
applies filesystem/LSM checks](https://github.com/torvalds/linux/blob/v6.14/fs/open.c#L604).
It grants no capabilities, privileges or host namespace access. The non-root
parent keeps all capabilities dropped, no-new-privileges, enforced AppArmor,
private IPC/sized shm, network none and read-only rootfs. Chromium's own namespace,
capability-drop and seccomp layers remain mandatory with no fallback.

Before rendering, the host runner executes two fixed chroot probes under the
same fully inspected container controls, changing only the original/derived
profile. It requires the original to report `CHROOT_EPERM` inside a disposable
user/PID/network namespace and the derived to report `CHROOT_ENTERED_FDINFO`.
Both must still reject chroot in the parent container user namespace. The GNU
probe enters the fixed fdinfo root and cannot execute its fixed `/usr/bin/true`
there; all subprocess output is bounded and converted to finite statuses.
The probe uses map-root-user only inside a disposable child namespace, never a
root container or renderer. It is a syscall comparison, not Chrome attestation.

The unchanged mandatory Linux browser suite also creates a live fixed page and
observes each renderer's `/proc/<pid>/root`. It must identify Chromium's deleted
proc-fdinfo chroot, in addition to the existing actual namespace/seccomp/UID/
capability observations. Unknown or unreadable filesystem state fails closed
with a fixed error; no raw root path is logged. The negative-test browsers and
all original render/font/network/determinism tests remain mandatory.

Local macOS policy/privacy tests cannot prove this Linux repair. The parent must
observe the old/new syscall comparison, successful actual sandboxed rendering,
live renderer chroot/namespace/seccomp evidence and passing required checks,
then obtain fresh independent review. Any further AppArmor/kernel/filesystem
failure remains a blocker requiring its own evidence, not broader permissions.

### Live-root observer diagnosis

Runs `38097026987` and `38097030195` on `ab55c0f` establish the original/derived
chroot syscall comparison and successful secure browser startup. The original
render/network/font tests pass. The new strict renderer-root predicate fails;
its raw root path was intentionally withheld. That failure alone does not
identify an unsandboxed renderer, a different process selection, or a kernel
path-rendering difference.

`rendererRootDiagnostic` now reports only finite root shape, filesystem class,
root identity relative to the container root, directory state and acceptance by
the existing namespace/seccomp status guard, for at most 16 renderer processes.
Directory inspection reads only one entry and never reports its name. Raw root
paths, inode values, process IDs, page URLs and arbitrary error text are not
printed. These are diagnostic observations; the original strict chroot predicate
still runs and rejects unknown roots.

Each process is marked `TARGET_PAGE_RENDERER` or `OTHER_RENDERER` using the fixed
page's root frame and pinned Chromium trace metadata. [SystemInfo enumerates all
renderer hosts](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/content/browser/devtools/protocol/system_info_handler.cc#L348),
so its renderer type alone does not associate a process with the calibration
page. [TracingHandler records a frame token and OS process ID](https://github.com/chromium/chromium/blob/f842f52ef39fd97b449eb27cff414bf05a98ddce/content/browser/devtools/protocol/tracing_handler.cc#L212)
and emits that page's frame tree in `TracingStartedInBrowser`. The observer uses
a 64 KiB trace buffer, at most 256 events/64 frames per event, and a five-second
completion bound; data loss, missing/ambiguous identity or absent target PID fails
closed. Only matched numeric identity is retained privately; trace messages are
not saved or logged. Tracing is stopped and its CDP session detached.

[Linux proc readlink uses d_path](https://github.com/torvalds/linux/blob/v6.14/fs/proc/base.c#L1819),
which appends ` (deleted)` [only for an unlinked dentry](https://github.com/torvalds/linux/blob/v6.14/fs/d_path.c#L285).
Chromium's helper chroot-and-exit sequence establishes the fdinfo filesystem
sandbox, but does not itself specify that display suffix. The finite diagnostic
distinguishes linked/deleted fdinfo shapes from the container root or other roots.
No alternate shape is accepted until its actual Linux facts and the pinned
filesystem implementation justify a corrected predicate.

The native unsandboxed negative browser now invokes the direct root observer as
well as the original sandbox observer. It must fail specifically at the strict
root predicate; an earlier tracing/identity failure cannot count as that negative
proof. The secure positive case retains all original checks and reports finite
diagnostics before a failed predicate. Parent CI must collect these new facts
before the next correction; local page-binding success is not Linux root proof.

### Source-backed root invariant and liveness correction

Runs `38097904204` and `38097907996` on `0282c2d` observed the bound sandboxed
page renderer as linked proc-fdinfo, procfs, distinct from the container root,
with directory task/root unavailable and accepted namespace/seccomp state.
The actual unsandboxed negative renderer had the container root, non-procfs,
accessible entries and rejected namespace/seccomp state. The deleted-string-only
predicate rejected an observed isolated root representation.

The suffix is not the security property. [Proc task dcache flushing is explicitly
an optimization](https://github.com/torvalds/linux/blob/v6.14/fs/proc/base.c#L3470)
that does not guarantee cached entries disappear. `d_path` adds ` (deleted)` only
when the dentry is unlinked. Chromium instead relies on its helper exiting after
chroot: [fdinfo permission returns ESRCH for a missing owning task](https://github.com/torvalds/linux/blob/v6.14/fs/proc/fd.c#L85),
and [fdinfo iteration returns ENOENT](https://github.com/torvalds/linux/blob/v6.14/fs/proc/fd.c#L248).
A cached linked label can therefore coexist with an unusable fdinfo directory.

The corrected observer accepts either linked/deleted fdinfo representation only
with **all** these observed facts: procfs root, root device/inode distinct from
the container root, anchored fdinfo directory owner gone (exact ESRCH/ENOENT),
the existing namespace/seccomp/UID/capability guard accepted before and after,
stable renderer generation and stable actual root identity. Empty directories,
access denial, unknown errors and the old ambiguous `TASK_OR_ROOT_GONE` category
are rejected. A raw pathname alone can no longer pass attestation.

`renderer-root-capture.mjs` opens the original renderer proc directory and its
root using [Linux O_PATH/O_DIRECTORY/O_CLOEXEC metadata descriptors](https://github.com/torvalds/linux/blob/v6.14/include/uapi/asm-generic/fcntl.h#L83).
The proc anchor retains the original task identity instead of following a reused
numeric PID. The observer checks PID/start-time generation and live running/
sleeping state before and after the root probes. The root anchor remains open
while probing its filesystem and one directory entry; only an error from that
anchored directory stage can mean a dead fdinfo owner. Root inode identity is
compared to the renderer's current root again. Both page-to-process binding and
the complete renderer process snapshot must remain unchanged. All anchors close
in `finally`; neither descriptors nor private stat/root values reach the receipt.

Thus a genuinely exited/stale renderer or a changed/reused PID cannot be blessed
by the fdinfo owner's expected absence. `rendererRootDiagnostic` schema 2 adds
the exact dead-owner errno class, stable process generation and stable root
identity. Successful `linuxSecurity.rendererChroots` records the joint isolated
root invariant for the bound page and other observed renderers. All previous
all-renderer checks are retained; there is no silent selection narrowing.

Regressions cover linked/deleted full positive evidence, actual unsandboxed
negative rejection at this invariant, missing fields, stale/unknown observations,
PID reuse/zombies, root replacement, and a mandatory real Linux process that
exits after proc/root anchors are acquired. The original/derived policy comparison,
all native sandbox checks and all container/launch controls remain unchanged.
The corrected Linux observer and real exit-race case still require parent-owned
execution and fresh independent review before ROOT-R1 can close.
