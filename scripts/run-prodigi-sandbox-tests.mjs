import { runProdigiSandboxSuite } from "../tests/prodigi-sandbox-suite.mjs";

const checks = await runProdigiSandboxSuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ""}\n`);
}
process.stdout.write(`Prodigi sandbox adapter suite: ${checks.length - failed.length}/${checks.length} passed (externalProviderCalls: 0)\n`);
if (failed.length > 0) process.exitCode = 1;
