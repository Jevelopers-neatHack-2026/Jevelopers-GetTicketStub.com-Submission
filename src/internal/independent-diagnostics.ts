import { z } from "zod";
import { hash } from "./durability.js";
import { VerificationFailure } from "../runtime/errors.js";

export const independentCounts = (stdout: string) =>
	Object.fromEntries(
		["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => {
			const raw = stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1];
			return [name, raw === undefined ? null : Number(raw)];
		}),
	);
export const diagnosticSchema = z
	.object({
		version: z.literal(1),
		executionNonce: z.string().uuid(),
		reason: z.enum([
			"child-exit",
			"timeout",
			"buffer-limit",
			"counts",
			"artifact-missing",
			"artifact-json",
			"artifact-schema",
			"unexpected",
		]),
		exitCode: z.number().int().nullable(),
		signal: z.enum(["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"]).nullable(),
		expectedTests: z.number().int().nullable(),
		counts: z.record(z.string(), z.number().int().nullable()),
		stdoutDigest: z.string(),
		stderrDigest: z.string(),
		failures: z
			.array(z.object({ ordinal: z.number().int(), nameDigest: z.string() }))
			.max(64),
		artifactIndex: z.number().int().nullable(),
		artifactNameDigest: z.string().nullable(),
	})
	.strict()
	.readonly();
export type IndependentDiagnostic = z.infer<typeof diagnosticSchema>;
export class IndependentTestFailure extends VerificationFailure {
	constructor(readonly diagnostic: IndependentDiagnostic) {
		super(
			"RUNTIME_FAILURE",
			"Independent private test failure; finite diagnostic recorded.",
		);
	}
}
export function childDiagnostic(value: unknown) {
	const parsed = z
		.object({
			code: z.union([z.string(), z.number()]).optional(),
			signal: z.string().nullable().optional(),
			killed: z.boolean().optional(),
			stdout: z.string().optional(),
			stderr: z.string().optional(),
		})
		.safeParse(value);
	const fields = parsed.success ? parsed.data : {};
	const signal = z
		.enum(["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"])
		.nullable()
		.catch(null)
		.parse(fields.signal ?? null);
	return {
		reason:
			fields.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
				? ("buffer-limit" as const)
				: fields.killed
					? ("timeout" as const)
					: typeof fields.code === "number"
						? ("child-exit" as const)
						: ("unexpected" as const),
		exitCode: typeof fields.code === "number" ? fields.code : null,
		signal,
		stdout: fields.stdout ?? "",
		stderr: fields.stderr ?? "",
	};
}
export function tapFailures(stdout: string) {
	return [...stdout.matchAll(/^not ok (\d+) - ([^\n]*)$/gm)]
		.slice(0, 64)
		.map((m) => ({ ordinal: Number(m[1]), nameDigest: hash(m[2] ?? "") }));
}
