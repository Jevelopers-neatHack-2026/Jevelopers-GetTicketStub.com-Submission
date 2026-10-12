import { z } from "zod";
import {
	check,
	codes,
	digestSchema,
	hash,
	idSchema,
	scopeKey,
	type Digest,
	type Scope,
} from "../internal/durability.js";
import {
	observationKinds,
	type Observation,
	type ObservationOutbox,
} from "./observations.js";

export const evidencePageSchemaId = "pp.telemetry.staged-observation-page";
export const evidencePageVersion = 1;

type Measurement<U extends string> = {
	readonly unit: U;
	readonly value: number | null;
	readonly completeness: "measured" | "unknown";
};
export type EvidenceObservation = {
	readonly sequence: number;
	readonly observationId: string;
	readonly operationId: string;
	readonly executionAttemptId: string | null;
	readonly jobId: string | null;
	readonly publicationId: string | null;
	readonly kind: Observation["kind"];
	readonly code: Observation["code"];
	readonly recordedAtMs: number;
	readonly stagingVersion: 1;
	readonly environment: "local";
	readonly billingMode: "unclassified";
	readonly producerBuildDigest: null;
	readonly metrics: {
		readonly outputBytes: Measurement<"byte">;
		readonly duration: Measurement<"millisecond">;
		readonly rows: Measurement<"row">;
	};
};
export type EvidencePagePayload = {
	readonly schema: typeof evidencePageSchemaId;
	readonly version: typeof evidencePageVersion;
	readonly provenance: {
		readonly staged: true;
		readonly local: true;
		readonly mapped: false;
		readonly authoritative: false;
		readonly deliveryStatus: "not_included";
		readonly note: string;
	};
	/**
	 * Opaque routing hash of the caller scope. No raw tenant/project is exported,
	 * but it is an ordinary unkeyed SHA-256 that can be guessed: it provides
	 * neither anonymization nor authentication.
	 */
	readonly scopeDigest: string;
	readonly after: number;
	/** Caller-requested page size; null when the outbox default was used. */
	readonly limit: number | null;
	readonly nextCursor: string | null;
	readonly observations: readonly EvidenceObservation[];
};
export type EvidencePage = EvidencePagePayload & {
	readonly integrity: {
		readonly algorithm: "sha256";
		readonly canonicalization: "json-sorted-keys-v1";
		readonly payloadDigest: string;
	};
};

const note =
	"Local staged, unmapped, non-authoritative observations. Delivery status is not included and no delivery claim is made. Not a UsageEvent, ledger, approved receipt or consumer acknowledgement.";
const cursorPattern = /^v1:([a-f0-9]{64}):(0|[1-9][0-9]{0,15})$/;

const measurementSchema = <U extends string>(unit: U) =>
	z
		.object({
			unit: z.literal(unit),
			value: z.number().nullable(),
			completeness: z.enum(["measured", "unknown"]),
		})
		.strict()
		.refine((m) => (m.value === null) === (m.completeness === "unknown"));
const nullableId = idSchema.nullable();
const observationShape = z
	.object({
		sequence: z.number().int().nonnegative(),
		observationId: idSchema,
		operationId: idSchema,
		executionAttemptId: nullableId,
		jobId: nullableId,
		publicationId: nullableId,
		kind: z.enum(observationKinds),
		code: z.enum(codes).nullable(),
		recordedAtMs: z.number().int().nonnegative(),
		stagingVersion: z.literal(1),
		environment: z.literal("local"),
		billingMode: z.literal("unclassified"),
		producerBuildDigest: z.null(),
		metrics: z
			.object({
				outputBytes: measurementSchema("byte"),
				duration: measurementSchema("millisecond"),
				rows: measurementSchema("row"),
			})
			.strict(),
	})
	.strict();
const pageShape = z
	.object({
		schema: z.literal(evidencePageSchemaId),
		version: z.literal(evidencePageVersion),
		provenance: z
			.object({
				staged: z.literal(true),
				local: z.literal(true),
				mapped: z.literal(false),
				authoritative: z.literal(false),
				deliveryStatus: z.literal("not_included"),
				note: z.literal(note),
			})
			.strict(),
		scopeDigest: digestSchema,
		after: z.number().int().nonnegative(),
		limit: z.number().int().positive().nullable(),
		nextCursor: z.string().regex(cursorPattern).nullable(),
		observations: z.array(observationShape),
	})
	.strict();
const integrityShape = z
	.object({
		algorithm: z.literal("sha256"),
		canonicalization: z.literal("json-sorted-keys-v1"),
		payloadDigest: digestSchema,
	})
	.strict();

/**
 * Deterministic JSON: object keys sorted, arrays ordered. Fails closed
 * (INVALID_INPUT) on anything that is not plain JSON data: undefined,
 * functions, symbols, bigints, non-finite numbers, sparse arrays, extra array
 * properties, accessors, symbol keys, non-plain prototypes and cycles.
 */
export function canonicalJson(value: unknown): string {
	return encode(value, new Set());
}
function encode(value: unknown, ancestors: Set<object>): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		check(Number.isFinite(value), "INVALID_INPUT");
		return JSON.stringify(value);
	}
	check(typeof value === "object", "INVALID_INPUT");
	check(!ancestors.has(value), "INVALID_INPUT");
	ancestors.add(value);
	try {
		const keys = Reflect.ownKeys(value);
		for (const key of keys) {
			check(typeof key === "string", "INVALID_INPUT");
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			check(descriptor !== undefined && "value" in descriptor, "INVALID_INPUT");
			check(
				descriptor.enumerable || (Array.isArray(value) && key === "length"),
				"INVALID_INPUT",
			);
		}
		if (Array.isArray(value)) {
			check(Object.getPrototypeOf(value) === Array.prototype, "INVALID_INPUT");
			check(keys.length === value.length + 1, "INVALID_INPUT");
			const items: string[] = [];
			for (let i = 0; i < value.length; i++) {
				check(Object.hasOwn(value, String(i)), "INVALID_INPUT");
				items.push(encode(value[i], ancestors));
			}
			return `[${items.join(",")}]`;
		}
		const proto = Object.getPrototypeOf(value);
		check(proto === Object.prototype || proto === null, "INVALID_INPUT");
		const record = value as Record<string, unknown>;
		return `{${(keys as string[])
			.sort()
			.map((key) => `${JSON.stringify(key)}:${encode(record[key], ancestors)}`)
			.join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}
export function evidencePayloadDigest(payload: EvidencePagePayload): Digest {
	return hash(canonicalJson(payload));
}
/**
 * True when the page has the exact strict envelope shape and its commitment
 * matches the payload. A local integrity check only: it is not authentication
 * or authority, since anyone can recompute an unkeyed digest.
 */
export function verifyEvidencePage(page: EvidencePage): boolean {
	try {
		// Untrusted input: validate the whole graph as plain JSON first (this
		// reads descriptors only), then extract root data descriptors, so no
		// getter at any depth ever runs.
		canonicalJson(page);
		if (typeof page !== "object" || page === null) return false;
		const proto = Object.getPrototypeOf(page);
		if (proto !== Object.prototype && proto !== null) return false;
		// Null prototype: own "__proto__" keys must stay data, not hit the setter.
		const payload: Record<string, unknown> = Object.create(null);
		let integrity: unknown;
		for (const key of Reflect.ownKeys(page)) {
			if (typeof key !== "string") return false;
			const descriptor = Object.getOwnPropertyDescriptor(page, key);
			if (descriptor === undefined || !("value" in descriptor)) return false;
			if (key === "integrity") integrity = descriptor.value;
			else payload[key] = descriptor.value;
		}
		// Strict private envelope: exact key set and fixed metadata, even when a
		// forger recomputes the digest.
		const shaped = pageShape.safeParse(payload);
		const commitment = integrityShape.safeParse(integrity);
		if (!shaped.success || !commitment.success) return false;
		const cursor = shaped.data.nextCursor;
		if (cursor !== null && !cursor.startsWith(`v1:${shaped.data.scopeDigest}:`))
			return false;
		return (
			commitment.data.payloadDigest ===
			evidencePayloadDigest(payload as EvidencePagePayload)
		);
	} catch {
		return false;
	}
}

function measurement<U extends string>(m: Measurement<U>): Measurement<U> {
	return { unit: m.unit, value: m.value, completeness: m.completeness };
}
function project(event: Observation): EvidenceObservation {
	return {
		sequence: event.sequence,
		observationId: event.id,
		operationId: event.operation,
		executionAttemptId: event.attempt,
		jobId: event.job,
		publicationId: event.publication,
		kind: event.kind,
		code: event.code,
		recordedAtMs: event.recorded,
		stagingVersion: event.stagingVersion,
		environment: event.environment,
		billingMode: event.billingMode,
		producerBuildDigest: event.producerBuildDigest,
		metrics: {
			outputBytes: measurement(event.metrics.outputBytes),
			duration: measurement(event.metrics.duration),
			rows: measurement(event.metrics.rows),
		},
	};
}
function after(scopeDigest: Digest, cursor: string | null): number {
	if (cursor === null) return 0;
	const match = cursorPattern.exec(cursor);
	check(match !== null && match[1] === scopeDigest, "INVALID_INPUT");
	const value = Number(match[2]);
	check(Number.isSafeInteger(value), "INVALID_INPUT");
	return value;
}

/**
 * Read-only export adapter over ObservationOutbox.list. It never claims,
 * settles or requeues events and exports no raw tenant/project. Request and
 * row-key digests stay in the private DB: unkeyed hashes would allow
 * dictionary and cross-scope equality disclosure.
 * Callers must authenticate and authorize scope first.
 */
export function readEvidencePage(
	outbox: ObservationOutbox,
	scope: Scope,
	options: { readonly cursor?: string | null; readonly limit?: number } = {},
): EvidencePage {
	const scopeDigest = scopeKey(scope);
	const start = after(scopeDigest, options.cursor ?? null);
	const events =
		options.limit !== undefined
			? outbox.list(scope, start, options.limit)
			: outbox.list(scope, start);
	const observations = events.map((event) => {
		check(event.scope === scopeDigest, "INTEGRITY");
		return project(event);
	});
	const last = observations.at(-1);
	const more =
		last !== undefined && outbox.list(scope, last.sequence, 1).length > 0;
	const payload: EvidencePagePayload = {
		schema: evidencePageSchemaId,
		version: evidencePageVersion,
		provenance: {
			staged: true,
			local: true,
			mapped: false,
			authoritative: false,
			deliveryStatus: "not_included",
			note,
		},
		scopeDigest,
		after: start,
		limit: options.limit ?? null,
		nextCursor: more && last ? `v1:${scopeDigest}:${last.sequence}` : null,
		observations,
	};
	return {
		...payload,
		integrity: {
			algorithm: "sha256",
			canonicalization: "json-sorted-keys-v1",
			payloadDigest: evidencePayloadDigest(payload),
		},
	};
}
