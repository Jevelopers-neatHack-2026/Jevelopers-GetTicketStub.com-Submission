import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { resource } from "../../src/runtime/resources.js";

test("installs the frozen unaccepted candidate archive with the exact source and integrity pins", async () => {
	const given = z
		.object({
			version: z.literal("0.9.7"),
			source_revision: z.literal("d432ad5c895a67155affeaa05cd8423c758d95c3"),
			archive_sha256: z.literal(
				"771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43",
			),
			integrity: z.literal(
				"sha512-P462b8thg20g5RknBzdDL5mfxpXF+kpodLPCGrTe3kmKXrw9YZ21x3E/PuGEp0aEOGoiBZlq5JB4Pktq+2lBPg==",
			),
			accepted: z.literal(false),
			live_integration: z.literal(false),
			package_content_digest: z.literal(
				"sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1",
			),
			fixture_digest: z.literal(
				"sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab",
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
		resource("vendor/shared-contracts/jevelopers-shared-contracts-0.9.7.tgz"),
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

for (const [manifest, digest] of [
	[
		"package-content-manifest",
		"sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1",
	],
	[
		"fixture-manifest",
		"sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab",
	],
] as const)
	test(`verifies installed ${manifest} members against the immutable owner digest`, async () => {
		const given = z
			.object({
				digest: z.string(),
				files: z.record(z.string(), z.string()),
			})
			.parse(
				JSON.parse(
					await readFile(
						resource(
							`node_modules/@jevelopers/shared-contracts/generated/${manifest}.json`,
						),
						"utf8",
					),
				),
			);
		const when = Object.fromEntries(
			await Promise.all(
				Object.keys(given.files)
					.sort()
					.map(async (path) => [
						path,
						`sha256:${createHash("sha256")
							.update(
								await readFile(
									resource(`node_modules/@jevelopers/shared-contracts/${path}`),
								),
							)
							.digest("hex")}`,
					]),
			),
		);
		assert.deepEqual(when, given.files);
		assert.equal(given.digest, digest);
		assert.equal(
			`sha256:${createHash("sha256").update(JSON.stringify(when)).digest("hex")}`,
			digest,
		);
	});
