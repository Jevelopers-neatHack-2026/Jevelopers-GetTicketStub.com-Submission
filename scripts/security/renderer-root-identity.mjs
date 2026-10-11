import { requireCheck } from "../../dist/src/runtime/errors.js";

export function parseRendererGeneration(value) {
	const pid = /^([1-9]\d*) \(/.exec(value)?.[1];
	const close = value.lastIndexOf(")");
	const fields =
		close >= 0
			? value
					.slice(close + 1)
					.trim()
					.split(/\s+/)
			: [];
	requireCheck(
		pid !== undefined &&
			["R", "S"].includes(fields[0]) &&
			/^[1-9]\d*$/.test(fields[19] ?? ""),
		"SANDBOX_POLICY_FAILURE",
		"Renderer process generation is stale or unavailable.",
	);
	return { pid, startTime: fields[19] };
}

export function requireStableRendererGeneration(before, after) {
	requireCheck(
		before.pid === after.pid && before.startTime === after.startTime,
		"SANDBOX_POLICY_FAILURE",
		"Renderer process generation changed during root observation.",
	);
}

export function requireStableRoot(before, after) {
	requireCheck(
		before.dev === after.dev && before.ino === after.ino,
		"SANDBOX_POLICY_FAILURE",
		"Renderer filesystem root changed during observation.",
	);
}

export function classifyFdinfoDirectoryError(error) {
	const code =
		error instanceof Error && "code" in error ? error.code : undefined;
	if (code === "ESRCH") return "FDINFO_OWNER_GONE_ESRCH";
	if (code === "ENOENT") return "FDINFO_OWNER_GONE_ENOENT";
	if (code === "EACCES" || code === "EPERM") return "ACCESS_DENIED";
	return "UNKNOWN_FAILURE";
}
