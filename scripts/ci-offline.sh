#!/usr/bin/env bash
set -euo pipefail
export PATH="$PWD/out/toolchain/node-v24.21.0-linux-x64/bin:$PATH"
npm run build
npm run typecheck
npm run format:check
node scripts/security/launch-diagnostic.mjs
npm test
node --test scripts/security/linux-browser.test.mjs
npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/linux-ci
node --input-type=module -e 'const api = await import("@jevelopers/print-production"); if (typeof api.renderCalibration !== "function" || typeof api.verifyRuntime !== "function") process.exit(1)'
node --input-type=module -e 'import {readFile} from "node:fs/promises"; console.log(await readFile("out/evidence/linux-ci/runtime.json", "utf8"))'
