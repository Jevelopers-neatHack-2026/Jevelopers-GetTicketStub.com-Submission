import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSandboxPolicy } from "./seccomp-policy.mjs";

const root = resolve(import.meta.dirname, "../..");
const pins = JSON.parse(
	await readFile(resolve(root, "docs/runtime/pins.json"), "utf8"),
);
const policies = await loadSandboxPolicy();
const policyPath = fileURLToPath(policies.derivedPath);
const policySha256 = policies.derivedPolicySha256;
const policy = policies.derived;

function validateInspection(value, user, expectedPolicy = policy) {
	assert.equal(value.Config.User, user);
	assert.match(user, /^[1-9][0-9]*:[1-9][0-9]*$/);
	assert.equal(value.Config.Image, pins.image.reference);
	assert.equal(value.Image, pins.image.configDigest);
	const config = value.HostConfig;
	assert.equal(config.Privileged, false);
	assert.equal(config.NetworkMode, "none");
	assert.equal(config.IpcMode, "private");
	assert.equal(config.ShmSize, 1073741824);
	assert.equal(config.Init, true);
	assert.equal(config.ReadonlyRootfs, true);
	assert.equal(config.PidMode, "");
	assert.equal(config.UsernsMode, "");
	assert.equal(config.UTSMode, "");
	assert.deepEqual(config.CapAdd ?? [], []);
	assert.deepEqual(config.CapDrop, ["ALL"]);
	assert.deepEqual(config.Devices ?? [], []);
	assert.deepEqual(config.DeviceRequests ?? [], []);
	assert.deepEqual(config.Sysctls ?? {}, {});
	assert.equal(value.AppArmorProfile, "docker-default");
	assert.equal(config.SecurityOpt.length, 3);
	assert.ok(config.SecurityOpt.includes("no-new-privileges"));
	assert.ok(config.SecurityOpt.includes("apparmor=docker-default"));
	const seccomp = config.SecurityOpt.find((option) =>
		option.startsWith("seccomp="),
	);
	assert.ok(seccomp);
	assert.deepEqual(
		JSON.parse(seccomp.slice("seccomp=".length)),
		expectedPolicy,
	);
	const baseline = value.Mounts.find(
		(mount) => mount.Destination === "/run/pp-security",
	);
	assert.ok(baseline);
	assert.equal(baseline.Type, "bind");
	assert.equal(baseline.RW, false);
	return {
		user,
		image: value.Image,
		imageReference: value.Config.Image,
		networkMode: config.NetworkMode,
		ipcMode: config.IpcMode,
		shmBytes: config.ShmSize,
		privileged: config.Privileged,
		capAdd: config.CapAdd ?? [],
		capDrop: config.CapDrop,
		apparmor: value.AppArmorProfile,
		noNewPrivileges: true,
		seccompPolicySha256:
			expectedPolicy === policies.base
				? policies.basePolicySha256
				: policySha256,
		seccompBasePolicySha256: policies.basePolicySha256,
		readonlyRootfs: config.ReadonlyRootfs,
		hostNamespaceMountReadOnly: true,
	};
}

if (process.argv[2] === "--check-inspection") {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const { inspection, user } = JSON.parse(Buffer.concat(chunks).toString());
	console.log(JSON.stringify(validateInspection(inspection, user)));
} else {
	assert.equal(process.argv.length, 2);
	assert.equal(process.platform, "linux");
	assert.equal(process.versions.node, pins.node);
	assert.equal(process.env.PP_RENDERER_IMAGE, pins.image.reference);
	const uid = process.getuid();
	const gid = process.getgid();
	assert.ok(uid > 0 && gid > 0);
	const user = `${uid}:${gid}`;
	const baselineDirectory = await mkdtemp(resolve(tmpdir(), "pp01a-security-"));
	let container;
	const docker = (args) =>
		execFileSync("docker", args, { encoding: "utf8" }).trim();
	try {
		await writeFile(
			resolve(baselineDirectory, "host-namespaces.json"),
			JSON.stringify({
				ipc: await readlink("/proc/self/ns/ipc"),
				net: await readlink("/proc/self/ns/net"),
			}),
		);
		const containerArgs = [
			"create",
			"--platform",
			"linux/amd64",
			"--init",
			"--user",
			user,
			"--network",
			"none",
			"--ipc",
			"private",
			"--shm-size",
			"1g",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--security-opt",
			"apparmor=docker-default",
			"--security-opt",
			`seccomp=${policyPath}`,
			"--read-only",
			"--tmpfs",
			"/tmp:rw,nosuid,nodev,size=1g,mode=1777",
			"-e",
			"HOME=/tmp",
			"-e",
			"PP_RENDERER_IMAGE",
			"-e",
			"TZ=UTC",
			"-e",
			"LANG=C.UTF-8",
			"-e",
			"LC_ALL=C.UTF-8",
			"-e",
			"PLAYWRIGHT_BROWSERS_PATH=/ms-playwright",
			"--mount",
			`type=bind,source=${root},target=/work`,
			"--mount",
			`type=bind,source=${baselineDirectory},target=/run/pp-security,readonly`,
			"-w",
			"/work",
			pins.image.reference,
			"bash",
			"scripts/ci-offline.sh",
		];
		// Exact old/new syscall comparison under identical mandatory controls.
		for (const [profilePath, expected] of [
			[fileURLToPath(policies.basePath), "CHROOT_EPERM"],
			[policyPath, "CHROOT_ENTERED_FDINFO"],
		]) {
			const args = containerArgs
				.slice(0, -2)
				.map((arg) =>
					arg === `seccomp=${policyPath}` ? `seccomp=${profilePath}` : arg,
				);
			let probe;
			try {
				probe = docker([
					...args,
					"/work/out/toolchain/node-v24.21.0-linux-x64/bin/node",
					"scripts/security/chroot-probe.mjs",
				]);
				const inspected = JSON.parse(docker(["inspect", probe]))[0];
				const inspectedControls = validateInspection(
					inspected,
					user,
					profilePath === policyPath ? policy : policies.base,
				);
				const started = spawnSync("docker", ["start", "--attach", probe], {
					encoding: "utf8",
					timeout: 15000,
					maxBuffer: 16384,
				});
				assert.ok(
					!started.error && started.status === 0,
					"Fixed chroot probe execution failed.",
				);
				let receipt;
				try {
					receipt = JSON.parse(started.stdout).chrootProbe;
				} catch (error) {
					throw new Error("Fixed chroot probe receipt was invalid.");
				}
				assert.ok(
					receipt.parentNonroot === true &&
						receipt.parentCapabilities === "none" &&
						receipt.noNewPrivileges === true &&
						receipt.apparmor === "docker-default (enforce)" &&
						receipt.seccomp === "filter",
					"Fixed probe containment failed.",
				);
				const outcomes = [
					"CHROOT_EPERM",
					"CHROOT_ENTERED_FDINFO",
					"UNKNOWN_FAILURE",
					"PROBE_EXECUTION_FAILURE",
				];
				assert.ok(
					outcomes.includes(receipt.outsideUserNamespace) &&
						outcomes.includes(receipt.insideUserPidNetworkNamespace),
					"Fixed probe outcomes were invalid.",
				);
				console.log(
					JSON.stringify({
						chrootPolicyComparison: {
							container: inspectedControls,
							outsideUserNamespace: receipt.outsideUserNamespace,
							insideUserPidNetworkNamespace:
								receipt.insideUserPidNetworkNamespace,
							provenance: "FIXED_UNSHARE_GNU_CHROOT_PROBE",
						},
					}),
				);
				assert.equal(receipt.outsideUserNamespace, "CHROOT_EPERM");
				assert.equal(receipt.insideUserPidNetworkNamespace, expected);
			} finally {
				if (probe) docker(["rm", "--force", probe]);
			}
		}
		container = docker(containerArgs);
		const inspected = JSON.parse(docker(["inspect", container]))[0];
		const receipt = validateInspection(inspected, user);
		assert.equal(
			inspected.Mounts.find((mount) => mount.Destination === "/run/pp-security")
				.Source,
			baselineDirectory,
		);
		console.log(JSON.stringify({ containerSecurity: receipt }));
		const started = spawnSync("docker", ["start", "--attach", container], {
			stdio: "inherit",
		});
		assert.ifError(started.error);
		const final = JSON.parse(docker(["inspect", container]))[0];
		console.log(
			JSON.stringify({
				containerSecurity: validateInspection(final, user),
				exitCode: final.State.ExitCode,
			}),
		);
		assert.equal(started.status, 0);
		assert.equal(final.State.ExitCode, 0);
	} finally {
		try {
			if (container) docker(["rm", "--force", container]);
		} finally {
			await rm(baselineDirectory, { recursive: true, force: true });
		}
	}
}
