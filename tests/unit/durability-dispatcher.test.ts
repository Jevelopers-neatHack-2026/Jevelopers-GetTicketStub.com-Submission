import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dispatchVerification } from "../../scripts/verify/dispatcher.js";
import { fixture } from "../fixtures/durability/fixture.js";

for (const suite of [
	"artifact-storage",
	"restart-recovery",
	"metering-traces",
] as const) {
	test(`runs private checks but preserves the missing external gate for ${suite}`, {
		timeout: 20000,
	}, async () => {
		using f = fixture();
		const exit = await dispatchVerification({
			suite,
			mode: "offline",
			evidenceDir: f.root,
		});
		assert.equal(exit, 1);
		const receipt: unknown = JSON.parse(
			await readFile(join(f.root, `${suite}.json`), "utf8"),
		);
		const local: unknown = JSON.parse(
			await readFile(join(f.root, `${suite}-local.json`), "utf8"),
		);
		assert.ok(
			typeof receipt === "object" && receipt !== null && "status" in receipt,
		);
		assert.equal(receipt.status, "failed");
		assert.ok("externalState" in receipt);
		assert.equal(receipt.externalState, "external-blocked");
		assert.ok(
			typeof local === "object" && local !== null && "exitCode" in local,
		);
		assert.equal(local.exitCode, 0);
	});
}
