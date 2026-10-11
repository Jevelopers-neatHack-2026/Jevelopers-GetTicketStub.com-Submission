import { readlink, stat, statfs, opendir, readFile } from "node:fs/promises";
import { requireLinuxRendererStatus } from "../../dist/src/exporters/offline-browser.js";

export function rootCategory(root) {
	if (typeof root !== "string" || root.length > 4096) return "UNAVAILABLE";
	if (root === "/") return "CONTAINER_ROOT_PATH";
	if (/^\/proc\/[1-9]\d*\/fdinfo\/? \(deleted\)$/.test(root))
		return "PROC_FDINFO_DELETED";
	if (/^\/proc\/[1-9]\d*\/fdinfo\/?$/.test(root)) return "PROC_FDINFO_LINKED";
	return root.endsWith(" (deleted)") ? "OTHER_DELETED_ROOT" : "OTHER_ROOT";
}

function errorCategory(error) {
	const code =
		error instanceof Error && "code" in error ? error.code : undefined;
	if (code === "ENOENT" || code === "ESRCH") return "TASK_OR_ROOT_GONE";
	if (code === "EACCES" || code === "EPERM") return "ACCESS_DENIED";
	return "UNKNOWN_FAILURE";
}

export async function observeRootDiagnostic(pid, targetPid) {
	const path = `/proc/${pid}/root`;
	let category = "UNAVAILABLE";
	try {
		category = rootCategory(await readlink(path));
	} catch (error) {
		category = errorCategory(error);
	}
	let filesystem = "UNAVAILABLE";
	try {
		filesystem = (await statfs(path)).type === 0x9fa0 ? "PROCFS" : "NON_PROCFS";
	} catch (error) {
		filesystem = errorCategory(error);
	}
	let identity = "UNAVAILABLE";
	try {
		const [root, container] = await Promise.all([
			stat(path, { bigint: true }),
			stat("/", { bigint: true }),
		]);
		identity =
			root.dev === container.dev && root.ino === container.ino
				? "SAME_CONTAINER_ROOT"
				: "DISTINCT_CONTAINER_ROOT";
	} catch (error) {
		identity = errorCategory(error);
	}
	let directoryState = "UNAVAILABLE";
	try {
		const directory = await opendir(path);
		try {
			directoryState =
				(await directory.read()) === null ? "EMPTY" : "ENTRIES_PRESENT";
		} finally {
			await directory.close();
		}
	} catch (error) {
		directoryState = errorCategory(error);
	}
	let isolation = "UNAVAILABLE";
	try {
		requireLinuxRendererStatus(await readFile(`/proc/${pid}/status`, "utf8"));
		isolation = "ACCEPTED";
	} catch (error) {
		isolation = "REJECTED_OR_UNAVAILABLE";
	}
	return {
		relevance: pid === targetPid ? "TARGET_PAGE_RENDERER" : "OTHER_RENDERER",
		rootCategory: category,
		filesystem,
		rootIdentity: identity,
		rootDirectory: directoryState,
		namespaceSeccomp: isolation,
	};
}
