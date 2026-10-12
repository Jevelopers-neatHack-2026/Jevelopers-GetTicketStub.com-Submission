// The sandbox network guard is imported first, so it is installed before the
// suite loads `dist/` (static imports evaluate in order).
import "../tests/prodigi-sandbox-network-guard.mjs";
import { networkGuardInstalled, runProdigiCallbackSuite } from "../tests/prodigi-callback-suite.mjs";

const checks = await runProdigiCallbackSuite();
const guardOk = networkGuardInstalled();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ""}\n`);
}
if (!guardOk) process.stdout.write("FAILED runner: network_guard_not_installed\n");
process.stdout.write(`Prodigi callback reconciliation suite: ${checks.length - failed.length}/${checks.length} passed (externalProviderCalls: 0, measured by network guard)\n`);
if (failed.length > 0 || !guardOk) process.exitCode = 1;
