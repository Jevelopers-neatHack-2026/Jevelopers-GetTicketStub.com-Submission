import { z } from "zod";
import {
	composeArtifact as composePrivate,
	verifyArtifactIdentity,
} from "../composition/private-model.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import { fingerprint, digestSchema } from "../composition/primitives.js";
import { parseAsset } from "../assets/private-assets.js";
import { layoutText } from "../typography/private-text.js";
import { outputFile } from "../exporters/private-policy.js";
import { idSchema } from "../internal/durability.js";
import { executeCanonical } from "../storage/canonical-execution.js";
import type {
	ArtifactRef,
	ComposeArtifactRequest,
} from "@jevelopers/shared-contracts";
import type { CandidateRuntime } from "./canonical-runtime.js";
import { resolveInputs } from "./canonical-inputs.js";
import type { CanonicalInputs } from "./canonical-inputs.js";
import {
	contract,
	requireCandidate,
	same,
	sha,
	version,
	jsonBytes,
} from "./canonical-values.js";

const storedSchema = z
	.object({
		request: z.unknown(),
		result: z.unknown(),
		svg: z.string(),
		execution_attempt: idSchema,
	})
	.strict();
export async function compose(
	runtime: CandidateRuntime,
	request: ComposeArtifactRequest,
): Promise<ArtifactRef> {
	const inputs = await resolveInputs(runtime, request.binding);
	const operation = runtime.bind("composeArtifact", request);
	const published = runtime.state.store.publication(
		runtime.host.private_scope,
		operation.id,
	);
	if (published) {
		const stored = runtime.state
			.read(published.id)
			.find((f) => f.name === "canonical-state.json");
		requireCandidate(stored !== undefined, "INTEGRITY_FAILURE", "integrity");
		const snapshot = storedSchema.parse(
			JSON.parse(Buffer.from(stored.bytes).toString()),
		);
		const result = contract("ArtifactRef", snapshot.result);
		restore(inputs, result, snapshot.svg);
		runtime.registerValue(result);
		return result;
	}
	return executeCanonical(runtime.host.db, operation.id, async (attempt) => {
		const artifact = await composePrivate(
			inputs.input,
			inputs.layout,
			inputs.profile.fonts.map((f) => f.font),
			inputs.ports,
			Date.parse(runtime.now()),
		);
		const result = artifactReference(
			artifact,
			request.binding.composition_ref,
			operation.id,
		);
		runtime.state.publish(
			operation.id,
			[
				outputFile("output.svg", Buffer.from(artifact.svg)),
				outputFile(
					"canonical-state.json",
					jsonBytes({
						request,
						result,
						svg: artifact.svg,
						execution_attempt: attempt,
					}),
				),
			],
			{ attempt },
		);
		runtime.registerValue(result);
		return result;
	});
}
export function artifactReference(
	artifact: PrivateArtifact,
	composition: ArtifactRef["composition_ref"],
	id: string,
): ArtifactRef {
	return contract("ArtifactRef", {
		contract: "ArtifactRef",
		...version,
		artifact_ref: {
			contract: "ArtifactFile",
			schema_version: "2.0.0",
			id,
			revision: 1,
			content_hash: sha(`sha256:${artifact.renderHash}`),
		},
		composition_ref: composition,
		private_revision_hash: sha(`sha256:${artifact.revision}`),
		source_artwork_hashes: artifact.sourceArtworkHashes.map((h) =>
			sha(`sha256:${h}`),
		),
		render_hash: sha(`sha256:${artifact.renderHash}`),
		preview_ref: null,
	});
}
export async function readArtifact(
	runtime: CandidateRuntime,
	ref: ArtifactRef,
) {
	const publication = runtime.state.store.publication(
		runtime.host.private_scope,
		idSchema.parse(ref.artifact_ref.id),
	);
	requireCandidate(publication !== null, "NOT_FOUND", "access");
	const files = runtime.state.read(publication.id);
	const stored = files.find((file) => file.name === "canonical-state.json");
	requireCandidate(stored !== undefined, "INTEGRITY_FAILURE", "integrity");
	const snapshot = storedSchema.parse(
		JSON.parse(Buffer.from(stored.bytes).toString()),
	);
	const result = contract("ArtifactRef", snapshot.result);
	requireCandidate(same(ref, result), "HASH_MISMATCH", "integrity");
	const request = contract("ComposeArtifactRequest", snapshot.request);
	const inputs = await resolveInputs(runtime, request.binding);
	const artifact = restore(inputs, result, snapshot.svg);
	return { artifact, inputs, request, result };
}
function restore(
	inputs: CanonicalInputs,
	result: ArtifactRef,
	svg: string,
): PrivateArtifact {
	const fonts = inputs.profile.fonts
		.map((f) => f.font)
		.sort((a, b) =>
			a.descriptor.ref < b.descriptor.ref
				? -1
				: a.descriptor.ref > b.descriptor.ref
					? 1
					: 0,
		);
	const model = {
		input: inputs.input,
		layout: inputs.layout,
		fonts: fonts.map((f) => f.descriptor),
	};
	const bindings = inputs.input.nodes.flatMap((node) =>
		node.kind === "artwork" || node.kind === "overlay" ? [node.asset] : [],
	);
	const assets = bindings
		.filter(
			(binding, index) => bindings.findIndex((b) => same(b, binding)) === index,
		)
		.map((binding) => {
			const mapping = inputs.profile.asset_refs.find(
				(a) =>
					a.private_ref === binding.ref &&
					a.private_revision === binding.version,
			);
			const bytes = mapping ? inputs.bytes[mapping.reference.id] : undefined;
			requireCandidate(bytes !== undefined, "ASSET_MISSING", "asset");
			return parseAsset(binding, bytes);
		});
	const artifact: PrivateArtifact = {
		model,
		compositionHash: fingerprint(model),
		assets,
		fontBytes: fonts,
		texts: inputs.input.nodes.flatMap((node) =>
			node.kind === "text" ? [layoutText(node.field, fonts)] : [],
		),
		sourceArtworkHashes: assets
			.filter((a) => a.binding.purpose === "artwork")
			.map((a) => a.binding.digest),
		svg,
		renderHash: digestSchema.parse(result.render_hash.replace(/^sha256:/, "")),
		revision: digestSchema.parse(
			result.private_revision_hash.replace(/^sha256:/, ""),
		),
		parent: null,
		receipts: [],
	};
	verifyArtifactIdentity(artifact);
	requireCandidate(
		same(
			result,
			artifactReference(
				artifact,
				{
					contract: "Composition",
					schema_version: "1.0.0",
					id: inputs.composition.composition_id,
					revision: inputs.composition.revision,
					content_hash: inputs.composition.content_hash,
				},
				result.artifact_ref.id,
			),
		),
		"HASH_MISMATCH",
	);
	return artifact;
}
