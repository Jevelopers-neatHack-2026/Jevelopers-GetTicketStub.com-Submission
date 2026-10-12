// Child process for the package suite. Run with `--max-old-space-size=256 --expose-gc`.
//   snapshot40  : a 40 MiB dense view is snapshotted; heap must stay tiny (enumerating its own keys would cost ~1.3 GiB and abort).
//   late-bytes  : a port that answers AFTER its deadline must not leave its bytes retained by the gate.
//   bounds-*    : the public pure API must reject a hostile file list BEFORE the first byte is copied. `bounds-control-one-copy` is the
//                 baseline: one accepted 40 MiB entry costs ~40 MiB of PEAK RSS (every source page is touched first, so a copy is visible).
//                 The rejections must cost almost nothing, where the old copy-first code cost one extra 40 MiB per repeated entry.
import { snapshotProductionBundleView } from "../dist/production-bundle.js";
import * as f from "./production-bundle-fixtures.mjs";
import { issuedAnchor, validateFiles } from "./production-bundle-cases-core.mjs";

const MiB = 1048576;
const mode = process.argv[2];
const memory = () => { globalThis.gc(); const usage = process.memoryUsage(); return { heapUsed: usage.heapUsed, arrayBuffers: usage.arrayBuffers }; };
const mib = (value) => Math.round((value / MiB) * 100) / 100;

if (mode === "snapshot40") {
  const view = new Uint8Array(40 * MiB);
  for (let index = 0; index < view.length; index += 4096) view[index] = index & 255;
  const before = memory();
  const started = performance.now();
  const result = snapshotProductionBundleView(view, 64 * MiB);
  const elapsedMs = Math.round(performance.now() - started);
  const after = memory();
  let intact = result.ok;
  if (result.ok) for (let index = 0; index < view.length; index += 4096) if (result.bytes[index] !== (index & 255)) intact = false;
  process.stdout.write(`${JSON.stringify({
    ok: result.ok, length: result.ok ? result.bytes.length : null, intact, elapsedMs,
    heapDeltaMiB: mib(after.heapUsed - before.heapUsed), arrayBuffersDeltaMiB: mib(after.arrayBuffers - before.arrayBuffers),
    sameBuffer: result.ok ? result.bytes.buffer === view.buffer : null
  })}\n`);
} else if (mode === "late-bytes") {
  const world = f.createWorld();
  f.publishFromBaseline(world);
  let ref = null;
  world.hooks.read = (request, dflt) => {
    if (request.filename !== "output.svg") return dflt();
    return new Promise((resolve) => setTimeout(() => {
      const late = new Uint8Array(4 * MiB);
      ref = new WeakRef(late);
      resolve({ status: "found", bytes: late });
    }, 150));
  };
  const gate = f.createGate(world, { limits: { readMs: 40, totalMs: 5000 } });
  const report = await gate.checkBeforeSubmit(f.gateRequest());
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (let round = 0; round < 6; round += 1) { globalThis.gc(); await new Promise((resolve) => setImmediate(resolve)); }
  process.stdout.write(`${JSON.stringify({ code: report.criteria.find((item) => item.id === "byte_custody").code, lateAnswered: ref !== null, retained: ref !== null && ref.deref() !== undefined })}\n`);
} else if (mode.startsWith("bounds-")) {
  // Touch every page of the caller's view so that any private copy of it is visible in the process's peak RSS.
  const touched = (bytes) => { const view = new Uint8Array(bytes); for (let index = 0; index < view.length; index += 4096) view[index] = ((index >> 12) & 255) | 1; return view; };
  const peakMiB = () => process.resourceUsage().maxRSS / 1024; // libuv reports KiB
  const anchor = await issuedAnchor();
  const shared40 = mode === "bounds-payload-group" ? null : touched(40 * MiB);
  const shared8 = mode === "bounds-payload-group" ? touched(8 * MiB) : null;
  const lists = {
    "bounds-control-one-copy": () => [{ filename: "archive.zip", bytes: shared40 }],
    "bounds-repeat6-same-name": () => Array.from({ length: 6 }, () => ({ filename: "archive.zip", bytes: shared40 })),
    "bounds-repeat6-case-variants": () => ["archive.zip", "Archive.zip", "ARCHIVE.ZIP", "archive.ZIP", "aRCHIVE.zip", "ArChIvE.zIp"].map((filename) => ({ filename, bytes: shared40 })),
    "bounds-repeat6-distinct-unknown-names": () => Array.from({ length: 6 }, (_, index) => ({ filename: `p${index}.bin`, bytes: shared40 })),
    "bounds-payload-group": () => Array.from({ length: 5 }, (_, index) => ({ filename: `p${index}.bin`, bytes: shared8 }))
  };
  const build = lists[mode];
  if (build === undefined) { process.stdout.write(`${JSON.stringify({ error: "unknown_mode" })}\n`); process.exit(2); }
  const files = build();
  globalThis.gc();
  const before = peakMiB();
  const started = performance.now();
  const report = validateFiles(files, anchor);
  const elapsedMs = Math.round(performance.now() - started);
  const after = peakMiB();
  const custody = report.criteria.find((item) => item.id === "byte_custody");
  process.stdout.write(`${JSON.stringify({
    mode, entries: files.length, verdict: report.verdict, byteCustody: { state: custody.state, code: custody.code }, reasons: report.diagnostic?.reasons ?? [],
    peakRssDeltaMiB: Math.round((after - before) * 100) / 100, elapsedMs
  })}\n`);
} else {
  process.stdout.write(`${JSON.stringify({ error: "unknown_mode" })}\n`);
  process.exitCode = 2;
}
