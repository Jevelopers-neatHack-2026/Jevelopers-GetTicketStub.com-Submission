export const failureCodes = [
	"INVALID_ARGUMENTS",
	"ENVIRONMENT_PIN_MISMATCH",
	"TOOL_PIN_MISMATCH",
	"FONT_PIN_MISMATCH",
	"FONT_UNSUPPORTED",
	"FONT_FALLBACK",
	"BROWSER_PIN_MISMATCH",
	"NETWORK_POLICY_FAILURE",
	"CALIBRATION_FAILURE",
	"DIMENSION_MISMATCH",
	"CONTENT_MISMATCH",
	"DETERMINISM_FAILURE",
	"SUITE_UNIMPLEMENTED",
	"RELEASE_INCOMPLETE",
	"EVIDENCE_WRITE_FAILURE",
	"RUNTIME_FAILURE",
] as const;
export type FailureCode = (typeof failureCodes)[number];

export class VerificationFailure extends Error {
	override readonly name = "VerificationFailure";
	constructor(
		readonly code: FailureCode,
		message: string,
	) {
		super(message);
	}
}

export function requireCheck(
	condition: boolean,
	code: FailureCode,
	message: string,
): asserts condition {
	if (!condition) throw new VerificationFailure(code, message);
}

export function failureReceipt(error: unknown): {
	readonly code: FailureCode;
	readonly message: string;
} {
	if (error instanceof VerificationFailure)
		return { code: error.code, message: error.message };
	// Third-party errors can contain file paths, SVG text, URLs or credentials.
	return {
		code: "RUNTIME_FAILURE",
		message: "Runtime operation failed; no unsanitized exception was recorded.",
	};
}
