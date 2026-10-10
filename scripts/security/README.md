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
