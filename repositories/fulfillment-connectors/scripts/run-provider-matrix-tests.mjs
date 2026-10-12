import { runProviderMatrixSuite } from "../tests/provider-matrix-suite.mjs";

const checks = await runProviderMatrixSuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.id}\n`);
}
process.stdout.write(`Provider matrix fixture suite: ${checks.length - failed.length}/${checks.length} passed\n`);
if (failed.length > 0) process.exitCode = 1;
