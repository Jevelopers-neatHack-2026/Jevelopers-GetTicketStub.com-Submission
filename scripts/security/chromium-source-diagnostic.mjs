import catalog from "./chromium-launch-sources.json" with { type: "json" };

// Keys are immutable upstream paths/basenames, never arbitrary error filenames.
const sources = new Map();
for (const source of catalog.sources) {
	sources.set(source.path, source);
	const basename = source.path.split("/").at(-1);
	if (sources.has(basename)) sources.set(basename, undefined);
	else sources.set(basename, source);
}

// Exact RAW_LOG/RAW_CHECK strings in pinned launch_posix/namespace/credentials code.
const rawCauses = new Map([
	["LaunchProcess: failed to execvp:", "PREEXEC_EXECVP_FAILURE"],
	["Failed to open /dev/null", "PREEXEC_STDIN_OPEN_FAILURE"],
	["Failed to dup /dev/null for stdin", "PREEXEC_STDIN_DUP_FAILURE"],
	["setpgid failed", "PREEXEC_PROCESS_GROUP_FAILURE"],
	["prctl(PR_SET_PDEATHSIG) failed", "PREEXEC_PARENT_DEATH_SIGNAL_FAILURE"],
	[
		"Check failed: NamespaceUtils::DenySetgroups()",
		"NAMESPACE_SETGROUPS_DENY_FAILURE",
	],
	[
		'Check failed: NamespaceUtils::WriteToIdMapFile("/proc/self/uid_map", uid_)',
		"NAMESPACE_UID_MAP_FAILURE",
	],
	[
		'Check failed: NamespaceUtils::WriteToIdMapFile("/proc/self/gid_map", gid_)',
		"NAMESPACE_GID_MAP_FAILURE",
	],
	[
		'Check failed: sys_chroot("/proc/self/fdinfo/") == 0',
		"SANDBOX_CHROOT_CHECK_FAILURE",
	],
]);

function sourceCause(source, body) {
	if (source.path !== "content/browser/zygote_host/zygote_host_impl_linux.cc")
		return "UNKNOWN_CAUSE";
	const exited =
		/^Zygote process exited prematurely with exit code (-1|\d{1,3})$/.exec(
			body,
		);
	if (!exited) return "UNKNOWN_CAUSE";
	switch (exited[1]) {
		case "-1":
			return "ZYGOTE_CHILD_TERMINATED_BY_SIGNAL";
		case "1":
			return "ZYGOTE_CHILD_EXIT_1";
		case "127":
			return "ZYGOTE_CHILD_EXIT_127";
		default:
			return "ZYGOTE_CHILD_EXIT_OTHER";
	}
}

export function summarizeChromiumSources(chrome) {
	const sourceSites = [];
	const startupCauses = new Set();
	let unvalidatedSevereLine = false;
	for (const body of chrome.slice(0, 256)) {
		if (body.length > 2048) continue;
		const rawCause = rawCauses.get(body);
		if (rawCause) startupCauses.add(rawCause);
		const header =
			/^\[\d+:\d+:[^\]\n]{1,64}:(ERROR|FATAL):([a-zA-Z0-9_./-]{1,240}):([1-9]\d{0,4})\] (.{1,1900})$/.exec(
				body,
			);
		if (!header) {
			unvalidatedSevereLine ||= /:(?:ERROR|FATAL):/.test(body);
			continue;
		}
		const token = header[2].replace(/^(?:\.\.\/){1,8}/, "");
		const source = sources.get(token);
		const line = Number(header[3]);
		if (!source || line > source.lines) {
			unvalidatedSevereLine = true;
			continue;
		}
		const site = {
			basename: source.path.split("/").at(-1),
			line,
			severity: header[1],
			cause: sourceCause(source, header[4]),
		};
		if (
			!sourceSites.some(
				(value) => JSON.stringify(value) === JSON.stringify(site),
			)
		)
			sourceSites.push(site);
	}
	return {
		sourceProvenance: "PINNED_CHROMIUM_SOURCE_CATALOG",
		sourceSites,
		startupCauses: [...startupCauses],
		unvalidatedSevereLine,
	};
}
