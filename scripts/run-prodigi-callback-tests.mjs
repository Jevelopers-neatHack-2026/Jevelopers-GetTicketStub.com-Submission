import { runProdigiCallbackSuite } from "../tests/prodigi-callback-suite.mjs";

const checks = await runProdigiCallbackSuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ""}\n`);
}
process.stdout.write(`Prodigi callback reconciliation suite: ${checks.length - failed.length}/${checks.length} passed (externalProviderCalls: 0)\n`);
if (failed.length > 0) process.exitCode = 1;
