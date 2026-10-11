import { test } from "node:test";
import assert from "node:assert/strict";
import type { TemplateSpec, UtcTime } from "@jevelopers/shared-contracts";
import { validatePrimitive } from "@jevelopers/shared-contracts";
import type {
	ProductionReferenceValue,
	ProductionResult,
	ProductionScope,
} from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import { checked, contract } from "../../src/api/canonical-values.js";
import type { CompositionPorts } from "../../src/composition/private-model.js";

class HostTemplates {
	constructor(readonly template: TemplateSpec) {}
	async resolve(
		_ref: ProductionReferenceValue,
		_scope: ProductionScope,
	): Promise<ProductionResult<TemplateSpec>> {
		return { ok: true, value: contract("TemplateSpec", this.template) };
	}
}
class HostClock {
	constructor(readonly timestamp: string) {}
	now(): UtcTime {
		return checked(validatePrimitive("UtcTime", this.timestamp));
	}
}
class HostPrivatePermissions {
	grant = { revoked: false };
	constructor(readonly ports: CompositionPorts) {}
	async resolve(...args: Parameters<CompositionPorts["resolve"]>) {
		return this.ports.resolve(...args);
	}
	async permission(request: Parameters<CompositionPorts["permission"]>[0]) {
		if (this.grant.revoked)
			throw new Error("synthetic private permission revoked");
		return this.ports.permission(request);
	}
	async compositionPermission(
		request: Parameters<CompositionPorts["compositionPermission"]>[0],
	) {
		if (this.grant.revoked)
			throw new Error("synthetic private composition revoked");
		return this.ports.compositionPermission(request);
	}
}
test("keeps authenticated permission backend state mutable for revocation", async () => {
	await using given = await fixtureHost();
	const permissions = new HostPrivatePermissions(
		given.records.profile.private_permissions,
	);
	const candidate = createCandidateProductionOperations({
		...given.host(),
		profiles: [{ ...given.records.profile, private_permissions: permissions }],
	});
	permissions.grant.revoked = true;
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "APPROVAL_INVALID");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});
for (const port of ["templates", "clock"] as const)
	test(`preserves authenticated class receivers when binding host ${port} ports`, async () => {
		await using given = await fixtureHost();
		const host = given.host();
		const candidate = createCandidateProductionOperations({
			...host,
			context: {
				...host.context,
				templates:
					port === "templates"
						? new HostTemplates(given.records.template)
						: host.context.templates,
				clock:
					port === "clock"
						? new HostClock(given.state.now)
						: host.context.clock,
			},
		});
		const when = await candidate.operations.composeArtifact(
			candidate.context,
			given.records.request,
		);
		assert.ok(when.ok, JSON.stringify(when));
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
				"n"
			],
			1,
		);
	});
