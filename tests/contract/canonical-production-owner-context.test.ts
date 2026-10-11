import { test } from "node:test";
import assert from "node:assert/strict";
import {
	checkComposition,
	checkProductionApproval,
	checkProductionValueIntegrity,
	productionReferences,
} from "@jevelopers/shared-contracts/production-operations";
import { ownerFixture } from "../fixtures/canonical-production/owner.js";

test("returns a typed context failure when an expected composition reference is noncanonical", async () => {
	const [composition, template, personalization] = await Promise.all([
		ownerFixture("Composition"),
		ownerFixture("TemplateSpec"),
		ownerFixture("PersonalizationSchema"),
	]);
	const scope = {
		tenant_id: composition.tenant_id,
		project_id: composition.project_id,
	};
	assert.ok(
		checkProductionValueIntegrity("Composition", composition, scope).ok,
	);
	const expected = Object.fromEntries(productionReferences(composition));
	const context = {
		scope,
		template,
		personalization,
		facts: null,
		expected_references: {
			...expected,
			"/template_ref": Object.assign({}, composition.template_ref, {
				unsupported: undefined,
			}),
		},
		expected_resolved_layout_commitment: composition.resolved_layout_commitment,
		expected_policy_refs: composition.policy_refs,
		expected_font_refs: composition.font_refs,
		expected_runtime_ref: composition.runtime_ref,
		asset_bytes: {},
	};
	const when = checkComposition(composition, context);
	assert.deepEqual(when, {
		ok: false,
		errors: [{ code: "INVALID_TRUST_CONTEXT", path: "" }],
	});
});

test("returns a typed context failure when an expected approval binding is noncanonical", async () => {
	const receipt = await ownerFixture("ApprovalReceipt");
	const context = {
		scope: { tenant_id: receipt.tenant_id, project_id: receipt.project_id },
		actor_id: receipt.actor_id,
		audience: receipt.audience,
		now: receipt.issued_at,
		expected_binding: Object.assign(new Date(0), receipt.binding),
	};
	const when = checkProductionApproval(
		{ receipt, status: "valid", checked_at: receipt.issued_at },
		context,
	);
	assert.deepEqual(when, {
		ok: false,
		errors: [{ code: "INVALID_TRUST_CONTEXT", path: "" }],
	});
});
