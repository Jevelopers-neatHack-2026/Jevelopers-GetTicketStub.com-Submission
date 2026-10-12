import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyRuntime } from "../../src/runtime/calibration.js";
import {
	failureReceipt,
	VerificationFailure,
} from "../../src/runtime/errors.js";

export {
	suiteNames,
	suiteRegistry,
} from "../../src/exporters/private-suite.js";
import {
	suiteNames,
	suiteRegistry,
	runPrivateSuite,
} from "../../src/exporters/private-suite.js";
import type { SuiteName } from "../../src/exporters/private-suite.js";
export type { SuiteName } from "../../src/exporters/private-suite.js";

const argumentsSchema = z
	.object({
		suite: z.enum(suiteNames),
		mode: z.literal("offline"),
		evidenceDir: z.string().min(1),
	})
	.strict();
export type VerifyArguments = z.infer<typeof argumentsSchema>;

export function parseArguments(argv: readonly string[]): VerifyArguments {
	const options: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (
			!flag ||
			!["--suite", "--mode", "--evidence-dir"].includes(flag) ||
			!value ||
			value.startsWith("--") ||
			flag in options
		) {
			throw new VerificationFailure(
				"INVALID_ARGUMENTS",
				"Use exactly --suite <registered-name> --mode offline --evidence-dir <directory>.",
			);
		}
		options[flag] = value;
	}
	const parsed = argumentsSchema.safeParse({
		suite: options["--suite"],
		mode: options["--mode"],
		evidenceDir: options["--evidence-dir"],
	});
	if (!parsed.success)
		throw new VerificationFailure(
			"INVALID_ARGUMENTS",
			"Suite, offline mode and evidence directory are required; unknown values fail.",
		);
	return parsed.data;
}

async function runLeaf(
	suite: Exclude<SuiteName, "release">,
	evidenceDir: string,
) {
	if (suite === "artifact-storage" || suite === "exporters") {
		const result = await runPrivateSuite(suite, evidenceDir);
		if (!result)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Complete local adapter conformance evidence is required.",
			);
		return result;
	}
	if (suiteRegistry[suite].state === "external-blocked") {
		await runPrivateSuite(suite, evidenceDir);
		throw new VerificationFailure(
			"SUITE_UNIMPLEMENTED",
			suiteRegistry[suite].dependency,
		);
	}
	if (suite !== "runtime")
		throw new VerificationFailure(
			"SUITE_UNIMPLEMENTED",
			suiteRegistry[suite].dependency,
		);
	return verifyRuntime(join(evidenceDir, "runtime"));
}

export async function dispatchVerification(
	args: VerifyArguments,
): Promise<0 | 1> {
	let evidence: object;
	let exitCode: 0 | 1 = 0;
	try {
		if (args.suite === "release") {
			const leaves = suiteNames.filter((name) => name !== "release");
			const results = [];
			for (const leaf of leaves) {
				try {
					results.push({
						suite: leaf,
						status: "passed",
						result: await runLeaf(leaf, args.evidenceDir),
					});
				} catch (error) {
					results.push({
						suite: leaf,
						status: "failed",
						externalState:
							suiteRegistry[leaf].state === "external-blocked"
								? "external-blocked"
								: null,
						failure: failureReceipt(error),
					});
				}
			}
			evidence = {
				schemaVersion: 1,
				suite: args.suite,
				mode: args.mode,
				status: "failed",
				failure: {
					code: "RELEASE_INCOMPLETE",
					message:
						"Mandatory suites and immutable external integration pins are incomplete.",
				},
				externalPins: {
					sharedContracts: null,
					supplierSpecification: null,
					appConsumer: null,
					financeConsumer: null,
				},
				results,
			};
			exitCode = 1;
		} else {
			evidence = {
				schemaVersion: 1,
				suite: args.suite,
				mode: args.mode,
				status: "passed",
				result: await runLeaf(args.suite, args.evidenceDir),
			};
		}
	} catch (error) {
		evidence = {
			schemaVersion: 1,
			suite: args.suite,
			mode: args.mode,
			status: "failed",
			externalState:
				args.suite === "artifact-storage" ||
				args.suite === "exporters" ||
				suiteRegistry[args.suite].state === "external-blocked"
					? "external-blocked"
					: null,
			failure: failureReceipt(error),
		};
		exitCode = 1;
	}
	try {
		await mkdir(args.evidenceDir, { recursive: true });
		await writeFile(
			join(args.evidenceDir, `${args.suite}.json`),
			`${JSON.stringify(evidence, null, 2)}\n`,
		);
	} catch (error) {
		if (error instanceof Error)
			throw new VerificationFailure(
				"EVIDENCE_WRITE_FAILURE",
				"Cannot write verification evidence.",
			);
		throw error;
	}
	return exitCode;
}
