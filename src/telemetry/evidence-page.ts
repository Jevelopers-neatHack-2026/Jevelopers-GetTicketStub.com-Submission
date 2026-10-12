import {
	check,
	hash,
	scopeKey,
	type Digest,
	type Scope,
} from "../internal/durability.js";
import type { Observation, ObservationOutbox } from "./observations.js";

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
	readonly rowKeyDigest: string | null;
	readonly publicationId: string | null;
	readonly requestDigest: string;
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
	/** Opaque caller-scope digest; tenant/project are not derivable from it. */
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
/** True when the commitment matches the exact payload fields of the page. */
export function verifyEvidencePage(page: EvidencePage): boolean {
	try {
		const { integrity, ...payload } = page;
		return (
			integrity.algorithm === "sha256" &&
			integrity.canonicalization === "json-sorted-keys-v1" &&
			integrity.payloadDigest === evidencePayloadDigest(payload)
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
		rowKeyDigest: event.row,
		publicationId: event.publication,
		requestDigest: event.request,
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
 * settles or requeues events and cannot infer tenant/project from the digest.
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
