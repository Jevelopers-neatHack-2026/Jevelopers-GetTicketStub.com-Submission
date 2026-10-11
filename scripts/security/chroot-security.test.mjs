import assert from "node:assert/strict";
import { test } from "node:test";
import {
	loadSandboxPolicy,
	requireChrootOnlyDerivation,
} from "./seccomp-policy.mjs";
import {
	requireRendererChroot,
	observeRendererChroots,
} from "./renderer-chroot.mjs";
import { classifyChrootOutput } from "./chroot-output.mjs";

test("accepts only the audited chroot derivation and preserves the exact upstream profile", async () => {
	const { base, derived, basePolicySha256, derivedPolicySha256 } =
		await loadSandboxPolicy();
	requireChrootOnlyDerivation(base, derived);
	assert.notEqual(basePolicySha256, derivedPolicySha256);
	const original = base.syscalls.filter((r) => r.names.includes("chroot"));
	assert.equal(original.length, 1);
	assert.deepEqual(original[0].includes, { caps: ["CAP_SYS_CHROOT"] });
	assert.equal(derived.syscalls.length, base.syscalls.length + 1);
	assert.deepEqual(derived.syscalls.at(-1).names, ["chroot"]);
	assert.equal(derived.defaultAction, "SCMP_ACT_ERRNO");
});

test("rejects unrelated or missing seccomp changes rather than expanding the exception", async () => {
	const { base, derived } = await loadSandboxPolicy();
	for (const change of [
		{ ...derived, defaultAction: "SCMP_ACT_ALLOW" },
		{ ...derived, syscalls: derived.syscalls.slice(1) },
		{ ...derived, syscalls: base.syscalls },
		{ ...derived, archMap: [] },
		{
			...derived,
			syscalls: [
				...derived.syscalls,
				{ names: ["mount"], action: "SCMP_ACT_ALLOW" },
			],
		},
		{
			...derived,
			syscalls: [
				...base.syscalls,
				{ ...derived.syscalls.at(-1), names: ["chroot", "ptrace"] },
			],
		},
		{
			...derived,
			syscalls: [
				...base.syscalls,
				{ ...derived.syscalls.at(-1), includes: { caps: ["CAP_SYS_CHROOT"] } },
			],
		},
	])
		assert.throws(() => requireChrootOnlyDerivation(base, change));
});

test("requires complete live proc-fdinfo evidence and rejects raw paths or missing isolation", () => {
	const evidence = {
		rootCategory: "PROC_FDINFO_LINKED",
		filesystem: "PROCFS",
		rootIdentity: "DISTINCT_CONTAINER_ROOT",
		rootDirectory: "FDINFO_OWNER_GONE_ESRCH",
		namespaceSeccomp: "ACCEPTED",
		processLiveness: "STABLE",
		rootStability: "STABLE",
	};
	assert.equal(
		requireRendererChroot(evidence).kind,
		"proc-fdinfo-isolated-root",
	);
	assert.ok(
		!JSON.stringify(
			requireRendererChroot({
				...evidence,
				extra: "/private/customer?secret=token",
			}),
		).includes("secret"),
	);
	assert.equal(
		requireRendererChroot({
			...evidence,
			rootCategory: "PROC_FDINFO_DELETED",
			rootDirectory: "FDINFO_OWNER_GONE_ENOENT",
		}).kind,
		"proc-fdinfo-isolated-root",
	);
	for (const root of [
		"/",
		"/proc/42/fdinfo (deleted)",
		"/private/customer-path?token=secret",
		undefined,
		{ ...evidence, filesystem: "NON_PROCFS" },
		{ ...evidence, rootIdentity: "SAME_CONTAINER_ROOT" },
		{ ...evidence, rootDirectory: "EMPTY" },
		{ ...evidence, rootDirectory: "TASK_OR_ROOT_GONE" },
		{ ...evidence, rootDirectory: "ACCESS_DENIED" },
		{ ...evidence, namespaceSeccomp: "REJECTED_OR_UNAVAILABLE" },
		{ ...evidence, processLiveness: "UNAVAILABLE" },
		{ ...evidence, rootStability: "CHANGED" },
	]) {
		assert.throws(
			() => requireRendererChroot(root),
			(error) => {
				assert.equal(error.code, "SANDBOX_POLICY_FAILURE");
				assert.ok(!error.message.includes("/private"));
				return true;
			},
		);
	}
});

test("classifies only fixed GNU chroot outcomes and discards raw utility messages", () => {
	for (const [left, right] of [
		["'", "'"],
		["\u2018", "\u2019"],
	]) {
		assert.equal(
			classifyChrootOutput({
				stderr: `/usr/sbin/chroot: cannot change root directory to ${left}/proc/self/fdinfo/${right}: Operation not permitted\n`,
			}),
			"CHROOT_EPERM",
		);
		assert.equal(
			classifyChrootOutput({
				stderr: `/usr/sbin/chroot: failed to run command ${left}/usr/bin/true${right}: No such file or directory\n`,
			}),
			"CHROOT_ENTERED_FDINFO",
		);
	}
	assert.equal(
		classifyChrootOutput({ error: new Error("secret=token"), stderr: "" }),
		"PROBE_EXECUTION_FAILURE",
	);
	assert.equal(
		classifyChrootOutput({
			stderr:
				"/usr/sbin/chroot: cannot change root directory to '/private/customer': Operation not permitted\n",
		}),
		"UNKNOWN_FAILURE",
	);
});

test("fails closed with a finite reason when renderer observation fails without exposing an exception", async () => {
	const error = Object.assign(new Error("/private/customer?token=secret"), {
		code: "EACCES",
	});
	await assert.rejects(
		observeRendererChroots({
			newBrowserCDPSession: async () => {
				throw error;
			},
		}),
		(error) =>
			error.code === "SANDBOX_POLICY_FAILURE" &&
			error.message.endsWith("[ACCESS_DENIED].") &&
			!error.message.includes("secret"),
	);
});
