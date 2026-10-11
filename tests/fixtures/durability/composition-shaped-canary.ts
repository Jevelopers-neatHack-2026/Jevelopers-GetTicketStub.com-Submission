import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

test("executes a child using composition-shaped evidence configuration", () => {
	const directory = process.env["PP_COMPOSITION_EVIDENCE_DIR"];
	assert.ok(directory);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "content-integrity.json"),
		JSON.stringify({ mode: "synthetic-draft-only", executed: true }),
	);
});
