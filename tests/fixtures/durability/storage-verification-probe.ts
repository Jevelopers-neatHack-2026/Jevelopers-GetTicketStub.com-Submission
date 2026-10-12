import assert from "node:assert/strict";
import { cp, mkdir, readFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { z } from "zod";
import { resource } from "../../../src/runtime/resources.js";
import { hash } from "../../../src/internal/durability.js";
import { durabilityTestFiles } from "../../../src/internal/independent-tests.js";
import { storageCanonicalTests } from "../../../src/exporters/storage-suite.js";

export async function storageVerificationProbe(parent: string) {
	const root = join(parent, "probe");
	await mkdir(root);
	await cp(resource("dist"), join(root, "dist"), { recursive: true });
	await cp(resource("src"), join(root, "src"), { recursive: true });
	for (const name of [
		"scripts",
		"tests",
		"docs",
		"vendor",
		"node_modules",
		"package-lock.json",
		"package.json",
		"tsconfig.json",
	])
		await symlink(resource(name), join(root, name));
	return {
		root,
		cli: join(root, "dist/scripts/verify/cli.js"),
		canary: join(root, "dist/tests/fixtures/durability/canary.js"),
	};
}

export async function assertStorageProvenance(value: unknown) {
	const digest = z.string().regex(/^[a-f0-9]{64}$/);
	const parsed = z
		.object({
			source: z.object({
				git: z.object({
					state: z.enum(["clean", "dirty"]),
					revision: z.string().regex(/^[a-f0-9]{40}$/),
					tree: z.string().regex(/^[a-f0-9]{40}$/),
					statusDigest: digest,
				}),
				fileCount: z.number().int().positive(),
				digest,
			}),
			build: z.object({
				fileCount: z.number().int().positive(),
				digest,
				gitCorrespondence: z.literal("unproven"),
				compiledImplementationDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
			}),
			compiledTests: z.array(z.object({ path: z.string(), digest })).length(17),
		})
		.parse(value);
	const git = (...args: string[]) =>
		execFileSync("git", args, { encoding: "utf8" }).trim();
	assert.equal(parsed.source.git.revision, git("rev-parse", "HEAD"));
	assert.equal(parsed.source.git.tree, git("rev-parse", "HEAD^{tree}"));
	const status = git("status", "--porcelain", "--untracked-files=normal");
	assert.equal(parsed.source.git.state, status === "" ? "clean" : "dirty");
	assert.equal(parsed.source.git.statusDigest, hash(status));
	const paths = [
		...new Set([
			...durabilityTestFiles["artifact-storage"],
			...Object.keys(storageCanonicalTests),
		]),
	].sort();
	assert.deepEqual(
		parsed.compiledTests.map(({ path }) => path),
		paths,
	);
	for (const { path, digest } of parsed.compiledTests)
		assert.equal(digest, hash(await readFile(resource(`dist/tests/${path}`))));
}
