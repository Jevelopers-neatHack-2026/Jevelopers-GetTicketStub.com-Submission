import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { workloadPlan, groups, selectGroup } from "./ci-workload-plan.mjs";
import { requestSchema } from "./ci-workload-evidence.mjs";
import { fixtureWorkload } from "./ci-workload-fixture.mjs";

test("includes every compiled file exactly once when future tests are added", async (t) => {
	const root = await fixtureWorkload();
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(join(root, "tests/integration/new-pdf.test.ts"), "");
	await writeFile(join(root, "dist/tests/integration/new-pdf.test.js"), "");
	const plan = await workloadPlan(root);
	const union = groups.flatMap((group) => selectGroup(plan, group));
	assert.equal(union.length, 49);
	assert.equal(new Set(union.map((file) => file.path)).size, 49);
	assert.equal(
		union.find((file) => file.path.endsWith("/new-pdf.test.js")).group,
		"standalone",
	);
	assert.equal(selectGroup(plan, "cli").length, 1);
	assert.equal(selectGroup(plan, "private").length, 3);
	assert.ok(Object.isFrozen(plan.files) && plan.files.every(Object.isFrozen));
});

for (const fault of [
	"missing-compiled",
	"extra-compiled",
	"missing-source",
	"symlink",
	"removed-baseline",
]) {
	test(`rejects incomplete compiled discovery when ${fault} exists`, async (t) => {
		const root = await fixtureWorkload();
		t.after(() => rm(root, { recursive: true, force: true }));
		const compiled = join(root, "dist/tests/unit/composition-assets.test.js");
		switch (fault) {
			case "missing-compiled":
				await rm(compiled);
				break;
			case "extra-compiled":
				await writeFile(join(root, "dist/tests/unit/stale.test.js"), "");
				break;
			case "missing-source":
				await rm(join(root, "tests/unit/composition-assets.test.ts"));
				break;
			case "symlink":
				await rm(compiled);
				await symlink(
					join(root, "tests/unit/composition-assets.test.ts"),
					compiled,
				);
				break;
			case "removed-baseline":
				await rm(compiled);
				await rm(join(root, "tests/unit/composition-assets.test.ts"));
				break;
			default:
				assert.fail("Unhandled fixture fault.");
		}
		await assert.rejects(workloadPlan(root));
	});
}

test("changes the immutable union digest when a compiled test changes", async (t) => {
	const root = await fixtureWorkload();
	t.after(() => rm(root, { recursive: true, force: true }));
	const before = await workloadPlan(root);
	await writeFile(
		join(root, "dist/tests/unit/composition-assets.test.js"),
		"changed",
	);
	assert.notEqual((await workloadPlan(root)).unionDigest, before.unionDigest);
});

for (const group of [
	"",
	"all",
	"unit",
	"standalone,cli",
	"../cli",
	"--test-name-pattern=x",
]) {
	test(`rejects an unknown or partial selection when group is ${JSON.stringify(group)}`, () => {
		const request = {
			group,
			revision: "a".repeat(40),
			runId: "1",
			attempt: "1",
		};
		assert.equal(requestSchema.safeParse(request).success, false);
		assert.throws(() => selectGroup({ files: [] }, group));
	});
}

test("rejects file filtering when a request has extra selection fields", () => {
	assert.equal(
		requestSchema.safeParse({
			group: "cli",
			revision: "a".repeat(40),
			runId: "1",
			attempt: "1",
			files: ["only-one.js"],
		}).success,
		false,
	);
});
