import {
	open,
	readFile,
	readlink,
	stat,
	statfs,
	opendir,
} from "node:fs/promises";
import { requireLinuxRendererStatus } from "../../dist/src/exporters/offline-browser.js";
import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";
import { rootCategory } from "./renderer-root-diagnostic.mjs";
import {
	parseRendererGeneration,
	requireStableRendererGeneration,
	requireStableRoot,
	classifyFdinfoDirectoryError,
} from "./renderer-root-identity.mjs";

// Linux UAPI O_PATH | O_DIRECTORY | O_CLOEXEC: metadata anchors, not privileges.
const pathFlags = 0x200000 | 0x10000 | 0x80000;
const descriptorPath = (handle) => `/proc/self/fd/${handle.fd}`;

function namespaceState(status) {
	try {
		requireLinuxRendererStatus(status);
		return "ACCEPTED";
	} catch (error) {
		if (error instanceof VerificationFailure) return "REJECTED_OR_UNAVAILABLE";
		throw error;
	}
}

/** Keep anchors open through final CDP/liveness verification, then close them. */
export async function captureRendererRoot(pid) {
	let processHandle;
	let rootHandle;
	const close = async () => {
		const results = await Promise.allSettled([
			rootHandle?.close(),
			processHandle?.close(),
		]);
		requireCheck(
			results.every((r) => r.status === "fulfilled"),
			"SANDBOX_POLICY_FAILURE",
			"Renderer root observation cleanup failed.",
		);
	};
	try {
		processHandle = await open(`/proc/${pid}`, pathFlags);
		const processPath = descriptorPath(processHandle);
		const before = parseRendererGeneration(
			await readFile(`${processPath}/stat`, "utf8"),
		);
		requireCheck(
			before.pid === String(pid),
			"SANDBOX_POLICY_FAILURE",
			"Renderer process anchor has a different identity.",
		);
		const beforeIsolation = namespaceState(
			await readFile(`${processPath}/status`, "utf8"),
		);
		const shape = rootCategory(await readlink(`${processPath}/root`));
		rootHandle = await open(`${processPath}/root`, pathFlags);
		const rootPath = descriptorPath(rootHandle);
		const initialRoot = await rootHandle.stat({ bigint: true });
		const containerRoot = await stat("/", { bigint: true });
		requireCheck(
			initialRoot.isDirectory(),
			"SANDBOX_POLICY_FAILURE",
			"Renderer root anchor is not a directory.",
		);
		const filesystem =
			(await statfs(rootPath)).type === 0x9fa0 ? "PROCFS" : "NON_PROCFS";
		const identity =
			initialRoot.dev === containerRoot.dev &&
			initialRoot.ino === containerRoot.ino
				? "SAME_CONTAINER_ROOT"
				: "DISTINCT_CONTAINER_ROOT";
		let directoryState;
		try {
			const directory = await opendir(rootPath);
			try {
				directoryState =
					(await directory.read()) === null ? "EMPTY" : "ENTRIES_PRESENT";
			} finally {
				await directory.close();
			}
		} catch (error) {
			directoryState = classifyFdinfoDirectoryError(error);
		}
		const evidence = {
			rootCategory: shape,
			filesystem,
			rootIdentity: identity,
			rootDirectory: directoryState,
		};
		return {
			close,
			verify: async () => {
				try {
					const after = parseRendererGeneration(
						await readFile(`${processPath}/stat`, "utf8"),
					);
					requireStableRendererGeneration(before, after);
					const currentRoot = await stat(`${processPath}/root`, {
						bigint: true,
					});
					requireStableRoot(initialRoot, currentRoot);
					requireStableRoot(
						initialRoot,
						await rootHandle.stat({ bigint: true }),
					);
					const afterShape = rootCategory(
						await readlink(`${processPath}/root`),
					);
					const afterIsolation = namespaceState(
						await readFile(`${processPath}/status`, "utf8"),
					);
					requireStableRendererGeneration(
						before,
						parseRendererGeneration(
							await readFile(`${processPath}/stat`, "utf8"),
						),
					);
					return {
						...evidence,
						rootCategory: afterShape,
						namespaceSeccomp:
							beforeIsolation === "ACCEPTED" && afterIsolation === "ACCEPTED"
								? "ACCEPTED"
								: "REJECTED_OR_UNAVAILABLE",
						processLiveness: "STABLE",
						rootStability: "STABLE",
					};
				} catch (error) {
					if (error instanceof VerificationFailure) throw error;
					throw new VerificationFailure(
						"SANDBOX_POLICY_FAILURE",
						"Renderer process or anchored root became unavailable during observation.",
					);
				}
			},
		};
	} catch (error) {
		await close();
		if (error instanceof VerificationFailure) throw error;
		throw new VerificationFailure(
			"SANDBOX_POLICY_FAILURE",
			"Renderer root anchors could not be observed.",
		);
	}
}
