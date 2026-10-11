import { resolveOutputPolicy } from "../exporters/private-policy.js";
import type { OutputPolicy } from "../exporters/private-policy.js";
import { productionArchiveLimits } from "@jevelopers/shared-contracts/production-operations";

export function candidateOutputPolicy(policy: OutputPolicy): OutputPolicy {
	return resolveOutputPolicy({
		...policy,
		maxBytes: Math.min(policy.maxBytes, productionArchiveLimits.entry_bytes),
	});
}
