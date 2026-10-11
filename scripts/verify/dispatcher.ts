import { z } from "zod";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	runIndependentTests,
	durabilityTestFiles,
	durabilityProcessEvidence,
	durabilityExpectedTests,
} from "../../src/internal/independent-tests.js";
import { verifyRuntime } from "../../src/runtime/calibration.js";
import {
	failureReceipt,
	VerificationFailure,
} from "../../src/runtime/errors.js";

export const suiteNames = [
	"runtime",
	"api-contracts",
	"templates",
	"composition",
	"typography",
	"approved-assets",
	"artifact-storage",
	"preflight",
	"bounded-repair",
	"personalization",
	"csv-personalization",
	"exporters",
	"manifests",
	"restart-recovery",
	"metering-traces",
	"integration-production",
	"release",
] as const;
export type SuiteName = (typeof suiteNames)[number];
export const suiteRegistry = {
	runtime: { state: "implemented", dependency: "PP-01A local calibration" },
	"api-contracts": {
		state: "unimplemented",
		dependency:
			"PP-01B canonical shared-contracts package and immutable commit pin",
	},
	templates: {
		state: "unimplemented",
		dependency:
			"Accepted supplier specification and versioned template implementation",
	},
	composition: {
		state: "unimplemented",
		dependency: "Production composition implementation",
	},
	typography: {
		state: "unimplemented",
		dependency: "Production typography profiles; calibration is corpus-limited",
	},
	"approved-assets": {
		state: "unimplemented",
		dependency: "External approval contract and immutable asset implementation",
	},
	"artifact-storage": {
		state: "external-blocked",
		dependency:
			"PP-10A private adapter tested; accepted canonical request/hash/scope adapter and app access fixtures absent",
	},
	preflight: {
		state: "unimplemented",
		dependency: "Supplier-bound production preflight implementation",
	},
	"bounded-repair": {
		state: "unimplemented",
		dependency: "Production bounded repair implementation",
	},
	personalization: {
		state: "unimplemented",
		dependency: "Canonical personalization contract and implementation",
	},
	"csv-personalization": {
		state: "unimplemented",
		dependency: "CSV batch personalization implementation",
	},
	exporters: {
		state: "unimplemented",
		dependency: "Supplier-bound production exporters; calibration is synthetic",
	},
	manifests: {
		state: "unimplemented",
		dependency: "Production manifests implementation",
	},
	"restart-recovery": {
		state: "external-blocked",
		dependency:
			"PP-10B private recovery tested; canonical job/row semantics, structured personalization and ProductionBundle ports absent",
	},
	"metering-traces": {
		state: "external-blocked",
		dependency:
			"PP-11 private staged observations tested; accepted UsageEvent/EvaluationEvidence, real finance intake and Neatlogs ports absent",
	},
	"integration-production": {
		state: "unimplemented",
		dependency:
			"Canonical consumer/supplier/finance pins and real integration implementation",
	},
	release: {
		state: "aggregate",
		dependency: "Every registered leaf and verified immutable external pins",
	},
} as const satisfies Record<
	SuiteName,
	{
		readonly state:
			| "implemented"
			| "unimplemented"
			| "aggregate"
			| "external-blocked";
		readonly dependency: string;
	}
>;

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
	if (suiteRegistry[suite].state === "external-blocked") {
		const localSuite = z
			.enum(["artifact-storage", "restart-recovery", "metering-traces"])
			.parse(suite);
		const evidence = join(evidenceDir, suite, "local");
		await mkdir(evidence, { recursive: true });
		const localReceipt = join(evidenceDir, `${suite}-local.json`);
		await rm(localReceipt, { force: true });
		const paths = [
			...durabilityTestFiles[localSuite],
			"fixtures/durability/canary.js",
		].map((file) =>
			fileURLToPath(new URL(`../../tests/${file}`, import.meta.url)),
		);
		try {
			const result = await runIndependentTests({
				paths,
				evidenceDir: evidence,
				expectedTests: durabilityExpectedTests[localSuite] + 1,
				requiredEvidence: [
					...durabilityProcessEvidence,
					"canary-executed.json",
				],
			});
			await writeFile(
				localReceipt,
				JSON.stringify(
					{
						state: "passed-private-mechanisms",
						...result,
						externalState: "external-blocked",
					},
					null,
					2,
				),
			);
		} catch (error) {
			if (error instanceof Error) {
				await writeFile(
					localReceipt,
					JSON.stringify(
						{
							state: "failed-private-mechanisms",
							externalState: "external-blocked",
							code: "RUNTIME_FAILURE",
						},
						null,
						2,
					),
				);
				throw new VerificationFailure(
					"RUNTIME_FAILURE",
					"Private durability checks failed; external integration remains blocked.",
				);
			}
			throw error;
		}
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
			// External contract/supplier/consumer pins do not exist yet. No fabricated integration receipt.
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
