import {
	validateContract,
	validatePrimitive,
	canonicalJson,
	hashManifest,
	hashBytes,
} from "@jevelopers/shared-contracts";
import type {
	ContractMap,
	ContractName,
	Sha256,
} from "@jevelopers/shared-contracts";
import { validateProductionReference } from "@jevelopers/shared-contracts/production-operations";
import type {
	ProductionCheck,
	ProductionReferenceValue,
	ProductionError,
} from "@jevelopers/shared-contracts/production-operations";

export const version = {
	schema_version: "1.0.0",
	policy_version: "1.0.0",
} as const;
export class CandidateFailure extends Error {
	override readonly name = "CandidateFailure";
	constructor(
		readonly code: ProductionError["code"],
		readonly condition: ProductionError["blocking_condition"] = "input",
	) {
		super(code);
	}
}
export function requireCandidate(
	value: boolean,
	code: ProductionError["code"],
	condition: ProductionError["blocking_condition"] = "input",
): asserts value {
	if (!value) throw new CandidateFailure(code, condition);
}
export function checked<T>(
	result: ProductionCheck<T>,
	fallback: ProductionError["code"] = "INVALID_INPUT",
): T {
	if (result.ok) return result.value;
	const code = result.errors[0]?.code;
	switch (code) {
		case "NOT_FOUND":
		case "HASH_MISMATCH":
		case "UNSUPPORTED_VERSION":
		case "APPROVAL_INVALID":
		case "APPROVAL_REVOKED":
		case "APPROVAL_UNAVAILABLE":
		case "ROW_SCHEMA":
		case "ROW_DUPLICATE":
		case "CAPABILITY_DISABLED":
		case "OUTPUT_UNSUPPORTED":
		case "PREFLIGHT_FAILED":
		case "IDEMPOTENCY_CONFLICT":
			throw new CandidateFailure(code);
		default:
			throw new CandidateFailure(fallback);
	}
}
export function contract<K extends ContractName>(
	name: K,
	value: unknown,
): ContractMap[K] {
	return checked(validateContract(name, value));
}
export function sha(value: unknown): Sha256 {
	return checked(validatePrimitive("Sha256", value));
}
export function contentHash(value: unknown): Sha256 {
	return sha(hashManifest(value));
}
export function byteHash(bytes: Uint8Array): Sha256 {
	return sha(hashBytes(bytes));
}
export function jsonBytes(value: unknown): Buffer {
	return Buffer.from(canonicalJson(value));
}
export function same(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}
export function reference(value: unknown): ProductionReferenceValue {
	return checked(validateProductionReference(value));
}

export function unreachable(_value: never): never {
	throw new CandidateFailure("INTEGRITY_FAILURE", "integrity");
}
