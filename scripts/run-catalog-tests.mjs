import { runCatalogSuite } from "../tests/catalog-suite.mjs";

const checks = await runCatalogSuite();
const failed = checks.filter((check) => check.status !== "passed");
for (const check of checks) {
  process.stdout.write(`${check.status.toUpperCase()} ${check.name}${check.detail ? `: ${check.detail}` : ""}\n`);
}
process.stdout.write(`Catalog fixture suite: ${checks.length - failed.length}/${checks.length} passed\n`);
if (failed.length > 0) process.exitCode = 1;
