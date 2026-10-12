# CI workload progress diagnostics

Refs #3 (PP-12). This is a diagnostic supplement, not release evidence or a
change to the required test inventory, timeouts, renderer, sandbox or pins.

## Problem and scope

On main `89b5dd63c0a23dc27e62cfc235daa40dfe6d2002`, workflow run
`38232678564` did not produce the standalone workload receipt before its job
was cancelled. The aggregate refused the incomplete union. The existing
runner buffers a sequential native test process and only writes its receipt
after that process finishes. The missing receipt therefore cannot identify
which entry file was last observed executing. This does not establish the
cause of the cancellation or prove that a particular production test hung.

## Protocol

The custom reporter emits at most two diagnostic records per entry-file
path: `started` on the first `test:dequeue`, and `summary` when the native
per-file summary is observed. A global summary does not create a file record.
The `entryFile` field takes precedence over `file`, matching the existing
receipt attribution for imported tests. The path is made relative to the
child working directory, normalized to `/` separators, and SHA-256 hashed.
It is a **path digest**, not a digest of the source or compiled file contents.

The private stderr wire format is `PP_CI_FILE <event> <64 lowercase hex>`.
The parent forwards only complete exact protocol lines, reconstructing JSON:

```json
{"ciWorkloadProgress":{"event":"started","filePathSha256":"<path digest>"}}
```

No raw path, test name, stdout, stderr, exception, message or file bytes are
forwarded. The framing buffer retains at most 128 characters. Oversized,
malformed and unfinished lines are discarded; a suffix of an oversized line
cannot become a valid record. Test stdout/stderr remain hashed by the existing
reporter, so test messages resembling this protocol are not forwarded.
The existing child stdout/stderr buffer limit remains unchanged.

## Interpretation

Use the log's job, phase and source revision to select the relevant workload
invocation; workload-runner self-tests also emit diagnostics. Match a path
hash to the complete selected inventory by hashing each relative compiled
entry path. For one candidate path:

```sh
node --input-type=module -e 'import {createHash} from "node:crypto"; console.log(createHash("sha256").update(process.argv[1]).digest("hex"))' dist/tests/unit/example.test.js
```

`started` means a dequeue event was observed, not that the file passed.
`summary` means a per-file summary was observed, including failing summaries.
A last start without a summary narrows investigation; it does not prove a
root cause. Neither record authenticates a producer or constitutes a final
receipt. Missing final receipts, nonzero exits, skipped/cancelled/TODO tests,
zero-test files, changed inventories and failed phases still fail the gate.
The progress hook does not introduce retries, filtering, timeout overrides
or an alternate acceptance path. Diagnostic stderr now contributes to the
existing subprocess stderr digest; no historical receipt is rewritten.

## Verification

The existing `scripts/ci-offline.sh` workload-tests glob includes both new
`ci-workload-*.test.mjs` files without a workflow edit. Run in the unchanged
pinned Node/npm environment:

```sh
node --test --test-concurrency=1 scripts/ci-workload-*.test.mjs
npm run build
npm run typecheck
npm run format:check
```

The dependency-free progress tests cover finite events, entry-file precedence,
deduplication, all record split points, private/malformed/oversized/unfinished
input, control characters, and a real native child that cannot finish until
its live progress is received. The runner integration tests exercise that
same handshake through `executeFiles`, and preserve a real failing native
receipt while rejecting forged test stderr. Existing failure, cancellation,
canary, skip, TODO and complete-union controls remain in the original suites.

Auxiliary tests on another Node version are development diagnostics only,
not qualification of the pinned Linux runtime. A required independent review
and complete current-candidate checks remain necessary before merge. This
change alone does not resolve the original cancelled workload, qualify PR37,
enable a product, adopt shared contracts, or close #3 or the epic.
