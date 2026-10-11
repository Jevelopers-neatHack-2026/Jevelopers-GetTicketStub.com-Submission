import { z } from "zod";
import { readResource, sha256 } from "../runtime/resources.js";
import { requireCandidate } from "./canonical-values.js";

const pinSchema = z
	.object({
		package: z.literal("@jevelopers/shared-contracts"),
		version: z.string(),
		source_repository: z.string(),
		source_pr: z.number().int().positive(),
		source_revision: z.string().regex(/^[a-f0-9]{40}$/),
		archive: z.string().regex(/^jevelopers-shared-contracts-[\d.]+\.tgz$/),
		archive_sha256: z.string().regex(/^[a-f0-9]{64}$/),
		integrity: z.string(),
		package_content_digest: z.string(),
		fixture_digest: z.string(),
		accepted: z.literal(false),
		status: z.literal("unaccepted-development-candidate"),
		live_integration: z.literal(false),
	})
	.strict()
	.readonly();
export async function consumerPin() {
	const pin = pinSchema.parse(
		JSON.parse(
			(
				await readResource("vendor/shared-contracts/candidate-pin.json")
			).toString(),
		),
	);
	const installed = z
		.object({ version: z.string() })
		.parse(
			JSON.parse(
				(
					await readResource(
						"node_modules/@jevelopers/shared-contracts/package.json",
					)
				).toString(),
			),
		);
	requireCandidate(
		installed.version === pin.version &&
			sha256(await readResource(`vendor/shared-contracts/${pin.archive}`)) ===
				pin.archive_sha256,
		"HASH_MISMATCH",
		"integrity",
	);
	return pin;
}
