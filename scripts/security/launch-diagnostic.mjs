import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeLinuxContainerSecurity } from "../../dist/src/runtime/environment.js";
import { failureReceipt } from "../../dist/src/runtime/errors.js";

function namespaceProbe(args) {
	const result = spawnSync("/usr/bin/unshare", [...args, "/usr/bin/true"], {
		encoding: "utf8",
		timeout: 3000,
		maxBuffer: 16384,
	});
	if (result.error) {
		const code = "code" in result.error ? result.error.code : undefined;
		return {
			outcome:
				code === "ENOENT"
					? "TOOL_UNAVAILABLE"
					: code === "ETIMEDOUT"
						? "TIMEOUT"
						: "PROBE_EXECUTION_FAILURE",
		};
	}
	if (result.status === 0) return { outcome: "SUCCEEDED" };
	const stderr = result.stderr;
	const reason =
		/^unshare: (?:unshare failed|write failed[^\n]*): Operation not permitted\s*$/m.test(
			stderr,
		)
			? "OPERATION_NOT_PERMITTED"
			: /^unshare: (?:unshare failed|write failed[^\n]*): Permission denied\s*$/m.test(
						stderr,
					)
				? "PERMISSION_DENIED"
				: /^unshare: unshare failed: No space left on device\s*$/m.test(stderr)
					? "NAMESPACE_LIMIT_REACHED"
					: "UNKNOWN_FAILURE";
	return {
		outcome: "FAILED",
		reason,
		signal:
			result.signal === "SIGSYS"
				? "SIGSYS"
				: result.signal === null
					? "NONE"
					: "OTHER",
		enforcingLayer: "UNKNOWN",
	};
}

async function temporaryFilesystemProbe() {
	let directory;
	try {
		directory = await mkdtemp(join(tmpdir(), "pp01a-launch-probe-"));
		const nested = join(directory, "nested");
		await mkdir(nested);
		const file = join(nested, "exclusive-lock");
		await writeFile(file, "probe", { flag: "wx" });
		assert.equal(await readFile(file, "utf8"), "probe");
		return { outcome: "SUCCEEDED" };
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		const code = "code" in error ? error.code : undefined;
		return {
			outcome: "FAILED",
			reason:
				code === "EACCES"
					? "ACCESS_DENIED"
					: code === "EROFS"
						? "READ_ONLY_FILESYSTEM"
						: code === "ENOSPC"
							? "NO_SPACE"
							: "UNKNOWN_FAILURE",
		};
	} finally {
		if (directory) await rm(directory, { recursive: true, force: true });
	}
}

async function policyIndicator(path) {
	try {
		const value = (await readFile(path, "utf8")).trim();
		return value === "0" ? "DISABLED" : value === "1" ? "ENABLED" : "UNKNOWN";
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return "UNAVAILABLE";
	}
}

async function main() {
	assert.equal(process.platform, "linux");
	const container = await observeLinuxContainerSecurity();
	const identity = spawnSync(
		"/usr/bin/getent",
		["passwd", String(container.uid)],
		{
			encoding: "utf8",
			timeout: 3000,
			maxBuffer: 16384,
		},
	);
	const filesystem = await temporaryFilesystemProbe();
	const userNamespace = namespaceProbe(["--user", "--map-root-user"]);
	const userPidNetworkNamespaces = namespaceProbe([
		"--user",
		"--map-root-user",
		"--pid",
		"--net",
		"--fork",
	]);
	console.log(
		JSON.stringify({
			launchDiagnostic: {
				schemaVersion: 1,
				container,
				passwdIdentity: identity.error
					? "PROBE_UNAVAILABLE"
					: identity.status === 0
						? "PRESENT"
						: identity.status === 2
							? "MISSING"
							: "UNKNOWN",
				temporaryFilesystem: filesystem,
				userNamespace,
				userPidNetworkNamespaces,
				kernelIndicators: {
					apparmorRestrictedUserns: await policyIndicator(
						"/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
					),
					unprivilegedUsernsClone: await policyIndicator(
						"/proc/sys/kernel/unprivileged_userns_clone",
					),
				},
				interpretation: "DIAGNOSTIC_ONLY_NOT_SANDBOX_ATTESTATION",
			},
		}),
	);
}

try {
	await main();
} catch (error) {
	console.log(
		JSON.stringify({
			launchDiagnostic: { status: "FAILED", failure: failureReceipt(error) },
		}),
	);
	process.exitCode = 1;
}
