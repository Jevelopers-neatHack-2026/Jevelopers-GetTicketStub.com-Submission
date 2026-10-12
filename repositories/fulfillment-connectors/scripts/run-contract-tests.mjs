import { runContractSuite } from "../tests/contract-suite.mjs";

const checks = await runContractSuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.id}\n`);
}
process.stdout.write(`Contract fixture suite: ${checks.length - failed.length}/${checks.length} passed\n`);
if (failed.length > 0) process.exitCode = 1;
