#!/usr/bin/env bash
set -euo pipefail
export PATH="$PWD/out/toolchain/node-v24.21.0-linux-x64/bin:$PATH"
if [[ -e out/ci-workload-request.json ]]; then
  status=0
  phase() {
    local name="$1" code=0
    shift
    "$@" || code=$?
    node scripts/ci-workload.mjs phase "$name" "$code"
    if (( code != 0 )); then status=1; fi
  }
  phase build npm run build
  node --input-type=module -e 'import {availableParallelism} from "node:os"; console.log(JSON.stringify({availableParallelism:availableParallelism()}))'
  phase types npm run typecheck
  phase format npm run format:check
  phase workload-tests node --test --test-concurrency=1 scripts/ci-workload-*.test.mjs
  phase chroot node --test scripts/security/chroot-security.test.mjs
  phase observer node --test scripts/security/renderer-observer.test.mjs
  phase launch-probe node --test scripts/security/browser-launch-probe.test.mjs
  phase launch-diagnostic node scripts/security/launch-diagnostic.mjs
  phase pdf-position npm exec --offline -- node dist/scripts/diagnostics/pdf-position.js out/pdf-linux-position
  phase tests npm exec --offline -- node scripts/ci-workload.mjs run
  phase linux-browser node --test scripts/security/linux-browser.test.mjs
  phase calibration npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/linux-ci
  phase root-import node --input-type=module -e 'const api = await import("@jevelopers/print-production"); if (typeof api.renderCalibration !== "function" || typeof api.verifyRuntime !== "function") process.exit(1)'
  phase runtime-receipt node --input-type=module -e 'import {readFile} from "node:fs/promises"; console.log(await readFile("out/evidence/linux-ci/runtime.json", "utf8"))'
  node scripts/ci-workload.mjs finish || status=1
  exit "$status"
fi
npm run build
npm run typecheck
npm run format:check
node --test scripts/security/chroot-security.test.mjs
node --test scripts/security/renderer-observer.test.mjs
node --test scripts/security/browser-launch-probe.test.mjs
node scripts/security/launch-diagnostic.mjs
npm test
node --test scripts/security/linux-browser.test.mjs
npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/linux-ci
node --input-type=module -e 'const api = await import("@jevelopers/print-production"); if (typeof api.renderCalibration !== "function" || typeof api.verifyRuntime !== "function") process.exit(1)'
node --input-type=module -e 'import {readFile} from "node:fs/promises"; console.log(await readFile("out/evidence/linux-ci/runtime.json", "utf8"))'
