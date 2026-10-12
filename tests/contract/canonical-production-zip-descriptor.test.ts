import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { packZip } from "../../src/exporters/private-zip.js";
import { outputFile } from "../../src/exporters/private-policy.js";
import { validatePrimitive } from "@jevelopers/shared-contracts";
import { verifyProductionZip } from "@jevelopers/shared-contracts/production-operations";
import type { ProductionZipDescriptor } from "@jevelopers/shared-contracts/production-operations";

test("verifies actual ZIP bytes with the owner minimal descriptor type", () => {
	const bytes = Buffer.from("private development payload");
	const hash = validatePrimitive(
		"Sha256",
		`sha256:${createHash("sha256").update(bytes).digest("hex")}`,
	);
	assert.ok(hash.ok);
	const given: readonly ProductionZipDescriptor[] = [
		{ filename: "payload.txt", byte_size: bytes.length, byte_hash: hash.value },
	];
	const archive = packZip([], outputFile("payload.txt", bytes)).bytes;
	const when = verifyProductionZip(archive, given);
	assert.ok(when.ok);
	assert.equal(when.value.length, 1);
	assert.equal(when.value[0]?.filename, "payload.txt");
	assert.deepEqual(Buffer.from(when.value[0]?.bytes ?? []), bytes);
});
