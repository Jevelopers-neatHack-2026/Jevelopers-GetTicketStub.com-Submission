import { promises as fs, constants } from "node:fs";
import type { PathLike, Stats, BigIntStats, StatOptions } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";

// Test-only IPC barrier: the parent performs the real filesystem mutation before
// the original filesystem operation resumes. No timing assumption is involved.
const boundary = process.env["OWNER_RACE_BOUNDARY"];
const root = process.env["OWNER_RACE_ROOT"];
let fired = false;
async function barrier(path: string) {
	fired = true;
	await new Promise<void>((resolve, reject) => {
		process.once("message", (message: unknown) => {
			if (message === "resume") resolve();
			else reject(new Error("Unexpected race barrier response"));
		});
		if (!process.send) reject(new Error("Race hook requires IPC"));
		else process.send({ boundary, path });
	});
}
const originalUnlink = fs.unlink;
let unlinks = 0;
fs.unlink = async (path) => {
	const name = String(path);
	if (
		!fired &&
		(dirname(name) === root || dirname(name) === ".") &&
		basename(name) !== ".cleanup-lock"
	) {
		unlinks++;
		if (boundary === "cleanup-interrupted" && unlinks === 1)
			process.kill(process.pid, "SIGKILL");
		if (
			(boundary === "unlink" && unlinks === 1) ||
			(boundary === "second-unlink" && unlinks === 2)
		) {
			await barrier(name);
			if (process.env["OWNER_RACE_FAIL"] === "1")
				throw Object.assign(new Error("Injected unlink failure"), {
					code: "EIO",
				});
		}
	}
	return originalUnlink(path);
};
const originalLstat = fs.lstat;
let rootStats = 0;
function raceLstat(
	path: PathLike,
	opts?: StatOptions & { bigint?: false | undefined },
): Promise<Stats>;
function raceLstat(
	path: PathLike,
	opts: StatOptions & { bigint: true },
): Promise<BigIntStats>;
function raceLstat(
	path: PathLike,
	opts?: StatOptions,
): Promise<Stats | BigIntStats>;
async function raceLstat(
	path: PathLike,
	opts?: StatOptions,
): Promise<Stats | BigIntStats> {
	const result = await originalLstat(path, opts);
	if (String(path) === root) {
		rootStats++;
		if (!fired && boundary === "bind" && rootStats === 2)
			await barrier(String(path));
	}
	return result;
}
fs.lstat = raceLstat;
const originalOpen = fs.open;
fs.open = async (...args) => {
	if (
		basename(String(args[0])) === "owner.json" &&
		typeof args[1] === "number" &&
		(args[1] & constants.O_CREAT) !== 0
	) {
		if (boundary === "marker-before") process.kill(process.pid, "SIGKILL");
		const file = await originalOpen(...args);
		if (boundary === "marker-during") process.kill(process.pid, "SIGKILL");
		return file;
	}
	return originalOpen(...args);
};
syncBuiltinESMExports();
