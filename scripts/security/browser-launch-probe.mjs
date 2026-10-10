import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifySandboxLaunchFailure } from "../../dist/src/runtime/errors.js";
import { summarizeChromiumSources } from "./chromium-source-diagnostic.mjs";

const sourceNames = {
	"zygote_host_impl_linux.cc": "ZYGOTE_HOST",
	"content/browser/zygote_host/zygote_host_impl_linux.cc": "ZYGOTE_HOST",
	"zygote_main_linux.cc": "ZYGOTE_MAIN",
	"content/zygote/zygote_main_linux.cc": "ZYGOTE_MAIN",
	"launch_posix.cc": "POSIX_LAUNCH",
	"base/process/launch_posix.cc": "POSIX_LAUNCH",
	"credentials.cc": "SANDBOX_CREDENTIALS",
	"sandbox/linux/services/credentials.cc": "SANDBOX_CREDENTIALS",
	"namespace_sandbox.cc": "NAMESPACE_SANDBOX",
	"sandbox/linux/services/namespace_sandbox.cc": "NAMESPACE_SANDBOX",
	"namespace_utils.cc": "NAMESPACE_UTILS",
	"sandbox/linux/services/namespace_utils.cc": "NAMESPACE_UTILS",
	"sandbox_linux.cc": "LINUX_SANDBOX",
	"sandbox/policy/linux/sandbox_linux.cc": "LINUX_SANDBOX",
	"sandbox_bpf.cc": "SECCOMP_SANDBOX",
	"sandbox/linux/seccomp-bpf/sandbox_bpf.cc": "SECCOMP_SANDBOX",
	"platform_thread_posix.cc": "POSIX_THREAD",
	"base/threading/platform_thread_posix.cc": "POSIX_THREAD",
	"crashpad_client_linux.cc": "CRASHPAD_CLIENT",
	"third_party/crashpad/crashpad/client/crashpad_client_linux.cc":
		"CRASHPAD_CLIENT",
};
const operations = [
	["CLONE", /\b(?:clone|ForkWithFlags)\b/],
	["FORK", /\bfork\b/],
	["UNSHARE", /\b(?:unshare|sys_unshare)\b/],
	["CHROOT", /\b(?:chroot|sys_chroot|ChrootToSafeEmptyDir)\b/],
	["UID_GID_MAP", /\b(?:WriteToIdMapFile|DenySetgroups|SetGidAndUidMaps)\b/],
	[
		"CAPABILITIES",
		/\b(?:sys_capset|sys_capget|DropAllCapabilitiesOnCurrentThread)\b/,
	],
	["EXEC", /\bexecvp\b/],
	["THREAD", /\bpthread_create\b/],
];
const errnos = [
	["EPERM", /Operation not permitted/],
	["EACCES", /Permission denied/],
	["EROFS", /Read-only file system/],
	["ENOSPC", /No space left on device/],
	["EAGAIN", /Resource temporarily unavailable/],
	["EINVAL", /Invalid argument/],
	["ENOENT", /No such file or directory/],
];
const signals = [
	"SIGABRT",
	"SIGTRAP",
	"SIGSYS",
	"SIGSEGV",
	"SIGKILL",
	"SIGTERM",
];
const zygoteStages = [
	["PROCESS_LAUNCH", /Failed to launch zygote process/],
	["BOOT_MESSAGE", /Failed to receive boot message from zygote/],
	["HELLO_MESSAGE", /Failed to receive hello message from zygote/],
	["PREMATURE_EXIT", /Zygote process exited prematurely/],
];

export function summarizeBrowserDebug(stderr) {
	const lines = stderr.slice(0, 65536).split("\n").slice(0, 256);
	const chrome = lines.flatMap((line) => {
		const body = /^\s*pw:browser \[pid=\d+\]\[err\] (.{1,2048})$/.exec(
			line,
		)?.[1];
		return body === undefined ? [] : [body];
	});
	const observations = [];
	for (const body of chrome) {
		const site =
			/^\[\d+:\d+:[^\]\n]{1,64}:(ERROR|FATAL):([a-z_/\-]+\.cc):\d+\] (.{1,1900})$/.exec(
				body,
			);
		if (!site || !Object.hasOwn(sourceNames, site[2])) continue;
		const observation = {
			source: sourceNames[site[2]],
			severity: site[1],
			operations: operations
				.filter(([, pattern]) => pattern.test(site[3]))
				.map(([name]) => name),
			errnos: errnos
				.filter(([, pattern]) => pattern.test(site[3]))
				.map(([name]) => name),
		};
		if (
			!observations.some(
				(value) => JSON.stringify(value) === JSON.stringify(observation),
			)
		)
			observations.push(observation);
	}
	const processSignals = signals.filter((signal) =>
		lines.some((line) =>
			new RegExp(
				`^\\s*pw:browser \\[pid=\\d+\\] <process did exit: exitCode=null, signal=${signal}>$`,
			).test(line),
		),
	);
	return {
		provenance: "PLAYWRIGHT_BROWSER_DEBUG_STDERR",
		playwrightLaunchObserved: lines.some((line) =>
			/^\s*pw:browser <launched> pid=\d+$/.test(line),
		),
		playwrightExitObserved: lines.some((line) =>
			/^\s*pw:browser \[pid=\d+\] <process did exit: exitCode=(?:null|\d+), signal=(?:null|SIG[A-Z]+)>$/.test(
				line,
			),
		),
		categories: classifySandboxLaunchFailure(
			new Error(chrome.map((line) => `[pid=1][err] ${line}`).join("\n")),
		),
		observations,
		...summarizeChromiumSources(chrome),
		zygoteStages: zygoteStages
			.filter(([, pattern]) => chrome.some((line) => pattern.test(line)))
			.map(([name]) => name),
		processSignals,
		chromeStderrObserved: chrome.length > 0,
		unclassifiedSevereLine: chrome.some(
			(line) =>
				/:(?:ERROR|FATAL):/.test(line) &&
				!Object.keys(sourceNames).some((name) => line.includes(`:${name}:`)),
		),
	};
}

export async function probeBrowserLaunch() {
	// DEBUG is confined to this fixed subprocess; its output is never inherited.
	const child = spawn(
		process.execPath,
		[fileURLToPath(new URL("./browser-launch-child.mjs", import.meta.url))],
		{
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				...process.env,
				DEBUG: "pw:browser",
				DEBUG_FILE: "",
				DEBUG_COLORS: "0",
				DEBUG_HIDE_DATE: "1",
			},
		},
	);
	let stderr = "";
	let truncated = false;
	let timedOut = false;
	let spawnFailed = false;
	let cleanupFailed = false;
	let browserPid;
	child.stdout.resume();
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk) => {
		truncated ||= stderr.length + chunk.length > 65536;
		stderr = (stderr + chunk).slice(0, 65536);
		// Trusted Playwright launch event, not a Chrome stderr message.
		const launched = /^\s*pw:browser <launched> pid=(\d+)$/m.exec(stderr);
		if (launched) browserPid = Number(launched[1]);
		if (
			browserPid &&
			new RegExp(
				`^\\s*pw:browser \\[pid=${browserPid}\\] <process did exit:`,
				"m",
			).test(stderr)
		)
			browserPid = undefined;
	});
	const terminateBrowser = () => {
		if (browserPid > 1) {
			try {
				process.kill(-browserPid, "SIGKILL");
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!("code" in error) ||
					error.code !== "ESRCH"
				)
					cleanupFailed = true;
			}
		}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		terminateBrowser();
		child.kill("SIGKILL");
	}, 40000);
	const status = await new Promise((resolve) => {
		child.on("error", () => {
			spawnFailed = true;
		});
		child.on("close", resolve);
	});
	clearTimeout(timer);
	return {
		outcome: timedOut
			? "TIMEOUT"
			: spawnFailed
				? "PROBE_EXECUTION_FAILURE"
				: status === 0
					? "SUCCEEDED"
					: status === 2
						? "SANDBOX_POLICY_FAILURE"
						: "OTHER_FAILURE",
		truncated,
		cleanupFailed,
		...summarizeBrowserDebug(stderr),
		interpretation: "DIAGNOSTIC_ONLY_NOT_SANDBOX_ATTESTATION",
	};
}
