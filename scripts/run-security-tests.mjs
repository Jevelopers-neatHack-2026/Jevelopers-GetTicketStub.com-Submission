import { runSecuritySuite } from "../tests/security-suite.mjs";

const checks = await runSecuritySuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.id}\n`);
}
process.stdout.write(`Security fixture suite: ${checks.length - failed.length}/${checks.length} passed\n`);
if (failed.length > 0) process.exitCode = 1;
