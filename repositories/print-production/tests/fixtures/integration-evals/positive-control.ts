import {
	readRequest,
	readBounded,
	configurationSchema,
	sourceReceipt,
	claimRoot,
	digest,
	applyRendererEnvironment,
} from "../../../scripts/integration-evals/protocol.js";
import { safeLogo } from "../composition/corpus.js";
import { z } from "zod";

const request = await readRequest();
await sourceReceipt(request);
const config = configurationSchema.parse(
	JSON.parse((await readBounded(request.configuration_artifact)).toString()),
);
await applyRendererEnvironment(config);
const { integrationHost } = await import("./host.js");
const { root } = await claimRoot(request);
await using host = await integrationHost({
	root,
	preserve: true,
	clock: request.clock,
	logo: safeLogo,
});
const result = await host.candidate.operations.composeArtifact(
	host.candidate.context,
	host.records.request,
);
const files = host.db.sql
	.prepare(
		"SELECT name,f.digest,b.bytes FROM files f JOIN blobs b ON b.digest=f.digest ORDER BY name",
	)
	.all()
	.map((raw) => {
		const file = z
			.object({
				name: z.string(),
				digest: z.string(),
				bytes: z.instanceof(Uint8Array),
			})
			.parse(raw);
		return {
			name: file.name,
			stored_hash: file.digest,
			actual_hash: digest(file.bytes),
			bytes: file.bytes.length,
		};
	});
const publications = z
	.object({ n: z.number() })
	.parse(host.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()).n;
process.stdout.write(
	JSON.stringify({
		result,
		publications,
		files,
		asset_resolutions: host.state.assetCalls,
	}) + "\n",
);
