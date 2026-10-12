#!/usr/bin/env node
import { parseArguments, dispatchVerification } from "./dispatcher.js";
import { failureReceipt } from "../../src/runtime/errors.js";

try {
	process.exitCode = await dispatchVerification(
		parseArguments(process.argv.slice(2)),
	);
} catch (error) {
	process.stderr.write(
		`${JSON.stringify({ status: "failed", failure: failureReceipt(error) })}\n`,
	);
	process.exitCode = 1;
}
