# PP-01A runtime foundation

This package includes a synthetic local calibration harness and private
composition/output mechanics. The public ESM exports are
`renderCalibration(directory)`, `verifyRuntime(directory)` and
`VerificationFailure`; the root API still exposes runtime verification only.
Production contracts and supplier specifications await PP-01B and the external
owners. No supplier, approval, purchase, identity or ledger authority exists.

## Run

Use the official Node **24.21.0** bundle with bundled npm **11.19.0**, verified
against [Node's checksums](https://nodejs.org/dist/v24.21.0/SHASUMS256.txt).
Put its `bin` directory first on PATH. Exact archive, dependency, font, browser
and platform identities are in [pins.json](pins.json) and package-lock.json.

```sh
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8
npm ci
npm run browser:install
npm run build
npm run typecheck
npm run format:check
npm test
npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/local-macos
```

Installation requires registry/CDN access; rendering and checks use installed
local resources. The runtime guard rejects mismatched Node/npm/ICU/OS/tools,
missing pins, browser revision/version/executable hash changes and font/license
changes. There is no global-browser or system-font fallback.

All three verification flags are mandatory. Missing/unknown/duplicate/extra
arguments fail with sanitized JSON stderr and exit 1. `runtime` verifies only
the local calibration. Several `external-blocked` leaves run private local
suites, record their evidence, then exit 1 with the missing external dependency;
`api-contracts` remains unimplemented. `release` records each required leaf and
exits 1 with `RELEASE_INCOMPLETE` while any leaf or immutable external pin is
missing. Canonical shared-contracts, accepted supplier, app and finance consumer
pins are null. Passing private mechanics does not meet supplier or consumer
acceptance.

## Calibration profile

The trusted SVG is 101.6 x 50.8 mm (4 x 2 inches), 384 x 192 CSS/device pixels
at 96 px/inch, and exactly one 288 x 144 point PDF page. It tests ligatures,
AV kerning, accents, digits, punctuation and color rulers. PNG does not promise
print-DPI metadata; physical size comes from the locked SVG/PDF profile.

Playwright 1.64.0 launches full Chromium 156.0.8078.4, revision 1248. The mac-arm64
installed executable and the linux64 CDN archive/executable were independently
hashed; their accepted hashes are in the lock. The Linux image fixes ancillary
browser libraries. Local macOS frameworks remain a separate platform profile.

Context requests are aborted, offline mode is enabled, service workers and
WebSockets are denied, page scripts are disabled, and fixture CSP permits only
embedded data fonts/images and inline styles. Chromium flags disable background
networking and DNS. Fetch and remote-font probes exercise denial; a real listening
loopback server test sees zero requests. Calibration itself must make zero
requests. Local macOS evidence does not claim an OS-wide network namespace or
packet capture. CI disables OS networking with Docker `--network none` for the
complete build/typecheck/format/test/runtime phase after installation.

Linux rendering enables Chromium sandboxing and fails closed on launch or
effective-state probe failure. CI uses a non-root identity, private IPC with
1 GiB shared memory, zero capabilities, no new privileges, Docker's enforced
`docker-default` AppArmor policy, and a byte-pinned seccomp policy derived from
the original Playwright profile by adding only Chromium's required chroot syscall. The original profile
and exact derived difference are preserved and audited. Docker inspect,
host/container namespace comparisons, live `/proc` observations and Chromium's
`chrome://sandbox` report provide separate configuration and effective-state
evidence. See [the auditable policy and probes](../../scripts/security/README.md).
macOS receipts record sandbox-enabled launch configuration without claiming the
Linux namespace/seccomp observations.

Sandbox launch failures expose only fixed diagnostic categories. Linux CI also
records bounded namespace and temporary-filesystem diagnostic probes without
printing raw Chrome/utility errors. Diagnostics do not replace effective sandbox
checks or authorize policy relaxation. Both initial secure candidates failed in
Linux CI; the second reported `ZYGOTE_START_FAILURE` while generic namespace
probes passed. A bounded subprocess observes the same adapter launch through
Playwright's browser debug stream, retaining only finite Chrome source,
operation, errno and signal categories. Raw subprocess streams stay private in
memory and are discarded. Later Linux runs traced the failure to
`SANDBOX_CHROOT_CHECK_FAILURE` (the original profile's conditional `chroot`
rule is absent once all capabilities are dropped), which led to the derived
seccomp policy above; subsequent runs recorded successful secure browser startup
and then corrected the live renderer-root observer. No launch flags, container
capabilities, browser pins or effective sandbox requirements were relaxed. The
run-by-run record, and what the latest observer revision still requires, is in
[the security policy README](../../scripts/security/README.md).

The unmodified Latin normal 400 WOFF2 comes from `@fontsource/noto-sans@5.3.0`
(upstream Google Fonts metadata v42, last modified 2025-09-11). npm locks tarball
integrity. Original copyright and full SIL OFL 1.1 are preserved in
`src/assets/fonts/OFL.txt`; font and license hashes are checked. No host fonts
were copied. Fontkit checks coverage, ligatures, kerning and independent shaping
widths. CDP `CSS.getPlatformFontsForNode` checks each painted line uses only the
custom `NotoSans-Regular` font. Unsupported code points fail. This proves only
the Latin calibration corpus; arbitrary SVG, CJK, RTL, emoji, variable fonts,
production typography and missing-glyph repair remain outside this foundation.

PNGJS independently decodes pixels/dimensions and checks rulers and visible ink.
PDF.js independently parses page geometry and text, joining same-baseline chunks
while preserving spaces, then comparing NFC forms. Source SVG code points remain
unchanged. PDF-lib checks the sole PDF font is a subset of NotoSans-Regular with
an embedded TrueType program. It normalizes creation/modification dates to 2000-01-01 UTC and
reserializes without object streams. Receipts separately record raw hashes,
decoded PNG RGBA hashes, normalized PDF byte hashes and limited PDF semantic
hashes (geometry/count/NFC text). Normalized repeat hashes must match. Raw PDF
bytes may differ due to timestamps. The semantic hash is not a visual equivalence
proof; no cross-OS byte identity is claimed.

This is an sRGB calibration profile, not CMYK/ICC, PDF/X, spot-color, trim/bleed,
supplier tolerance or printer certification. Renderer/font/profile changes need
new fingerprints and evidence; old hashes cannot silently certify new output.

## Evidence and remaining acceptance

`out/evidence/<profile>/runtime.json` records Node/npm/tools, ICU 78.3, Unicode
17.0, CLDR 48.0, en-US/UTC, OS/kernel/architecture, lockfile/browser/font/fixture
hashes, painted font usage, denial probes and two renders. Artifacts are in
`runtime/render-1/` and `runtime/render-2/`. Receipts use synthetic text and relative
artifact names; they exclude absolute paths, request URLs, environment dumps,
PII, secrets and third-party exception strings. Valid failures write `<suite>.json`;
argument/write failures also exit nonzero. Use a dedicated output directory:
the fixture adapter writes its named local artifacts there.

On 2026-10-10 Microsoft Container Registry returned the official Noble amd64
manifest `sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462`
and config `sha256:847f71bbb3f17fc1032d50d75bf6fb3fdcf188b16dff81f24667fe9ae9409e01`.
The registry config confirms Ubuntu 24.04/amd64 and installed Playwright browsers.
CI uses that immutable image and a full SHA-pinned checkout action. It downloads
a checksum-verified Node bundle instead of trusting the image's Node patch.
The Linux runtime guard requires that image reference, Ubuntu 24.04 and x64.
The image environment variable alone is not cryptographic attestation: provenance
comes from the workflow's digest-pinned Docker invocation. The host kernel is
recorded, not fixed by the userland image.

Docker's daemon was unavailable during the ROOT-R1 security revision. The earlier
Linux runs passed rendering tests with disabled sandbox and host IPC; those runs
do not verify the revised security configuration. Revised Linux execution is
**pending remote CI**; macOS receipts do not certify Linux. CI prints sanitized
runtime and observed security receipts to its job log. The workflow has no
deploy/publish/provider/comment/issue-close steps. Linux CI execution, accountable
reviewer sign-off and merged implementation evidence remain required for closure.
Global acceptance IDs and their trackers remain under existing owners.
