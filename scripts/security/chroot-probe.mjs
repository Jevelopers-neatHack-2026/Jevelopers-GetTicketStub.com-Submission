import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { classifyChrootOutput } from "./chroot-output.mjs";

function chrootAttempt(namespaced) {
	const command = namespaced ? "/usr/bin/unshare" : "/usr/sbin/chroot";
	const args = ["/proc/self/fdinfo/", "/usr/bin/true"];
	const result = spawnSync(
		command,
		namespaced
			? [
					"--user",
					"--map-root-user",
					"--pid",
					"--net",
					"--fork",
					"/usr/sbin/chroot",
					...args,
				]
			: args,
		{
			encoding: "utf8",
			timeout: 3000,
			maxBuffer: 16384,
			env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
		},
	);
	return classifyChrootOutput(result);
}

try {
	assert.equal(process.platform, "linux");
	assert.ok(process.getuid() > 0 && process.getgid() > 0);
	const status = await readFile("/proc/self/status", "utf8");
	for (const name of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
		assert.match(status, new RegExp(`^${name}:\\s+0+$`, "m"));
	assert.match(status, /^NoNewPrivs:\s+1$/m);
	assert.match(status, /^Seccomp:\s+2$/m);
	assert.equal(
		(await readFile("/proc/self/attr/current", "utf8")).trim(),
		"docker-default (enforce)",
	);
	console.log(
		JSON.stringify({
			chrootProbe: {
				parentNonroot: true,
				parentCapabilities: "none",
				noNewPrivileges: true,
				apparmor: "docker-default (enforce)",
				seccomp: "filter",
				outsideUserNamespace: chrootAttempt(false),
				insideUserPidNetworkNamespace: chrootAttempt(true),
				provenance: "FIXED_UNSHARE_GNU_CHROOT_PROBE",
			},
		}),
	);
} catch (error) {
	console.log(
		JSON.stringify({ chrootProbe: { outcome: "PROBE_EXECUTION_FAILURE" } }),
	);
	process.exitCode = 1;
}
