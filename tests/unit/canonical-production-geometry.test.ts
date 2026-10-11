import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import { mm, nm } from "../../src/api/canonical-layout.js";
import { productionContentHash } from "@jevelopers/shared-contracts/production-operations";
import { CandidateFailure } from "../../src/api/canonical-values.js";

test("converts nanometres exactly at the minimum private precision", () => {
	assert.equal(nm(mm("1")), "1");
	assert.equal(nm(mm("101600000")), "101600000");
	assert.equal(nm(mm("-1234567")), "-1234567");
});
for (const mode of ["geometry", "profile"] as const)
	test(`rejects authenticated unsupported ${mode} before any composition execution`, async () => {
		await using given = await fixtureHost();
		const draft = {
			...given.records.template,
			revision: 2,
			coordinate_geometry:
				mode === "geometry"
					? {
							...given.records.template.coordinate_geometry,
							canvas: {
								...given.records.template.coordinate_geometry.canvas,
								width_nm: "2000000001",
							},
						}
					: given.records.template.coordinate_geometry,
		};
		const template = { ...draft, content_hash: productionContentHash(draft) };
		const templateRef = {
			...given.records.request.binding.template_ref,
			revision: 2,
			content_hash: template.content_hash,
		};
		const oldHost = given.host();
		const candidate = createCandidateProductionOperations({
			...oldHost,
			context: {
				...oldHost.context,
				runtime: { ...oldHost.context.runtime, template_ref: templateRef },
				templates: { resolve: async () => ({ ok: true, value: template }) },
			},
			profiles: [
				...oldHost.profiles,
				{
					...given.records.profile,
					template_ref: templateRef,
					layout: {
						...given.records.profile.layout,
						profile: mode === "profile" ? "cmyk" : "srgb",
					},
				},
			],
			external_references: [...oldHost.external_references, templateRef],
		});
		const when = await candidate.operations.composeArtifact(candidate.context, {
			...given.records.request,
			binding: { ...given.records.request.binding, template_ref: templateRef },
		});
		assert.ok(!when.ok);
		assert.equal(
			when.error.code,
			mode === "profile" ? "OUTPUT_UNSUPPORTED" : "INCOMPATIBLE_TEMPLATE",
		);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
			0,
		);
	});
test("rejects nonrepresentable geometry without allocating payload bytes", () => {
	assert.throws(() => mm("2000000001"), CandidateFailure);
});
