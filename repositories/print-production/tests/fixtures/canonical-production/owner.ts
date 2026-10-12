import { z } from "zod";
import { readResource } from "../../../src/runtime/resources.js";
import type { ContractName, ContractMap } from "@jevelopers/shared-contracts";
import { contract } from "../../../src/api/canonical-values.js";
export async function ownerFixture<K extends ContractName>(
	name: K,
): Promise<ContractMap[K]> {
	const bytes = await readResource(
		`node_modules/@jevelopers/shared-contracts/fixtures/${name}.json`,
	);
	const parsed = z
		.object({ valid: z.unknown() })
		.parse(JSON.parse(bytes.toString()));
	return contract(name, parsed.valid);
}
