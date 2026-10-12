// SIMULATED ONLY. Cases: snapshot, budgets, deadline. Real owner package, real corpus bytes, fixture host ports.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { types } from "node:util";
import * as bundle from "../dist/production-bundle.js";
import * as ownerWrapper from "../dist/production-bundle-owner.js";
import * as f from "./production-bundle-fixtures.mjs";
import { baselineWorld, criterion, filesOf, issuedAnchor, runGate, validateFiles } from "./production-bundle-cases-core.mjs";

const MiB = 1048576;
const data = () => Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const truth = f.sha256Hex(data());
const hashOf = (bytes) => f.sha256Hex(bytes);
const define = (target, key, value) => Object.defineProperty(target, key, { value, configurable: true, writable: true });
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const snap = (view, cap = 64, options) => bundle.snapshotProductionBundleView(view, cap, options);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Every own-property shadow the reviewer's probe used, plus the further hooks the plan names. Each builds a fresh hostile view. */
const SHADOWS = {
  ownByteLengthSmaller: { build: () => { const view = data(); define(view, "byteLength", 4); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownByteLengthHidesOverCap: { build: () => { const view = new Uint8Array(1000); define(view, "byteLength", 8); return view; }, deny: "own_shadow", inert: { rejected: "over_cap" } },
  ownLength: { build: () => { const view = data(); define(view, "length", 4); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownBufferMasksSharedArrayBuffer: { build: () => { const view = new Uint8Array(new SharedArrayBuffer(16)); view.set(data()); define(view, "buffer", new ArrayBuffer(16)); return view; }, deny: "own_shadow", inert: { rejected: "shared_array_buffer" } },
  sabOwnToStringTag: { build: () => { const shared = new SharedArrayBuffer(16); define(shared, Symbol.toStringTag, "ArrayBuffer"); const view = new Uint8Array(shared); view.set(data()); return view; }, deny: "shared_array_buffer", inert: { rejected: "shared_array_buffer" } },
  sabPlain: { build: () => { const view = new Uint8Array(new SharedArrayBuffer(16)); view.set(data()); return view; }, deny: "shared_array_buffer", inert: { rejected: "shared_array_buffer" } },
  resizableOwnFalse: { build: () => { const buffer = new ArrayBuffer(16, { maxByteLength: 64 }); define(buffer, "resizable", false); const view = new Uint8Array(buffer, 0, 16); view.set(data()); return view; }, deny: "resizable_or_detached", inert: { rejected: "resizable_or_detached" } },
  resizableLengthTrackingOwnFalse: { build: () => { const buffer = new ArrayBuffer(16, { maxByteLength: 64 }); define(buffer, "resizable", false); const view = new Uint8Array(buffer); view.set(data()); return view; }, deny: "resizable_or_detached", inert: { rejected: "resizable_or_detached" } },
  ownByteOffset: { build: () => { const big = new Uint8Array(48); big.set(data(), 16); const view = big.subarray(16, 32); define(view, "byteOffset", 0); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownSymbolIterator: { build: () => { const view = data(); define(view, Symbol.iterator, function* () { yield 99; }); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownSymbolToStringTag: { build: () => { const view = data(); define(view, Symbol.toStringTag, "Uint8Array"); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownConstructorWithSpecies: { build: (hits) => { const view = data(); define(view, "constructor", { [Symbol.species]: function Species() { hits.count += 1; throw new Error("species hook"); } }); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownSetSliceSubarray: { build: (hits) => { const view = data(); for (const name of ["set", "slice", "subarray"]) define(view, name, () => { hits.count += 1; throw new Error(`${name} hook`); }); return view; }, deny: "own_shadow", inert: { accepted: true } },
  ownThrowingBufferGetter: { build: (hits) => { const view = data(); Object.defineProperty(view, "buffer", { get() { hits.count += 1; throw new Error("getter"); }, configurable: true }); return view; }, deny: "own_shadow", inert: { accepted: true } }
};

function shadowCase(name) {
  const entry = SHADOWS[name];
  const hits = { count: 0 };
  const denied = snap(entry.build(hits));
  assert.deepEqual(denied, { ok: false, reason: entry.deny }, `${name} typed rejection`);
  assert.equal(hits.count, 0, `${name}: the deny-list reads descriptors only, never values or hooks`);
  const inert = snap(entry.build(hits), 64, { skipShadowDenyList: true });
  if (entry.inert.accepted === true) {
    assert.equal(inert.ok, true, `${name} inert`);
    assert.equal(hashOf(inert.bytes), truth, `${name}: with the deny-list disabled the shadow is inert and the copy equals the true bytes`);
  } else assert.deepEqual(inert, { ok: false, reason: entry.inert.rejected }, `${name} native rejection`);
  assert.equal(hits.count, 0, `${name}: no shadow hook is ever invoked`);
}

export function register(define_) {
  // ---- snapshot ---------------------------------------------------------------------------------------------
  define_("snapshot.exact-uint8array-only", () => {
    assert.equal(snap(data()).ok, true);
    const accepted = snap(data());
    assert.equal(hashOf(accepted.bytes), truth);
    class Sub extends Uint8Array {}
    const wrong = { Sub: new Sub(4), Buffer: Buffer.from([1, 2, 3]), Clamped: new Uint8ClampedArray(4), Int8: new Int8Array(4), Float32: new Float32Array(1), DataView: new DataView(new ArrayBuffer(4)), ArrayBuffer: new ArrayBuffer(4), array: [1, 2, 3], string: "abc", number: 7, nullValue: null, undef: undefined };
    for (const [label, value] of Object.entries(wrong)) assert.equal(snap(value).ok, false, label);
    assert.equal(snap(new Sub(4)).reason, "not_exact_prototype");
    assert.equal(snap(Buffer.from([1])).reason, "not_exact_prototype");
  });

  define_("snapshot.subarray-window-copied", () => {
    const big = new Uint8Array(48); big.set(data(), 16);
    const window = big.subarray(16, 32);
    const copy = snap(window);
    assert.equal(copy.ok, true);
    assert.equal(hashOf(copy.bytes), truth);
    assert.equal(copy.bytes.buffer.byteLength, 16, "a fresh private buffer of exactly the window, not the whole backing store");
    assert.equal(copy.bytes.byteOffset, 0);
    assert.notEqual(copy.bytes.buffer, window.buffer);
  });

  define_("snapshot.mutation-after-copy-neutral", async () => {
    const source = data();
    const copy = snap(source);
    source.fill(0xee);
    assert.equal(hashOf(copy.bytes), truth);
    const anchor = await issuedAnchor();
    const files = filesOf(f.baseline().files);
    const report = validateFiles(files, anchor);
    for (const file of files) file.bytes.fill(0);
    assert.equal(report.verdict, "integrity_passed_blocked");
    assert.equal(report.inputDigests["output.png"], f.sha256Tagged(f.baseline().files.get("output.png")), "digests describe the private copies, not the mutated caller arrays");
    assert.equal(report.unchanged, true);
  });

  define_("snapshot.single-read-of-caller-fields", () => {
    // Accessors on every deny-listed name: the descriptor is inspected, the getter is never invoked, in either mode.
    for (const options of [undefined, { skipShadowDenyList: true }]) {
      let reads = 0;
      const view = data();
      for (const key of bundle.PRODUCTION_BUNDLE_SHADOW_DENY_LIST) {
        try { Object.defineProperty(view, key, { get() { reads += 1; return undefined; }, configurable: true }); } catch { /* non-configurable names are skipped */ }
      }
      const result = snap(view, 64, options);
      assert.equal(reads, 0, "no shadow getter is ever read");
      if (options === undefined) assert.deepEqual(result, { ok: false, reason: "own_shadow" });
    }
    // File entries are read as data properties exactly once: an accessor is rejected without being invoked.
    let invoked = 0;
    const entry = { filename: "a.bin", get bytes() { invoked += 1; return data(); } };
    assert.equal(bundle.snapshotProductionBundleFiles([entry], () => 64, 8).ok, false);
    assert.equal(invoked, 0);
  });

  define_("snapshot.owner-and-png-see-private-copy-only", async () => {
    const anchor = await issuedAnchor();
    const originals = filesOf(f.baseline().files);
    const copies = bundle.snapshotProductionBundleFiles(originals, () => 8 * MiB, 20);
    assert.equal(copies.ok, true);
    assert.equal(Object.isFrozen(copies.files), true);
    copies.files.forEach((file, index) => {
      assert.equal(Object.isFrozen(file), true);
      assert.notEqual(file.bytes.buffer, originals[index].bytes.buffer, "a private buffer, never the caller's");
      assert.equal(hashOf(file.bytes), hashOf(originals[index].bytes));
    });
    // The pipeline built on those copies: zeroing the caller's arrays afterwards changes nothing that was reported.
    const report = validateFiles(originals, anchor);
    for (const file of originals) file.bytes.fill(0);
    assert.equal(report.verdict, "integrity_passed_blocked");
    assert.equal(criterion(report, "png_pixels").state, "verified_local");
  });

  define_("snapshot.digests-before-after-unchanged", async () => {
    const anchor = await issuedAnchor();
    for (const id of f.VARIANT_IDS) {
      const report = validateFiles(filesOf(f.deriveVariant(id)), anchor);
      assert.equal(report.unchanged, true, id);
      assert.deepEqual(report.inputDigests, report.outputDigests, id);
    }
    const gated = await runGate(baselineWorld());
    assert.deepEqual(gated.inputDigests, gated.outputDigests);
    assert.equal(Object.keys(gated.inputDigests).length, 9);
  });

  define_("snapshot.native-intrinsics-captured-at-module-load", () => {
    const sab = new Uint8Array(new SharedArrayBuffer(16)), proxied = new Proxy(data(), {}), resizable = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 }));
    const good = data();
    const saved = {
      buffer: Object.getOwnPropertyDescriptor(TypedArrayPrototype, "buffer"), byteLength: Object.getOwnPropertyDescriptor(TypedArrayPrototype, "byteLength"),
      resizable: Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "resizable"), set: TypedArrayPrototype.set, u8set: Uint8Array.prototype.set,
      isProxy: types.isProxy, isShared: types.isSharedArrayBuffer
    };
    let tampered;
    try {
      const fake = new ArrayBuffer(16);
      Object.defineProperty(TypedArrayPrototype, "buffer", { get() { return fake; }, configurable: true });
      Object.defineProperty(TypedArrayPrototype, "byteLength", { get() { return 3; }, configurable: true });
      Object.defineProperty(ArrayBuffer.prototype, "resizable", { get() { return false; }, configurable: true });
      TypedArrayPrototype.set = () => { throw new Error("tampered"); };
      Uint8Array.prototype.set = () => { throw new Error("tampered"); };
      types.isProxy = () => false; types.isSharedArrayBuffer = () => false;
      tampered = { good: snap(good), sab: snap(sab), proxy: snap(proxied), resizable: snap(resizable) };
    } finally {
      Object.defineProperty(TypedArrayPrototype, "buffer", saved.buffer); Object.defineProperty(TypedArrayPrototype, "byteLength", saved.byteLength);
      Object.defineProperty(ArrayBuffer.prototype, "resizable", saved.resizable); TypedArrayPrototype.set = saved.set; Uint8Array.prototype.set = saved.u8set;
      types.isProxy = saved.isProxy; types.isSharedArrayBuffer = saved.isShared;
    }
    assert.equal(tampered.good.ok, true); assert.equal(hashOf(tampered.good.bytes), truth);
    assert.deepEqual(tampered.sab, { ok: false, reason: "shared_array_buffer" });
    assert.deepEqual(tampered.proxy, { ok: false, reason: "proxy" });
    assert.deepEqual(tampered.resizable, { ok: false, reason: "resizable_or_detached" });
  });

  for (const [id, name] of [
    ["snapshot.own-bytelength-shadow-typed-rejection", "ownByteLengthSmaller"], ["snapshot.own-bytelength-hides-overcap-typed-rejection", "ownByteLengthHidesOverCap"],
    ["snapshot.own-length-shadow-typed-rejection", "ownLength"], ["snapshot.own-buffer-masks-sab-rejected", "ownBufferMasksSharedArrayBuffer"],
    ["snapshot.sab-own-tostringtag-rejected", "sabOwnToStringTag"], ["snapshot.sab-plain-rejected", "sabPlain"],
    ["snapshot.resizable-own-false-rejected", "resizableOwnFalse"], ["snapshot.resizable-length-tracking-own-false-rejected", "resizableLengthTrackingOwnFalse"],
    ["snapshot.own-byteoffset-shadow-typed-rejection", "ownByteOffset"], ["snapshot.own-symbol-iterator-shadow-typed-rejection", "ownSymbolIterator"],
    ["snapshot.own-symbol-tostringtag-shadow-typed-rejection", "ownSymbolToStringTag"], ["snapshot.own-constructor-species-shadow-typed-rejection", "ownConstructorWithSpecies"],
    ["snapshot.own-set-slice-subarray-shadows-typed-rejection", "ownSetSliceSubarray"], ["snapshot.own-throwing-buffer-getter-typed-rejection", "ownThrowingBufferGetter"]
  ]) define_(id, () => shadowCase(name));

  define_("snapshot.detached-buffer-rejected", () => {
    const buffer = new ArrayBuffer(16); const view = new Uint8Array(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    assert.deepEqual(snap(view), { ok: false, reason: "resizable_or_detached" });
  });

  define_("snapshot.buffer-dataview-clamped-crossrealm-rejected", () => {
    assert.deepEqual(snap(Buffer.from(data())), { ok: false, reason: "not_exact_prototype" });
    assert.deepEqual(snap(new DataView(new ArrayBuffer(16))), { ok: false, reason: "not_uint8array" });
    assert.deepEqual(snap(new Uint8ClampedArray(16)), { ok: false, reason: "not_uint8array" });
    assert.deepEqual(snap(vm.runInNewContext("new Uint8Array(16)")), { ok: false, reason: "not_exact_prototype" });
  });

  define_("snapshot.proxy-view-file-array-entry-revoked-rejected", () => {
    const revocable = Proxy.revocable(data(), {}); revocable.revoke();
    assert.deepEqual(snap(new Proxy(data(), {})), { ok: false, reason: "proxy" });
    assert.deepEqual(snap(revocable.proxy), { ok: false, reason: "proxy" });
    const entry = () => ({ filename: "a.bin", bytes: data() });
    assert.deepEqual(bundle.snapshotProductionBundleFiles(new Proxy([entry()], {}), () => 64, 8), { ok: false, reason: "files_not_plain_array" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([new Proxy(entry(), {})], () => 64, 8), { ok: false, reason: "not_plain_object" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ filename: "a.bin", bytes: new Proxy(data(), {}) }], () => 64, 8), { ok: false, reason: "proxy" });
    const revokedEntry = Proxy.revocable(entry(), {}); revokedEntry.revoke();
    assert.equal(bundle.snapshotProductionBundleFiles([revokedEntry.proxy], () => 64, 8).ok, false);
  });

  define_("snapshot.shadows-inert-without-denylist-copy-hash-equals-truth", () => {
    let accepted = 0, nativelyRejected = 0;
    for (const [name, entry] of Object.entries(SHADOWS)) {
      const hits = { count: 0 };
      const result = snap(entry.build(hits), 64, { skipShadowDenyList: true });
      if (result.ok) { assert.equal(hashOf(result.bytes), truth, `${name} must never yield wrong bytes`); accepted += 1; }
      else { assert.match(result.reason, /^(shared_array_buffer|resizable_or_detached|over_cap)$/, name); nativelyRejected += 1; }
      assert.equal(hits.count, 0, name);
    }
    const inertCount = Object.values(SHADOWS).filter((entry) => entry.inert.accepted === true).length;
    assert.equal(accepted, inertCount); assert.equal(nativelyRejected, Object.keys(SHADOWS).length - inertCount);
    assert.ok(accepted >= 8 && nativelyRejected >= 6, `${accepted}/${nativelyRejected}`);
    assert.ok(bundle.PRODUCTION_BUNDLE_SHADOW_DENY_LIST.length >= 30);
    for (const key of ["buffer", "byteLength", "byteOffset", "length", "constructor", "set", "slice", "subarray", Symbol.iterator, Symbol.toStringTag]) {
      assert.ok(bundle.PRODUCTION_BUNDLE_SHADOW_DENY_LIST.includes(key), String(key));
    }
  });

  define_("snapshot.post-capture-intrinsic-tampering-neutral", () => {
    // A second angle on capture: the entry/array/ByteSource wrappers also keep working after the intrinsics are tampered with.
    const savedDescriptor = Object.getOwnPropertyDescriptor(Array, "isArray"); const savedGetOwn = Object.getOwnPropertyDescriptor;
    let files, result;
    try {
      Array.isArray = () => true; Object.getOwnPropertyDescriptor = () => ({ value: 99 });
      files = bundle.snapshotProductionBundleFiles([{ filename: "a.bin", bytes: data() }], () => 64, 8);
      result = bundle.snapshotByteSourceResult({ status: "found", bytes: data() }, 64);
    } finally {
      Object.defineProperty(Array, "isArray", savedDescriptor); Object.getOwnPropertyDescriptor = savedGetOwn;
    }
    assert.equal(files.ok, true); assert.equal(hashOf(files.files[0].bytes), truth);
    assert.equal(result.ok, true); assert.equal(hashOf(result.bytes), truth);
  });

  define_("snapshot.entry-accessor-rejected-extra-getter-never-read", () => {
    const base = () => ({ filename: "a.bin", bytes: data() });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ filename: "a.bin", get bytes() { return data(); } }], () => 64, 8), { ok: false, reason: "accessor_or_missing" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ get filename() { return "a.bin"; }, bytes: data() }], () => 64, 8), { ok: false, reason: "accessor_or_missing" });
    let reads = 0;
    const extra = base(); Object.defineProperty(extra, "extra", { get() { reads += 1; throw new Error("never read"); }, enumerable: true });
    const result = bundle.snapshotProductionBundleFiles([extra], () => 64, 8);
    assert.equal(result.ok, true); assert.equal(reads, 0, "keys other than filename/bytes are never read");
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ filename: 7, bytes: data() }], () => 64, 8), { ok: false, reason: "filename" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ filename: "", bytes: data() }], () => 64, 8), { ok: false, reason: "filename" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([{ filename: "x".repeat(129), bytes: data() }], () => 64, 8), { ok: false, reason: "filename" });
  });

  define_("snapshot.files-array-hostile-length-holes-iterator-hook", () => {
    const entry = () => ({ filename: "a.bin", bytes: data() });
    assert.deepEqual(bundle.snapshotProductionBundleFiles(new Array(2 ** 32 - 1), () => 64, 100), { ok: false, reason: "count" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles(Array.from({ length: 101 }, entry), () => 64, 100), { ok: false, reason: "count" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles([entry(), , entry()], () => 64, 100), { ok: false, reason: "hole_or_accessor" });
    const hooked = [entry()]; let invoked = 0;
    Object.defineProperty(hooked, Symbol.iterator, { value: () => { invoked += 1; throw new Error("iterator hook"); } });
    define(hooked, "map", () => { invoked += 1; throw new Error("map hook"); });
    const result = bundle.snapshotProductionBundleFiles(hooked, () => 64, 100);
    assert.equal(result.ok, true); assert.equal(invoked, 0, "no iterator, spread, map or species is consulted");
    const accessorElement = []; Object.defineProperty(accessorElement, "0", { get() { return entry(); }, enumerable: true }); accessorElement.length = 1;
    assert.deepEqual(bundle.snapshotProductionBundleFiles(accessorElement, () => 64, 100), { ok: false, reason: "hole_or_accessor" });
    assert.deepEqual(bundle.snapshotProductionBundleFiles({ 0: entry(), length: 1 }, () => 64, 100), { ok: false, reason: "files_not_plain_array" });
  });

  define_("snapshot.byte-source-result-shapes-typed", () => {
    const cap = 64;
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "missing" }, cap), { ok: true, missing: true });
    const found = bundle.snapshotByteSourceResult({ status: "found", bytes: data() }, cap);
    assert.equal(found.ok, true); assert.equal(found.missing, false); assert.equal(hashOf(found.bytes), truth);
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "found", bytes: new Uint8Array(new SharedArrayBuffer(8)) }, cap), { ok: false, reason: "shared_array_buffer" });
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "found", get bytes() { return data(); } }, cap), { ok: false, reason: "result_shape" });
    assert.deepEqual(bundle.snapshotByteSourceResult(new Proxy({ status: "found", bytes: data() }, {}), cap), { ok: false, reason: "result_shape" });
    assert.deepEqual(bundle.snapshotByteSourceResult(null, cap), { ok: false, reason: "result_shape" });
    assert.deepEqual(bundle.snapshotByteSourceResult("found", cap), { ok: false, reason: "result_shape" });
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "ok" }, cap), { ok: false, reason: "result_status" });
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "found", bytes: new Uint8Array(65) }, cap), { ok: false, reason: "over_cap" });
    assert.deepEqual(bundle.snapshotByteSourceResult({ status: "found" }, cap), { ok: false, reason: "result_shape" });
  });

  define_("snapshot.all-throw-paths-typed-no-uncaught", async () => {
    const hostile = [
      Object.create(null), Object.create(new Uint8Array(4)), { [Symbol.toPrimitive]() { throw new Error("x"); } },
      new Proxy({}, { get() { throw new Error("x"); }, getPrototypeOf() { throw new Error("x"); }, ownKeys() { throw new Error("x"); }, getOwnPropertyDescriptor() { throw new Error("x"); } }),
      (() => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; })(), Object.freeze(new Uint8Array(0)), new Uint8Array(0), new Uint8Array(new ArrayBuffer(8), 8, 0),
      Symbol("s"), 10n, () => 1, class A {}, new Date(NaN), new WeakMap()
    ];
    for (const value of hostile) {
      assert.doesNotThrow(() => snap(value));
      assert.doesNotThrow(() => bundle.snapshotByteSourceResult(value, 64));
      assert.doesNotThrow(() => bundle.snapshotProductionBundleFiles(value, () => 64, 8));
      assert.doesNotThrow(() => bundle.snapshotProductionBundleFiles([value], () => 64, 8));
      assert.doesNotThrow(() => bundle.snapshotProductionBundleFiles([{ filename: "a", bytes: value }], () => 64, 8));
    }
    const anchor = await issuedAnchor();
    for (const files of [null, undefined, 7, "x", { length: 1 }, new Proxy([], {}), [null], [{ filename: "a" }]]) {
      const report = validateFiles(files, anchor);
      assert.equal(report.verdict, "integrity_failed");
      assert.equal(criterion(report, "byte_custody").code, "SNAPSHOT_REJECTED");
    }
  });

  define_("snapshot.large-view-no-key-enumeration-allocation-bound", () => {
    const child = spawnSync(process.execPath, ["--max-old-space-size=256", "--expose-gc", new URL("./production-bundle-allocation-child.mjs", import.meta.url).pathname, "snapshot40"], {
      encoding: "utf8", timeout: 120_000, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? "/tmp" }
    });
    assert.equal(child.status, 0, `child exited ${child.status}: ${child.stderr.slice(0, 300)}`);
    assert.equal(child.stderr, "");
    const result = JSON.parse(child.stdout);
    assert.equal(result.ok, true); assert.equal(result.length, 40 * MiB); assert.equal(result.intact, true); assert.equal(result.sameBuffer, false);
    assert.ok(result.heapDeltaMiB < 8, `heap delta ${result.heapDeltaMiB} MiB must stay far below the ~1280 MiB that enumerating 40 MiB of own keys costs`);
    assert.ok(result.arrayBuffersDeltaMiB >= 39 && result.arrayBuffersDeltaMiB <= 41, `exactly one private copy: ${result.arrayBuffersDeltaMiB} MiB`);
  });

  // ---- budgets ----------------------------------------------------------------------------------------------
  const limits = () => ownerWrapper.ownerLimits();
  const fileSet = (entries) => ({ file_set: entries.map(([filename, role, byte_size], index) => ({ filename, role, byte_size, byte_hash: `sha256:${String(index).padStart(64, "0")}` })) });
  const many = (count, size = 1, role = "print_output") => Array.from({ length: count }, (_, index) => [`f${String(index).padStart(3, "0")}.bin`, role, size]);

  define_("budgets.descriptor-count-over-limit", () => {
    const max = limits().outerDescriptors;
    assert.equal(max, f.ownerLimitsDirect.outer_descriptors);
    assert.equal(bundle.deriveBudgets(fileSet(many(max)), limits()).ok, true);
    assert.deepEqual(bundle.deriveBudgets(fileSet(many(max + 1)), limits()), { ok: false, code: "BUDGET_DESCRIPTOR_COUNT" });
    assert.deepEqual(bundle.deriveBudgets(fileSet([]), limits()), { ok: false, code: "BUDGET_DESCRIPTOR_COUNT" });
    assert.deepEqual(bundle.deriveBudgets({ file_set: "x" }, limits()), { ok: false, code: "BUDGET_DESCRIPTOR_COUNT" });
  });

  define_("budgets.per-role-cap-over", () => {
    const l = limits();
    const cap = (role, size) => bundle.deriveBudgets(fileSet([[`a.${role}`, role, size]]), l);
    for (const [role, ceiling] of [["print_output", l.entryBytes], ["lineage", l.entryBytes], ["manifest", l.manifestBytes], ["detached", l.detachedBytes], ["archive", l.archiveBytes]]) {
      assert.equal(cap(role, ceiling).ok, true, `${role} at its ceiling`);
      assert.deepEqual(cap(role, ceiling + 1), { ok: false, code: "BUDGET_ROLE_CAP" }, `${role} one over`);
      assert.deepEqual(cap(role, -1), { ok: false, code: "BUDGET_ROLE_CAP" });
      assert.deepEqual(cap(role, 1.5), { ok: false, code: "BUDGET_ROLE_CAP" });
    }
    assert.ok(l.archiveBytes > l.entryBytes && l.manifestBytes < l.entryBytes, "role ceilings differ and all come from the owner export");
    assert.deepEqual(bundle.deriveBudgets(fileSet([["../x", "print_output", 1]]), l), { ok: false, code: "BUDGET_FILENAME" });
    assert.deepEqual(bundle.deriveBudgets(fileSet([["a.bin", "print_output", 1], ["A.BIN", "print_output", 1]]), l), { ok: false, code: "BUDGET_FILENAME" });
  });

  define_("budgets.aggregate-over-cap", () => {
    const l = limits();
    const aggregate = l.archiveBytes + l.manifestBytes + l.detachedBytes + l.payloadBytes;
    assert.equal(aggregate, 80_740_352); assert.equal(aggregate / MiB, 77);
    const atCap = [["a.zip", "archive", l.archiveBytes], ["m.json", "manifest", l.manifestBytes], ["d.json", "detached", l.detachedBytes], ...Array.from({ length: 4 }, (_, index) => [`p${index}.bin`, "print_output", l.payloadBytes / 4])];
    assert.equal(bundle.deriveBudgets(fileSet(atCap), l).ok, true);
    const over = [...atCap, ["extra.bin", "print_output", 1]];
    assert.deepEqual(bundle.deriveBudgets(fileSet(over), l), { ok: false, code: "BUDGET_AGGREGATE_CAP" });
    const tooManyPayloads = [["a.zip", "archive", l.archiveBytes], ...Array.from({ length: 10 }, (_, index) => [`p${index}.bin`, "print_output", l.entryBytes])];
    assert.deepEqual(bundle.deriveBudgets(fileSet(tooManyPayloads), l), { ok: false, code: "BUDGET_AGGREGATE_CAP" });
  });

  define_("budgets.checked-before-any-copy-or-payload-read", async () => {
    const forged = structuredClone(f.baselineCommitment);
    forged.file_set[0].byte_size = f.ownerLimitsDirect.entry_bytes + 1;
    const bytes = new TextEncoder().encode(JSON.stringify(forged));
    const world = f.createWorld();
    world.bundles.set(f.BUNDLE_HASH, { files: f.baseline().files, commitmentBytes: bytes, pin: { length: bytes.length, sha256: f.sha256Tagged(bytes) } });
    const report = await runGate(world);
    assert.equal(report.verdict, "integrity_failed");
    assert.match(criterion(report, "anchor_resolution").code, /^(BUDGET_ROLE_CAP|OWNER_[A-Z_]+)$/);
    assert.equal(world.calls.read.length, 1, "only the commitment was read; no payload was requested or copied");
    // The per-view cap is also enforced before the copy is allocated.
    const before = process.memoryUsage().arrayBuffers;
    // Assert on a small summary: if the code were wrong the result would hold 8 MiB of bytes, and rendering a diff of that must not exhaust the runner.
    const oversized = snap(new Uint8Array(8 * MiB), 1024);
    assert.deepEqual({ ok: oversized.ok, reason: oversized.reason }, { ok: false, reason: "over_cap" });
    assert.ok(process.memoryUsage().arrayBuffers - before < 9 * MiB);
    const copy = snap(new Uint8Array(1024), 1024);
    assert.equal(copy.ok, true);
  });

  define_("budgets.limits-read-from-owner-export", () => {
    const l = limits();
    assert.deepEqual(l, { outerDescriptors: f.ownerLimitsDirect.outer_descriptors, entryBytes: f.ownerLimitsDirect.entry_bytes, archiveBytes: f.ownerLimitsDirect.archive_bytes, manifestBytes: f.ownerLimitsDirect.manifest_bytes, detachedBytes: f.ownerLimitsDirect.detached_bytes, payloadBytes: f.ownerLimitsDirect.payload_bytes });
    assert.equal(Object.isFrozen(l), true);
    // Behavioural proof the derivation consumes the supplied limits object rather than a private copy.
    const tight = { ...l, entryBytes: 10 };
    assert.equal(bundle.deriveBudgets(fileSet([["a.bin", "print_output", 11]]), l).ok, true);
    assert.deepEqual(bundle.deriveBudgets(fileSet([["a.bin", "print_output", 11]]), tight), { ok: false, code: "BUDGET_ROLE_CAP" });
    const source = readFileSync(new URL("../src/production-bundle.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const literal of ["8388608", "41943040", "33554432", "4194304", "1048576", "80740352"]) assert.ok(!source.includes(literal), `no owner limit literal ${literal} is copied into the consumer`);
  });

  define_("budgets.concurrency-semaphore-and-queue-overflow", async () => {
    const semaphore = new bundle.BoundedSemaphore(2, 32);
    const controller = new AbortController();
    const first = await semaphore.acquire(1000, controller.signal), second = await semaphore.acquire(1000, controller.signal);
    assert.equal(first.status, "acquired"); assert.equal(second.status, "acquired");
    const waiting = Array.from({ length: 32 }, () => semaphore.acquire(5000, controller.signal));
    await tick();
    assert.deepEqual(semaphore.state(), { free: 0, queued: 32 });
    assert.deepEqual(await semaphore.acquire(1000, controller.signal), { status: "queue_full" });
    first.release(); first.release();
    const granted = await waiting[0];
    assert.equal(granted.status, "acquired");
    assert.deepEqual(semaphore.state(), { free: 0, queued: 31 });
    second.release(); granted.release();
    for (let index = 1; index < 32; index += 1) { const next = await waiting[index]; assert.equal(next.status, "acquired"); next.release(); }
    assert.deepEqual(semaphore.state(), { free: 2, queued: 0 });
    // Gate level: width 1, queue 1; the third concurrent validation fails closed immediately and the gate recovers.
    const world = baselineWorld();
    let open; const blocker = new Promise((resolve) => { open = resolve; }); let resolves = 0;
    world.hooks.resolve = async (request, dflt) => { resolves += 1; if (resolves === 1) await blocker; return dflt(); };
    const gate = f.createGate(world, { limits: { maxConcurrent: 1, maxQueued: 1, totalMs: 5000 } });
    const p1 = gate.checkBeforeSubmit(f.gateRequest()); await tick();
    const p2 = gate.checkBeforeSubmit(f.gateRequest()); await tick();
    const p3 = await gate.checkBeforeSubmit(f.gateRequest());
    assert.equal(criterion(p3, "anchor_resolution").code, "RESOURCE_LIMIT");
    open();
    assert.equal((await p1).verdict, "integrity_passed_blocked"); assert.equal((await p2).verdict, "integrity_passed_blocked");
    assert.equal((await gate.checkBeforeSubmit(f.gateRequest())).verdict, "integrity_passed_blocked");
  });

  // ---- deadline ---------------------------------------------------------------------------------------------
  const clockSpy = () => { const spy = { reads: 0, now() { spy.reads += 1; return 1_760_000_000_000; } }; return spy; };

  define_("deadline.never-resolving-resolve-hits-finite-deadline-with-frozen-clock", async () => {
    const world = baselineWorld(); let signal;
    world.hooks.resolve = (request) => { signal = request.signal; return new Promise(() => {}); };
    const clock = clockSpy(); const started = performance.now();
    const report = await runGate(world, {}, { clock, limits: { resolveMs: 40, totalMs: 5000 } });
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 30 && elapsed < 2000, `elapsed ${elapsed}`);
    assert.equal(criterion(report, "anchor_resolution").code, "DEADLINE");
    assert.equal(report.verdict, "integrity_failed");
    assert.equal(signal.aborted, true);
    assert.ok(clock.reads <= 2, "the injected Clock was frozen and only used to stamp the report");
    assert.equal(report.evaluatedAt, new Date(1_760_000_000_000).toISOString());
    assert.equal(world.calls.read.length, 0);
  });

  define_("deadline.never-resolving-read-hits-finite-deadline-with-frozen-clock", async () => {
    for (const target of ["commitment", "output.png"]) {
      const world = baselineWorld(); let signal;
      world.hooks.read = (request, dflt) => ((request.role === "commitment" ? "commitment" : request.filename) === target ? (signal = request.signal, new Promise(() => {})) : dflt());
      const started = performance.now();
      const report = await runGate(world, {}, { clock: clockSpy(), limits: { readMs: 40, totalMs: 5000 } });
      assert.ok(performance.now() - started < 2000, target);
      assert.equal(criterion(report, target === "commitment" ? "anchor_resolution" : "byte_custody").code, "DEADLINE", target);
      assert.equal(signal.aborted, true, target);
      assert.equal(criterion(report, "owner_integrity").state, "not_observed");
    }
  });

  define_("deadline.abort-signal-delivered-to-ports", async () => {
    const signals = []; const world = baselineWorld();
    world.hooks.resolve = (request, dflt) => { signals.push(request.signal); return dflt(); };
    world.hooks.read = (request, dflt) => { signals.push(request.signal); return dflt(); };
    const ok = await runGate(world);
    assert.equal(ok.verdict, "integrity_passed_blocked");
    assert.equal(signals.length, 10);
    for (const signal of signals) assert.ok(signal instanceof AbortSignal);
    const stalled = baselineWorld(); let stalledSignal;
    stalled.hooks.read = (request, dflt) => (request.filename === "lineage.json" ? (stalledSignal = request.signal, new Promise(() => {})) : dflt());
    assert.equal(stalledSignal, undefined);
    await runGate(stalled, {}, { limits: { readMs: 30 } });
    assert.equal(stalledSignal.aborted, true, "the port is told to stop once its deadline passes");
  });

  define_("deadline.late-completion-ignored-and-bytes-not-retained", async () => {
    const world = baselineWorld();
    world.hooks.read = (request, dflt) => (request.filename === "output.svg"
      ? new Promise((resolve) => setTimeout(() => resolve({ status: "found", bytes: f.clone(f.baseline().files.get("output.svg")) }), 120))
      : dflt());
    const gate = f.createGate(world, { limits: { readMs: 30, totalMs: 5000 } });
    const report = await gate.checkBeforeSubmit(f.gateRequest());
    const digestAtReturn = report.reportDigest; const snapshot = JSON.stringify(report);
    assert.equal(criterion(report, "byte_custody").code, "DEADLINE");
    await sleep(250);
    assert.equal(report.reportDigest, digestAtReturn); assert.equal(JSON.stringify(report), snapshot, "a late answer cannot mutate a returned report");
    assert.equal(Object.isFrozen(report), true);
    const next = await f.createGate(baselineWorld()).checkBeforeSubmit(f.gateRequest());
    assert.equal(next.verdict, "integrity_passed_blocked");
    // Retention under a hard heap cap: the late 4 MiB answer is collected, not held by the gate.
    const child = spawnSync(process.execPath, ["--max-old-space-size=256", "--expose-gc", new URL("./production-bundle-allocation-child.mjs", import.meta.url).pathname, "late-bytes"], {
      encoding: "utf8", timeout: 120_000, env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? "/tmp" }
    });
    assert.equal(child.status, 0, child.stderr.slice(0, 300));
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result, { code: "DEADLINE", lateAnswered: true, retained: false });
  });

  define_("deadline.late-rejection-swallowed-no-unhandled-rejection", async () => {
    const seen = []; const listener = (reason) => { seen.push(reason); };
    process.on("unhandledRejection", listener);
    try {
      const world = baselineWorld();
      world.hooks.resolve = () => new Promise((resolve, reject) => setTimeout(() => reject(new Error("late failure")), 100));
      const report = await runGate(world, {}, { limits: { resolveMs: 20, totalMs: 5000 } });
      assert.equal(criterion(report, "anchor_resolution").code, "DEADLINE");
      const readWorld = baselineWorld();
      readWorld.hooks.read = (request, dflt) => (request.filename === "output.pdf" ? new Promise((resolve, reject) => setTimeout(() => reject(new Error("late")), 100)) : dflt());
      assert.equal(criterion(await runGate(readWorld, {}, { limits: { readMs: 20 } }), "byte_custody").code, "DEADLINE");
      await sleep(300);
    } finally {
      process.off("unhandledRejection", listener);
    }
    assert.deepEqual(seen, []);
  });

  define_("deadline.semaphore-release-idempotent-no-permanent-hold", async () => {
    const semaphore = new bundle.BoundedSemaphore(1, 1);
    const signal = new AbortController().signal;
    const held = await semaphore.acquire(100, signal);
    held.release(); held.release(); held.release();
    assert.deepEqual(semaphore.state(), { free: 1, queued: 0 }, "repeated releases never mint capacity");
    const again = await semaphore.acquire(100, signal);
    assert.equal(again.status, "acquired");
    const queued = semaphore.acquire(30, signal);
    assert.deepEqual(await queued, { status: "timeout" });
    assert.deepEqual(semaphore.state(), { free: 0, queued: 0 }, "a waiter that times out leaves the queue");
    const controller = new AbortController(); const aborted = semaphore.acquire(5000, controller.signal);
    controller.abort();
    assert.deepEqual(await aborted, { status: "aborted" });
    again.release();
    assert.deepEqual(semaphore.state(), { free: 1, queued: 0 });
  });

  define_("deadline.stalled-holders-do-not-block-queue-forever", async () => {
    const world = baselineWorld(); let calls = 0;
    world.hooks.resolve = (request, dflt) => { calls += 1; return calls === 1 ? new Promise(() => {}) : dflt(); };
    const gate = f.createGate(world, { limits: { maxConcurrent: 1, maxQueued: 4, resolveMs: 40, readMs: 40, totalMs: 3000 } });
    const started = performance.now();
    const stalled = gate.checkBeforeSubmit(f.gateRequest()); await tick();
    const queued = gate.checkBeforeSubmit(f.gateRequest());
    const [a, b] = await Promise.all([stalled, queued]);
    assert.equal(criterion(a, "anchor_resolution").code, "DEADLINE");
    assert.equal(b.verdict, "integrity_passed_blocked", "the queued validation ran after the stalled holder's deadline released the slot");
    assert.ok(performance.now() - started < 2500);
    assert.equal((await gate.checkBeforeSubmit(f.gateRequest())).verdict, "integrity_passed_blocked");
  });

  define_("deadline.total-validation-deadline", async () => {
    const world = baselineWorld();
    world.hooks.resolve = () => new Promise(() => {});
    const gate = f.createGate(world, { limits: { resolveMs: 5000, readMs: 5000, totalMs: 80 } });
    const started = performance.now();
    const report = await gate.checkBeforeSubmit(f.gateRequest());
    assert.ok(performance.now() - started < 1500);
    assert.match(criterion(report, "anchor_resolution").code, /^(ABORTED|DEADLINE)$/);
    world.hooks.resolve = null;
    assert.equal((await gate.checkBeforeSubmit(f.gateRequest())).verdict, "integrity_passed_blocked", "no slot is stranded after a total-deadline abort");
    for (const bad of [{ resolveMs: 0 }, { readMs: 120_001 }, { totalMs: 1.5 }, { maxConcurrent: 9 }, { maxConcurrent: 0 }, { maxQueued: 257 }, { maxQueued: -1 }]) {
      assert.throws(() => f.createGate(world, { limits: bad }), TypeError, JSON.stringify(bad));
    }
  });
}
