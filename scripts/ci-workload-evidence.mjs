import assert from "node:assert/strict";
import { z } from "zod";
import { groups, selectGroup } from "./ci-workload-plan.mjs";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().nonnegative();
export const requestSchema = z.strictObject({
	group: z.enum([...groups, "aggregate"]),
	revision: z.string().regex(/^[a-f0-9]{40}$/),
	runId: z.string().regex(/^[1-9][0-9]*$/),
	attempt: z.string().regex(/^[1-9][0-9]*$/),
});
export const countsSchema = z.strictObject({
	tests: integer,
	pass: integer,
	fail: integer,
	cancelled: integer,
	skipped: integer,
	todo: integer,
});
export const totals = (files) =>
	Object.fromEntries(
		Object.keys(countsSchema.shape).map((key) => [
			key,
			files.reduce((sum, file) => sum + file.counts[key], 0),
		]),
	);
export const completeCounts = (counts) =>
	counts.tests > 0 &&
	counts.pass === counts.tests &&
	["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
const fileSchema = z.strictObject({
	path: z
		.string()
		.regex(/^dist\/tests\/(unit|contract|integration)\/[a-z0-9-]+\.test\.js$/),
	digest: sha,
	counts: countsSchema,
	success: z.boolean(),
	durationMs: z.number().nonnegative(),
	stdoutDigest: sha,
	stderrDigest: sha,
	failures: z.array(sha),
});
export const reportSchema = z.strictObject({
	counts: countsSchema,
	success: z.boolean(),
	files: z.array(fileSchema.omit({ digest: true })).min(1),
});
export const testReceiptSchema = z.strictObject({
	request: requestSchema,
	unionDigest: sha,
	executionNonce: z.string().uuid(),
	platform: z.enum(["linux", "darwin"]),
	node: z.literal("24.21.0"),
	exitCode: integer,
	elapsedMs: integer,
	stdoutDigest: sha,
	stderrDigest: sha,
	files: z.array(fileSchema).min(1),
	counts: countsSchema,
});
export const phaseNames = Object.freeze([
	"build",
	"types",
	"format",
	"workload-tests",
	"chroot",
	"observer",
	"launch-probe",
	"launch-diagnostic",
	"pdf-position",
	"pp16-bundle-handoff",
	"tests",
	"linux-browser",
	"calibration",
	"root-import",
	"runtime-receipt",
]);
export const phaseSchema = z.strictObject({
	name: z.enum(phaseNames),
	exitCode: integer.max(255),
});
export const groupReceiptSchema = z.strictObject({
	tests: testReceiptSchema,
	phases: z.array(phaseSchema).length(phaseNames.length),
});

export function validateGroup(plan, value) {
	const receipt = groupReceiptSchema.parse(value);
	const tests = receipt.tests;
	const expected = selectGroup(plan, tests.request.group);
	assert.equal(tests.unionDigest, plan.unionDigest);
	assert.deepEqual(
		tests.files.map(({ path, digest }) => ({ path, digest })),
		expected.map(({ path, digest }) => ({ path, digest })),
	);
	assert.deepEqual(
		receipt.phases.map((phase) => phase.name),
		phaseNames,
	);
	assert.deepEqual(tests.counts, totals(tests.files));
	assert.ok(tests.files.every((file) => file.counts.tests > 0));
	return receipt;
}

export function aggregateReceipts(plan, request, values) {
	assert.equal(values.length, groups.length);
	const receipts = values.map((value) => validateGroup(plan, value));
	assert.deepEqual(
		receipts.map((value) => value.tests.request.group).sort(),
		[...groups].sort(),
	);
	assert.equal(
		new Set(receipts.map((value) => value.tests.executionNonce)).size,
		groups.length,
	);
	for (const { tests } of receipts) {
		for (const key of ["revision", "runId", "attempt"])
			assert.equal(tests.request[key], request[key]);
		assert.equal(tests.platform, "linux");
	}
	const files = receipts
		.flatMap((value) => value.tests.files)
		.sort((a, b) => a.path.localeCompare(b.path, "en"));
	assert.deepEqual(
		files.map(({ path, digest }) => ({ path, digest })),
		plan.files.map(({ path, digest }) => ({ path, digest })),
	);
	const counts = totals(files);
	assert.ok(counts.tests >= 492, "Frozen test count cannot shrink.");
	return {
		request,
		unionDigest: plan.unionDigest,
		counts,
		files,
		passed: receipts.every(
			({ tests, phases }) =>
				tests.exitCode === 0 &&
				phases.every((phase) => phase.exitCode === 0) &&
				tests.files.every(
					(file) => file.success && completeCounts(file.counts),
				) &&
				completeCounts(tests.counts),
		),
	};
}
