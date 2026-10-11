import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resource } from "../../src/runtime/resources.js";

test("installs the frozen unaccepted candidate archive with the exact source and integrity pins", async () => {
	const given = z
		.object({
			version: z.literal("0.9.4"),
			source_revision: z.literal("d96e6cf3d8f390126407cdbc9f37b750d3256069"),
			archive_sha256: z.literal(
				"8f388a5b0e03be4be02083c5f2bcf62b614658a3a64498dd16287da6a4fb7616",
			),
			integrity: z.string(),
			accepted: z.literal(false),
			live_integration: z.literal(false),
			package_content_digest: z.literal(
				"sha256:2c4cb6e4576519b3c51ea4e076aab40b2922f7c6118729e735f17685b90f6920",
			),
			fixture_digest: z.literal(
				"sha256:efc2ee556c8ba43c29ea36932af8c947048b059ff4f2d7a7bbec15b85a05f07b",
			),
		})
		.parse(
			JSON.parse(
				await readFile(
					resource("vendor/shared-contracts/candidate-pin.json"),
					"utf8",
				),
			),
		);
	const when = await readFile(
		resource("vendor/shared-contracts/jevelopers-shared-contracts-0.9.4.tgz"),
	);
	assert.equal(
		createHash("sha256").update(when).digest("hex"),
		given.archive_sha256,
	);
	assert.equal(
		`sha512-${createHash("sha512").update(when).digest("base64")}`,
		given.integrity,
	);
	assert.equal(
		z
			.object({ version: z.string() })
			.parse(
				JSON.parse(
					await readFile(
						resource("node_modules/@jevelopers/shared-contracts/package.json"),
						"utf8",
					),
				),
			).version,
		given.version,
	);
});
