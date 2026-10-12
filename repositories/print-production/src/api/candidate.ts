import type { ProductionOperations } from "@jevelopers/shared-contracts/production-operations";
import { CandidateRuntime } from "./canonical-runtime.js";
import type { CanonicalHost } from "./canonical-host.js";
import { compose } from "./canonical-artifacts.js";
import { exportBundle } from "./canonical-exports.js";
import { inspect, compare, artifactStatus } from "./canonical-read.js";
import { personalize, jobStatus } from "../personalization/canonical-batch.js";
export type { CanonicalHost, CanonicalProfile } from "./canonical-host.js";

export function createCandidateProductionOperations(host: CanonicalHost) {
	const runtime = new CandidateRuntime(host);
	const operations: ProductionOperations = {
		composeArtifact: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "composeArtifact", request },
				(parsed) => compose(runtime, parsed),
			),
		personalizeArtifactBatch: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "personalizeArtifactBatch", request },
				(parsed) => personalize(runtime, parsed),
			),
		inspectArtifact: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "inspectArtifact", request },
				(parsed) => inspect(runtime, parsed),
			),
		exportArtifactBundle: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "exportArtifactBundle", request },
				(parsed) => exportBundle(runtime, parsed),
			),
		compareTemplateCompatibility: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "compareTemplateCompatibility", request },
				(parsed) => compare(runtime, parsed),
			),
		getArtifactManifestStatus: (ctx, request) =>
			runtime.entry(
				{ context: ctx, operation: "getArtifactManifestStatus", request },
				async (parsed) =>
					parsed.target.kind === "artifact"
						? artifactStatus(runtime, parsed)
						: jobStatus(runtime, parsed),
			),
	};
	return Object.freeze({
		status: "unaccepted-development" as const,
		accepted: false as const,
		context: runtime.context,
		operations: Object.freeze(operations),
	});
}
