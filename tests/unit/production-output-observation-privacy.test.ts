import { test } from "node:test";
import assert from "node:assert/strict";
import { assertObservationPrivacy } from "../fixtures/production-output/observation-privacy.js";

const uuid = "00070000-1234-4234-8234-123456789abc";
const sha = "8535f72d2b349499120d37d43e01df522ea40007ede3bd9ee4f671baf0341e9b";
const event = {
	sequence: 1,
	id: uuid,
	operation: uuid,
	attempt: uuid,
	publication: uuid,
	kind: "succeeded",
	code: null,
	bytes: 7,
	duration_ms: 0,
	recorded: 1000,
	scope: sha,
	request: sha,
	job: uuid,
	row: sha,
	row_count: 1,
	stagingVersion: 1,
	environment: "local",
	billingMode: "unclassified",
	producerBuildDigest: null,
	metrics: {
		outputBytes: { unit: "byte", value: 7, completeness: "measured" },
		duration: { unit: "millisecond", value: 0, completeness: "measured" },
		rows: { unit: "row", value: 1, completeness: "measured" },
	},
} as const;

test("accepts valid opaque UUID and digest substrings without inventing seat leakage", () => {
	assert.equal(JSON.stringify(event).includes("0007"), true);
	assert.doesNotThrow(() => assertObservationPrivacy([event]));
});
test("rejects raw attendee seat and extra text fields in private observations", () => {
	for (const leaked of [
		{ ...event, attendee: "Zoë" },
		{ ...event, seat: "0007" },
		{ ...event, text: "Seat 0007" },
		{ ...event, payload: { name: "Zoë", seat: "0007" } },
		{ ...event, id: "Zoë" },
		{ ...event, request: "0007" },
		{ ...event, kind: "Zoë" },
		{ ...event, code: "0007" },
		{
			...event,
			metrics: {
				...event.metrics,
				rows: { ...event.metrics.rows, text: "Zoë 0007" },
			},
		},
		{
			...event,
			metrics: {
				...event.metrics,
				outputBytes: { ...event.metrics.outputBytes, value: "0007" },
			},
		},
	])
		assert.throws(() => assertObservationPrivacy([leaked]));
});
test("rejects malformed identities modes units metrics and empty observation envelopes", () => {
	for (const invalid of [
		[],
		[{ ...event, request: "a".repeat(63) }],
		[{ ...event, id: "not-a-uuid" }],
		[{ ...event, environment: "production" }],
		[{ ...event, producerBuildDigest: sha }],
		[
			{
				...event,
				metrics: {
					...event.metrics,
					rows: { unit: "byte", value: 1, completeness: "measured" },
				},
			},
		],
		[
			{
				...event,
				metrics: {
					...event.metrics,
					rows: { unit: "row", value: 2, completeness: "measured" },
				},
			},
		],
		[
			{
				...event,
				metrics: {
					...event.metrics,
					rows: { unit: "row", value: 1, completeness: "unknown" },
				},
			},
		],
	])
		assert.throws(() => assertObservationPrivacy(invalid));
});
