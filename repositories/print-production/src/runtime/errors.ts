export const failureCodes = [
	"INVALID_ARGUMENTS",
	"ENVIRONMENT_PIN_MISMATCH",
	"TOOL_PIN_MISMATCH",
	"FONT_PIN_MISMATCH",
	"FONT_UNSUPPORTED",
	"FONT_FALLBACK",
	"BROWSER_PIN_MISMATCH",
	"SANDBOX_POLICY_FAILURE",
	"CONTAINER_POLICY_FAILURE",
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

const launchSignals = [
	{ category: "SANDBOX_UNAVAILABLE", pattern: /(?:^|\] )No usable sandbox!/ },
	{
		category: "NAMESPACE_CREATE_DENIED",
		pattern:
			/Failed to (?:move to new namespace|unshare)[^\n]*Operation not permitted/,
	},
	{
		category: "NAMESPACE_ID_MAP_FAILURE",
		pattern:
			/(?:Check failed:[^\n]*(?:DenySetgroups|WriteToIdMapFile)|(?:uid_map|gid_map)[^\n]*(?:failed|Permission denied|Operation not permitted))/i,
	},
	{
		category: "THREAD_CREATE_DENIED",
		pattern: /pthread_create[^\n]*Operation not permitted/,
	},
	{
		category: "THREAD_RESOURCE_EXHAUSTED",
		pattern: /pthread_create[^\n]*Resource temporarily unavailable/,
	},
	{
		category: "CRASHPAD_DATABASE_REQUIRED",
		pattern: /^chrome_crashpad_handler: --database is required\s*$/,
	},
	{
		category: "CRASHPAD_START_FAILURE",
		pattern:
			/(?:crashpad handler|Crashpad handler)[^\n]*(?:failed|couldn't start)/,
	},
	{
		category: "FILESYSTEM_READ_ONLY",
		pattern:
			/(?:mkdir|open|CreateDirectory|creat|Permission|database)[^\n]*Read-only file system/i,
	},
	{
		category: "FILESYSTEM_ACCESS_DENIED",
		pattern: /(?:mkdir|open|CreateDirectory|creat)[^\n]*Permission denied/i,
	},
	{
		category: "PROFILE_LOCK_FAILURE",
		pattern: /Failed to create a ProcessSingleton for your profile directory/,
	},
	{
		category: "ROOT_USER_FORBIDDEN",
		pattern: /Running as root without --no-sandbox is not supported/,
	},
	{
		category: "ZYGOTE_START_FAILURE",
		pattern:
			/(?:Failed to launch zygote process|Zygote process exited prematurely|Failed to receive (?:boot|hello) message from zygote)/,
	},
	{
		category: "SECCOMP_INSTALL_FAILURE",
		pattern:
			/(?:Failed to (?:install|start|initialize)[^\n]*seccomp|seccomp[^\n]*(?:filter installation failed|Invalid argument|Permission denied))/i,
	},
] as const;

/** Only fixed categories escape this boundary; Chrome stderr and command lines stay private. */
export function classifySandboxLaunchFailure(error: unknown) {
	if (!(error instanceof Error)) return ["UNKNOWN_LAUNCH_FAILURE"] as const;
	const stderr = error.message
		.slice(0, 65536)
		.split("\n")
		.slice(0, 256)
		.flatMap((line) => {
			const body = /^\s*(?:-\s*)?\[pid=\d+\]\[err\] (.{1,2048})$/.exec(
				line,
			)?.[1];
			return body === undefined ? [] : [body];
		});
	const categories = launchSignals
		.filter(({ pattern }) => stderr.some((line) => pattern.test(line)))
		.map(({ category }) => category);
	return categories.length > 0
		? categories
		: (["UNKNOWN_LAUNCH_FAILURE"] as const);
}

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
