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
The `native-downloads-*` directory retains the GUID-named files. Each invocation creates a new directory; no
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
