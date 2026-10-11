import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resource } from "../../src/runtime/resources.js";

test("installs the frozen unaccepted candidate archive with the exact source and integrity pins", async () => {
	const given = z
		.object({
			version: z.literal("0.9.3"),
			source_revision: z.literal("d129ea0a83be926882b194cb88a6cf30c3831685"),
			archive_sha256: z.literal(
				"5a4d345ee2751e731aa44c1bbe33a079109998b6471ce2c7daa0b74aedec9352",
			),
			integrity: z.string(),
			accepted: z.literal(false),
			live_integration: z.literal(false),
			package_content_digest: z.literal(
				"sha256:eb0944e13aede0d932257d1d4196e693ebc05a612f6d8f3f466394d16e2086fd",
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
		resource("vendor/shared-contracts/jevelopers-shared-contracts-0.9.3.tgz"),
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
