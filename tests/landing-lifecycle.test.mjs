import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the real nested initializer with controllable module loads. No WebGL or network is needed:
// the mounted control deliberately stops after renderer allocation, before unrelated scene setup.
const path = new URL("../src/customer/landing/landing.script.ts", import.meta.url);
const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
const initializers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "build3D") initializers.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(initializers.length, 1, "the landing has one 3D initializer");
const initializer = initializers[0].getText(source).replace(/\bimport\(/g, "load(");
const initialize = new Function("env", "load", `with (env) { return (${initializer})(); }`);
const MODULES = ["three", "three/addons/loaders/GLTFLoader.js", "three/addons/environments/RoomEnvironment.js"];
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function renderUntilBoundary(pauseAt = null) {
  let created = 0;
  let disposed = 0;
  let release;
  let reached = false;
  const pause = new Promise((resolve) => { release = resolve; });
  const env = {
    disposed: false,
    disposers: [],
    byId: () => ({ addEventListener() {} }),
    devicePixelRatio: 1,
    innerWidth: 390,
    innerHeight: 844,
  };
  const modules = {
    three: {
      WebGLRenderer: class {
        constructor() { created++; this.shadowMap = {}; }
        setPixelRatio() {}
        dispose() { disposed++; }
        forceContextLoss() {}
      },
      Scene: class { constructor() { throw new Error("mounted renderer reached scene setup"); } },
    },
    [MODULES[1]]: { GLTFLoader: class {} },
    [MODULES[2]]: { RoomEnvironment: class {} },
  };
  const load = async (name) => {
    assert.ok(Object.hasOwn(modules, name), `unexpected module: ${name}`);
    if (name === pauseAt) { reached = true; await pause; }
    return modules[name];
  };
  const pending = initialize(env, load).catch((error) => error.message);
  await nextTurn();
  const cleanup = () => {
    env.disposed = true;
    env.disposers.splice(0).reverse().forEach((stop) => stop());
  };
  if (pauseAt) {
    assert.equal(reached, true, `reached the pending ${pauseAt} import`);
    cleanup();
    release();
  }
  const result = await pending;
  const lateDisposers = env.disposers.length;
  if (!pauseAt) cleanup();
  return { result, created, disposed, lateDisposers };
}

for (const name of MODULES) {
  test(`landing: unmount while ${name} loads allocates no renderer or late cleanup`, async () => {
    assert.deepEqual(await renderUntilBoundary(name), {
      result: "unmounted", created: 0, disposed: 0, lateDisposers: 0,
    });
  });
}

test("landing: a mounted initializer allocates a renderer and registers working cleanup", async () => {
  assert.deepEqual(await renderUntilBoundary(), {
    result: "mounted renderer reached scene setup", created: 1, disposed: 1, lateDisposers: 1,
  });
});
