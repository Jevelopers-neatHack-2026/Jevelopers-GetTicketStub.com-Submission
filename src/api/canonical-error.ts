import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hashManifest } from "@jevelopers/shared-contracts";
import { createProductionError } from "@jevelopers/shared-contracts/production-operations";
import type {
	ProductionError,
	ProductionRequestMap,
	ProductionOperation,
} from "@jevelopers/shared-contracts/production-operations";
import { CompositionError } from "../composition/primitives.js";
import { DurabilityError } from "../internal/durability.js";
import { OutputError } from "../exporters/private-policy.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import {
	CandidateFailure,
	unreachable,
	checked,
	contract,
	sha,
	version,
} from "./canonical-values.js";
export function productionFailure(
	runtime: Pick<CandidateRuntime, "context" | "state">,
	input: {
		readonly operation: ProductionOperation;
		readonly correlation_id: ProductionRequestMap[ProductionOperation]["correlation_id"];
		readonly code: ProductionError["code"];
		readonly blocking_condition?: ProductionError["blocking_condition"];
		readonly side_effects?: ProductionError["side_effects"];
		readonly usage_state?: ProductionError["usage_state"];
		readonly row_id?: string;
	},
): ProductionError {
	let diagnostic: ProductionError["diagnostic_ref"] = {
		state: "unavailable",
		...runtime.context.scope,
		correlation_id: input.correlation_id,
		reason_code: "STORAGE_UNAVAILABLE",
	};
	try {
		const initial = contract("ProductionDiagnostic", {
			contract: "ProductionDiagnostic",
			...version,
			...runtime.context.scope,
			id: randomUUID(),
			revision: 1,
			content_hash: `sha256:${"0".repeat(64)}`,
			operation: input.operation,
			reason_codes: [],
		});
		const record = {
			...initial,
			content_hash: sha(
				hashManifest(
					Object.fromEntries(
						Object.entries(initial).filter(([key]) => key !== "content_hash"),
					),
				),
			),
		};
		runtime.state.put(`diagnostic:${record.id}`, record);
		diagnostic = {
			state: "persisted",
			...runtime.context.scope,
			reference: {
				contract: "ProductionDiagnostic",
				schema_version: "1.0.0",
				id: record.id,
				revision: 1,
				content_hash: record.content_hash,
			},
		};
	} catch {
		// Diagnostic persistence is a public containment boundary; retain unavailable.
	}
	return checked(
		createProductionError(input.code, {
			...input,
			scope: runtime.context.scope,
			diagnostic_ref: diagnostic,
		}),
	);
}

export function classify(error: unknown): CandidateFailure {
	if (error instanceof CandidateFailure) return error;
	if (error instanceof DurabilityError) {
		switch (error.code) {
			case "IDEMPOTENCY_CONFLICT":
				return new CandidateFailure("IDEMPOTENCY_CONFLICT", "conflict");
			case "NOT_FOUND":
				return new CandidateFailure("NOT_FOUND", "access");
			case "STORAGE":
				return new CandidateFailure("RETRYABLE_STORAGE_FAILURE", "storage");
			case "CANCELLED":
				return new CandidateFailure("CANCELLED", "cancelled");
			case "INVALID_INPUT":
				return new CandidateFailure("INVALID_INPUT", "input");
			case "UNSUPPORTED_VERSION":
				return new CandidateFailure("UNSUPPORTED_VERSION", "version");
			case "RENDER_RETRYABLE":
			case "INTERRUPTED":
				return new CandidateFailure("RETRYABLE_RENDER_FAILURE", "render");
			case "STALE_CLAIM":
			case "WRITE_ONCE":
				return new CandidateFailure("IDEMPOTENCY_CONFLICT", "conflict");
			case "INTEGRITY":
			case "LIMIT":
			case "RENDER_PERMANENT":
				return new CandidateFailure("INTEGRITY_FAILURE", "integrity");
			default:
				return unreachable(error.code);
		}
	}
	if (error instanceof CompositionError) {
		switch (error.code) {
			case "PERMISSION_BLOCKED":
				return new CandidateFailure("APPROVAL_INVALID", "approval");
			case "ASSET_MISSING":
				return new CandidateFailure("ASSET_MISSING", "asset");
			case "ASSET_HASH":
				return new CandidateFailure("HASH_MISMATCH", "asset");
			case "INVALID_INPUT":
			case "INVALID_GEOMETRY":
			case "REVISION_CONFLICT":
			case "ASSET_LIMIT":
			case "ASSET_UNSAFE":
			case "ASSET_UNSUPPORTED":
			case "FONT_INVALID":
			case "RENDER_INTEGRITY":
				return new CandidateFailure("PREFLIGHT_FAILED", "preflight");
			default:
				return unreachable(error.code);
		}
	}
	if (error instanceof OutputError)
		return new CandidateFailure(
			error.code === "OUTPUT_UNSUPPORTED"
				? "OUTPUT_UNSUPPORTED"
				: "PREFLIGHT_FAILED",
			"output",
		);
	if (error instanceof z.ZodError) return new CandidateFailure("INVALID_INPUT");
	return new CandidateFailure("INTEGRITY_FAILURE", "integrity");
}
