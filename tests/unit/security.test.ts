import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
	requireLinuxSandbox,
	requireLinuxRendererStatus,
} from "../../src/exporters/offline-browser.js";
import { requireLinuxContainerSecurity } from "../../src/runtime/environment.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import { resource } from "../../src/runtime/resources.js";

const typed = (code: string) => (error: unknown) =>
	error instanceof VerificationFailure && error.code === code;
const rows = {
	"Layer 1 Sandbox": "Namespace",
	"PID namespaces": "Yes",
	"Network namespaces": "Yes",
	"Seccomp-BPF sandbox": "Yes",
	"Seccomp-BPF sandbox supports TSYNC": "Yes",
};
const status = [
	"Uid:\t1001\t1001\t1001\t1001",
	"Gid:\t1001\t1001\t1001\t1001",
	"NSpid:\t42\t2",
	"CapInh:\t0000000000000000",
	"CapPrm:\t0000000000000000",
	"CapEff:\t0000000000000000",
	"CapBnd:\t0000000000000000",
	"CapAmb:\t0000000000000000",
	"NoNewPrivs:\t1",
	"Seccomp:\t2",
	"Seccomp_filters:\t2",
].join("\n");
const container = {
	uid: 1001,
	gid: 1001,
	status,
	apparmor: "docker-default (enforce)",
	ipc: "ipc:[2]",
	net: "net:[4]",
	host: { ipc: "ipc:[1]", net: "net:[3]" },
	interfaces: ["lo"],
	shmBytes: 1073741824,
	shmType: 0x01021994,
};

test("accepts namespace and seccomp evidence when all sandbox layers are active", () => {
	assert.equal(requireLinuxSandbox(rows).kind, "linux-namespace-seccomp");
});
for (const name of Object.keys(rows)) {
	test(`rejects sandbox evidence when ${name} is disabled or unknown`, () => {
		for (const value of ["No", "None", "Unknown", ""]) {
			assert.throws(
				() => requireLinuxSandbox({ ...rows, [name]: value }),
				typed("SANDBOX_POLICY_FAILURE"),
			);
		}
		const missing: Record<string, string> = { ...rows };
		delete missing[name];
		assert.throws(
			() => requireLinuxSandbox(missing),
			typed("SANDBOX_POLICY_FAILURE"),
		);
	});
}
test("rejects sandbox evidence when its report cannot be parsed", () => {
	for (const value of [null, [], { ...rows, "PID namespaces": true }])
		assert.throws(
			() => requireLinuxSandbox(value),
			typed("SANDBOX_POLICY_FAILURE"),
		);
});
test("accepts live process status when renderer isolation exceeds the container filter", () => {
	assert.deepEqual(requireLinuxRendererStatus(status), {
		uid: 1001,
		pidNamespaceDepth: 2,
		seccompFilters: 2,
		noNewPrivileges: true,
		capabilities: "none",
	});
});
for (const [name, replacement] of [
	["Uid", "0\t0\t0\t0"],
	["NSpid", "42"],
	["CapEff", "0000000000200000"],
	["NoNewPrivs", "0"],
	["Seccomp", "0"],
	["Seccomp_filters", "1"],
] as const) {
	test(`rejects renderer isolation when ${name} is insecure`, () => {
		assert.throws(
			() =>
				requireLinuxRendererStatus(
					status.replace(
						new RegExp(`^${name}:.*$`, "m"),
						`${name}:\t${replacement}`,
					),
				),
			typed("SANDBOX_POLICY_FAILURE"),
		);
	});
}
test("rejects renderer isolation when process observations are absent", () => {
	assert.throws(
		() => requireLinuxRendererStatus(""),
		typed("SANDBOX_POLICY_FAILURE"),
	);
});
test("accepts container observations when IPC and network namespaces are private", () => {
	assert.equal(requireLinuxContainerSecurity(container).shmBytes, 1073741824);
});
for (const [name, change] of [
	["root identity", { uid: 0 }],
	["host IPC", { ipc: container.host.ipc }],
	["host network", { net: container.host.net }],
	["external interface", { interfaces: ["lo", "eth0"] }],
	["small shared memory", { shmBytes: 67108864 }],
	["unconfined AppArmor", { apparmor: "unconfined" }],
	["missing observations", { status: "" }],
	[
		"capability grant",
		{
			status: status.replace(
				"CapBnd:\t0000000000000000",
				"CapBnd:\t0000000000200000",
			),
		},
	],
	[
		"disabled seccomp",
		{ status: status.replace("Seccomp:\t2", "Seccomp:\t0") },
	],
	[
		"privilege escalation",
		{ status: status.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0") },
	],
] as const) {
	test(`rejects container state when it has ${name}`, () => {
		assert.throws(
			() => requireLinuxContainerSecurity({ ...container, ...change }),
			typed("CONTAINER_POLICY_FAILURE"),
		);
	});
}

test("rejects forbidden Docker overrides when the actual inspection differs from policy", async () => {
	const policy = JSON.parse(
		(
			await readFile(resource("scripts/security/playwright-1.64.0.seccomp"))
		).toString(),
	);
	const inspection = {
		Config: {
			User: "1001:1001",
			Image:
				"mcr.microsoft.com/playwright:v1.64.0-noble@sha256:bc72a8df40831ded821e3cbc79c318c21b44d6e51dff9fd89ace7a8249c5b462",
		},
		Image:
			"sha256:847f71bbb3f17fc1032d50d75bf6fb3fdcf188b16dff81f24667fe9ae9409e01",
		AppArmorProfile: "docker-default",
		Mounts: [{ Destination: "/run/pp-security", Type: "bind", RW: false }],
		HostConfig: {
			Privileged: false,
			NetworkMode: "none",
			IpcMode: "private",
			ShmSize: 1073741824,
			Init: true,
			ReadonlyRootfs: true,
			PidMode: "",
			UsernsMode: "",
			UTSMode: "",
			CapAdd: [],
			CapDrop: ["ALL"],
			SecurityOpt: [
				"no-new-privileges",
				"apparmor=docker-default",
				`seccomp=${JSON.stringify(policy)}`,
			],
		},
	};
	const check = (value: unknown) =>
		spawnSync(
			process.execPath,
			[
				fileURLToPath(resource("scripts/security/run-offline.mjs")),
				"--check-inspection",
			],
			{
				input: JSON.stringify({ inspection: value, user: "1001:1001" }),
				encoding: "utf8",
			},
		);
	assert.equal(check(inspection).status, 0);
	for (const change of [
		{ Privileged: true },
		{ NetworkMode: "host" },
		{ IpcMode: "host" },
		{ CapAdd: ["SYS_ADMIN"] },
		{ SecurityOpt: ["seccomp=unconfined"] },
		{ SecurityOpt: ["apparmor=unconfined"] },
		{ SecurityOpt: [...inspection.HostConfig.SecurityOpt, "label=disable"] },
		{ Sysctls: { "kernel.unprivileged_userns_clone": "1" } },
		{ ShmSize: 67108864 },
	])
		assert.notEqual(
			check({
				...inspection,
				HostConfig: { ...inspection.HostConfig, ...change },
			}).status,
			0,
		);
	assert.notEqual(
		check({ ...inspection, Config: { ...inspection.Config, User: "0:0" } })
			.status,
		0,
	);
	assert.notEqual(
		check({ ...inspection, AppArmorProfile: "unconfined" }).status,
		0,
	);
});
