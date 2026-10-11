import { test } from "node:test";
import assert from "node:assert/strict";
import { evidence } from "./evidence.js";

test("executes the independent child canary", () => {
	evidence("canary-executed", { executed: true });
	assert.notEqual(
		process.env["PP_DURABILITY_CANARY_FAIL"],
		"1",
		"INTENTIONAL_DURABILITY_CANARY_FAILURE",
	);
});
