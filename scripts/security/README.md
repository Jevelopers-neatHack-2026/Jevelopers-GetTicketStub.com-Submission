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
