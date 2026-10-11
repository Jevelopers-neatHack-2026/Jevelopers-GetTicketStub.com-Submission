import { openOfflineBrowser } from "../../dist/src/exporters/offline-browser.js";
import { loadPins } from "../../dist/src/runtime/environment.js";
import { VerificationFailure } from "../../dist/src/runtime/errors.js";

// Fixed synthetic launch only. The parent captures both streams; never emit errors.
try {
	const opened = await openOfflineBrowser(await loadPins());
	await opened.browser.close();
} catch (error) {
	if (error instanceof VerificationFailure) {
		process.exitCode = error.code === "SANDBOX_POLICY_FAILURE" ? 2 : 3;
	} else {
		process.exitCode = 4;
	}
}
