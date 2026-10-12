import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const evidenceDirectory = "out/evidence/local-validation";
const npmCli = resolve(
	dirname(process.execPath),
	"../lib/node_modules/npm/bin/npm-cli.js",
);
const environment = {
	...process.env,
	TZ: "UTC",
	LANG: "C.UTF-8",
	LC_ALL: "C.UTF-8",
};
const steps = [
	{ args: ["ci"], expected: 0 },
	{ args: ["run", "build"], expected: 0 },
	{ args: ["run", "typecheck"], expected: 0 },
	{ args: ["run", "format:check"], expected: 0 },
	{ args: ["test"], expected: 0 },
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"runtime",
			"--mode",
			"offline",
			"--evidence-dir",
			`${evidenceDirectory}/calibration-a`,
		],
		expected: 0,
	},
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"runtime",
			"--mode",
			"offline",
			"--evidence-dir",
			`${evidenceDirectory}/calibration-b`,
		],
		expected: 0,
	},
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"release",
			"--mode",
			"offline",
			"--evidence-dir",
			`${evidenceDirectory}/release`,
		],
		expected: 1,
	},
	{ args: ["run", "verify"], expected: 1 },
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"unknown",
			"--mode",
			"offline",
			"--evidence-dir",
			`${evidenceDirectory}/unknown`,
		],
		expected: 1,
	},
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"runtime",
			"--mode",
			"online",
			"--evidence-dir",
			`${evidenceDirectory}/online`,
		],
		expected: 1,
	},
	{
		args: [
			"run",
			"verify",
			"--",
			"--suite",
			"runtime",
			"--mode",
			"offline",
			"--evidence-dir",
			`${evidenceDirectory}/timezone`,
		],
		expected: 1,
		env: { TZ: "Pacific/Honolulu" },
	},
];
await mkdir(evidenceDirectory, { recursive: true });
const receipts = [];
for (const [index, step] of steps.entries()) {
	const result = spawnSync(process.execPath, [npmCli, ...step.args], {
		env: { ...environment, ...step.env },
		encoding: "utf8",
		maxBuffer: 4 * 1024 * 1024,
	});
	const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
		.replaceAll(process.cwd(), "$WORKTREE")
		.replaceAll(resolve(dirname(process.execPath), ".."), "$NODE_BUNDLE");
	const log = `command-${index + 1}.log`;
	await writeFile(join(evidenceDirectory, log), output);
	receipts.push({
		command: ["npm", ...step.args],
		environmentOverrides: step.env ?? {},
		exitCode: result.status,
		expectedExitCode: step.expected,
		signal: result.signal,
		log,
	});
	console.log(JSON.stringify(receipts.at(-1)));
	if (result.status !== step.expected) break;
}
const passed =
	receipts.length === steps.length &&
	receipts.every((item) => item.exitCode === item.expectedExitCode);
await writeFile(
	join(evidenceDirectory, "commands.json"),
	`${JSON.stringify({ schemaVersion: 1, node: process.versions.node, environment: { TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, status: passed ? "passed" : "failed", receipts }, null, 2)}\n`,
);
process.exitCode = passed ? 0 : 1;
