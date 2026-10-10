import { fileURLToPath } from "node:url";
import { runIndependentTests } from "../../../src/internal/independent-tests.js";

const directory = process.argv[2];
if (!directory) throw new Error("fixture evidence directory required");
try {
	const result = await runIndependentTests({
		paths: [fileURLToPath(new URL("canary.js", import.meta.url))],
		evidenceDir: directory,
		requiredEvidence: ["canary-executed.json"],
	});
	process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
	if (!(error instanceof Error)) throw error;
	process.stderr.write("RUNTIME_FAILURE\n");
	process.exitCode = 1;
}
