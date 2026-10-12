# Download fixture evidence

Run the complete browser fixture after building the candidate:

```sh
npm run build
npm run verify:product -- --suite download --mode fixture --evidence-dir <new-evidence-directory>
```

The fixture uses a temporary browser profile with loopback-only resolution. The browser must support CDP
`Browser.setDownloadBehavior` with `allowAndName`, download events, and runtime execution-context unique IDs.
An unsupported API is a failure. `DOWNLOAD_ONLY` and `DOWNLOAD_VP` select diagnostic subsets; a subset is not
the complete download gate.

## Which bytes belong to which action

Each Download action is armed once in a fresh studio document. An observer installed before application code
records the exact selected control and actual Blob URL handed to the real download anchor. It forwards the
original anchor invocation unchanged, then hashes that same Blob. CDP supplies the document's execution-context
identity and frame ID. The collector accepts one native download with that exact Blob URL and frame, waits for
its GUID to complete, and reads only the file Chrome named with that GUID. The saved-file hash, length and
suggested name must agree with the observed producer. Filename order, arrival time and the first subsequent
download event do not establish action identity.

`download/download-evidence.json` retains per-case front, edited-front and back receipts and a full final audit.
The `native-downloads-<browser-session>-*` directories retain the GUID-named files. Each browser launch creates a new directory; no
download directory is cleared between actions or removed at teardown. An unknown, duplicate, incomplete or
ambiguous delivery, a reused document, or a Blob/file mismatch fails the audit. Events remain observed through
browser shutdown. Share, cancel, tab and unreadable-art cases must observe their path in the current document
and its selected control leaving the busy state before recording a no-download terminal. The unreadable-art
case must match the actual `bad_image` catalog message in that exact control's download root; a timeout or a
failure elsewhere in the document does not prove completion. A later producer
contradicts that terminal and fails the final audit.

## Controls and limits

The `native-controls-*` directories contain deliberately synthetic producers in real native browsers. Their
receipts, actual native GUID files and browser versions are retained separately from the application journey.
Controls cover a fresh B download; pending A completing while B is held; an unknown producer; two producers;
two native GUIDs for one Blob URL; a second arm in the same document; intentional saved-file corruption; and
a late producer after a claimed no-download terminal; and an enabled control with a timeout message and a held
producer. The latter must refuse completion even with an unrelated bad-image message elsewhere, then collect
the actual native output when the producer is released. Expected rejections qualify only when the corresponding
native action actually occurred. The corruption control also preserves the original PNG before its deliberate edit.

The original image checks still apply: dimensions, shape, content, screen parity, a different-stub negative,
edited-title changes and back parity. Receipt success proves which Blob was delivered. It does not prove that
the application rendered the right version or pixels. An unchanged edited Blob remains a failed edit assertion;
a failed reference capture remains failed. Preserve previous failed evidence and label synthetic controls and
diagnostic subsets when handing evidence to reviewers.

## First-capture qualification and diagnostic state

The complete gate retains the original matrix and requires three original/edited first-capture pairs for
`pale/researched` at each of 390 and 1440 pixels: the baseline pair, then two additional cold-browser pairs per
viewport. All six pairs and twelve first-capture comparisons must finish and pass. Every first screenshot has
a unique capture ID, file and SHA-256; its result cannot be overwritten by a subsequent comparison. The fixed
plan continues after a failed pair or page exception. A missing capture, comparison, pair, invalid receipt or
any failed assertion fails the run even if every later pair passes. The baseline matrix keeps its shared browser,
profile and cache. Each of the four additional pairs starts one new browser process with its own newly created
temporary profile, preventing browser cache or decoded-image reuse from preceding pairs. Its original and edited
actions then share that pair's process/profile: the cold claim is at pair start, not at the screenshot instant.
Only the baseline's first studio load/download is throttled.
The `captureQualification` record states the selected scope and exact expected, recorded and compared counts.
`DOWNLOAD_ONLY`/`DOWNLOAD_VP` retain their diagnostic-subset meaning and do not qualify the complete gate.

Before application navigation, `browserSessions` records the actual browser PID from `SystemInfo.getProcessInfo`,
the throwaway profile argument from `SystemInfo.getInfo`, filesystem creation metadata, blank initial targets,
and the launcher's source hash. Only the profile path hash is retained; raw command lines, GPU/model
data and target URLs are omitted. Protocol, size, path, creation-time or uniqueness failures leave isolation
unconfirmed and fail the pair. These startup metadata queries can affect timing; they do not establish pixel
readiness. A generated session label alone is not isolation evidence.

The runtime workflow first runs `node scripts/check-download-browser-identity.mjs --evidence-dir <directory>`
before dependency installation and application checks. This single-session native preflight creates no application
page and performs no capture; it does not qualify the six-pair matrix. Its JSON is retained by the workflow's
existing always-run artifact step even on failure. Startup target evidence records at most 32 fixed type/URL/subtype
classes, explicit omissions and precise rejection reasons; no target title, ID or URL is retained. Internal pages
and workers are still rejected by the unchanged blank-target rule. A valid task profile can be retained privately
for removal verification even when target validation fails; confirmed removal never converts that identity failure
into a pass. The launcher requests `about:blank`; diagnostics do not infer which startup target caused a failure
that omitted its inventory. `browser_ui` is classified explicitly but remains rejected, including at a blank URL.
For that type only, exact pinned tab-search, omnibox-popup and omnibox-popup AIM URLs receive fixed
`browserUiUrlClass` names. Other URLs, including query/fragment variants, remain `unrecognized`; raw URLs are
never retained. These diagnostic names do not accept any target or imply that every startup target was blank.

Download qualification requests the launcher's explicit `downloadIsolation` option for its baseline session,
all four additional sessions and the identity preflight. Only this option adds `--disable-extensions` and
`--disable-component-extensions-with-background-pages`; other browser suites keep their existing arguments.
The `launchPolicy` field records a request, not proof that Chrome honored the flags. Actual startup target,
process/profile and cleanup checks still decide qualification, and remain unchanged. This changes the download
verifier's browser environment; it is neither a compositor repair nor evidence of image readiness. The flags and
diagnostic type are defined in Chromium revision `b510e9d7cd3a2fbd78d0ddc42234103206c5f78d`, the measured browser
revision of the retained failed preflight: [extension switch](https://github.com/chromium/chromium/blob/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/extensions/common/switches.h),
[component switch](https://github.com/chromium/chromium/blob/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/chrome/common/chrome_switches.h),
[component loading](https://github.com/chromium/chromium/blob/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/chrome/browser/extensions/component_loader.cc)
and [browser UI type](https://github.com/chromium/chromium/blob/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/content/browser/devtools/devtools_agent_host_impl.cc).
The [pinned internal URL constants](https://github.com/chromium/chromium/blob/b510e9d7cd3a2fbd78d0ddc42234103206c5f78d/chrome/common/webui_url_constants.h)
ground the fixed diagnostic names; they are not an observed target inventory.

Each session's collector starts before application navigation and remains attached through bounded browser
shutdown. Its final snapshot is then retained and the listener detached. Process exit, profile removal and
complete collector cleanup must be confirmed before a pair can qualify, even when both first images passed.
Every action, producer, native GUID, event and violation is aggregated with its `browserSessionId`; equal IDs
from separate processes are not deduplicated. Per-case receipts and `downloadReceipts.directories` bind every
saved GUID to its own session directory. Missing sessions, unsupported setup, late events and incomplete cleanup
remain explicit and fail closed while the remaining fixed pairs are still attempted. There is no browser retry.

Only the download launch mode adds counted profile removal after confirmed process exit. It has a two-second
overall observation budget and at most four attempts, retaining fixed error codes, removal/absence status and
every requested delay. Only the transient errors documented by [Node22.23.3](https://github.com/nodejs/node/blob/v22.23.3/doc/api/fs.md#fsrmsyncpath-options)
permit 100/200/300ms cleanup backoffs; each individual removal disables hidden retries. These filesystem delays
occur after the browser exits and never delay or retry an image capture. Unknown errors, missing receipts,
deadline expiry or unverified absence remain incomplete; a late filesystem completion cannot revise a timeout.
The manager also checks profile absence independently after close. A failed removal keeps the already proven
process exit truthful, but still fails cleanup and session qualification. Other browser consumers keep their
existing close behavior. No profile path or raw filesystem error message is retained.

The existing final pre-screenshot evaluation also records bounded computed state for the actual image, figure
and up to sixteen ancestors per image, including ancestors above the figure. It records numeric transforms,
opacity, visibility, mask/filter presence, four allowlisted numeric tilt variables, and up to four active
Web Animations API entries per node. Animation names, keyframes, CSS URLs, arbitrary custom properties, classes,
text and raw image sources are omitted. JavaScript animation loops are not enumerated by `getAnimations()`;
zero animations therefore does not establish that a preview is stationary. Source strings are hashed only after
the first screenshot, with an explicit size limit. Image, ancestor, node, source and snapshot omissions are recorded.

A passive `LayerTree` listener starts before navigation. At the screenshot request and response it freezes
separate received-event sequences and the latest bounded layer tree. The optional protocol is experimental:
enable errors/timeouts, absent trees, caps, dropped events and listener cleanup are explicit. Events are associated
with the CDP session since its last observed main-frame navigation; they have no committed-screenshot-frame
identifier and do not attest that artwork pixels were composited. The exact retained pre-first node references
are mapped to backend node IDs only after the screenshot, with identity/connectivity/ancestry checks before and
after mapping. Replacements or unavailable mapping remain unavailable. An image may share an ancestor's layer;
absence of a dedicated image layer does not prove a paint failure.

Computed-style reads can flush layout, and diagnostic instrumentation can affect timing. These effects are
disclosed in each record; they are not readiness predicates. The original screenshot bytes and comparison
tolerances remain authoritative. A failed comparison still saves exactly two separately named diagnostic frames
at requested offsets of 100 and 500 ms after the failed comparison completes. Those later frames cannot pass or
replace the first one. This bounded qualification strengthens evidence for the retained intermittent capture
failures; it does not demonstrate a compositor repair or establish that the application caused the mismatch.
