import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const basePolicySha256 =
	"cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849";
export const derivedPolicySha256 =
	"6190132a2eccb9bd3b06819a2d80887039f295ad91ef11fb0125c527ca9d3a79";
const chrootRule = {
	names: ["chroot"],
	action: "SCMP_ACT_ALLOW",
	args: [],
	comment:
		"Required by pinned Chromium namespace sandbox credentials.cc:56; kernel CAP_SYS_CHROOT and LSM checks remain enforced.",
	includes: {},
	excludes: {},
};

export function requireChrootOnlyDerivation(base, derived) {
	assert.deepEqual(
		derived,
		{ ...base, syscalls: [...base.syscalls, chrootRule] },
		"Seccomp derivation must add only the exact namespace-sandbox chroot rule.",
	);
}

export async function loadSandboxPolicy() {
	const basePath = new URL("./playwright-1.64.0.seccomp", import.meta.url);
	const derivedPath = new URL(
		"./playwright-1.64.0.chromium-chroot.seccomp",
		import.meta.url,
	);
	const [baseBytes, derivedBytes] = await Promise.all([
		readFile(basePath),
		readFile(derivedPath),
	]);
	const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
	assert.equal(hash(baseBytes), basePolicySha256);
	assert.equal(hash(derivedBytes), derivedPolicySha256);
	const base = JSON.parse(baseBytes.toString());
	const derived = JSON.parse(derivedBytes.toString());
	requireChrootOnlyDerivation(base, derived);
	return {
		basePath,
		derivedPath,
		base,
		derived,
		basePolicySha256,
		derivedPolicySha256,
	};
}
