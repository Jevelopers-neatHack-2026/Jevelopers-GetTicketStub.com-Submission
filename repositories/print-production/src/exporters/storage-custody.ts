import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { resource } from "../runtime/resources.js";
import { hash } from "../internal/durability.js";
import { fingerprint } from "../composition/primitives.js";
import { measureCanonicalRuntime } from "../api/canonical-runtime-record.js";
import { defaultOutputPolicy } from "./private-policy.js";
import { VerificationFailure } from "../runtime/errors.js";

async function inventory(
	directory: string,
): Promise<readonly (readonly [string, string])[]> {
	const files: (readonly [string, string])[] = [];
	for (const entry of (
		await readdir(resource(directory), { withFileTypes: true })
	).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory()) files.push(...(await inventory(path)));
		else if (entry.isFile())
			files.push([path, hash(await readFile(resource(path)))]);
		else
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Storage custody requires regular source/build files.",
			);
		if (files.length > 4096)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Storage custody inventory exceeds its finite bound.",
			);
	}
	return files;
}

async function gitLabel() {
	try {
		const root = await realpath(fileURLToPath(resource(".")));
		const git = async (...args: string[]) =>
			(
				await promisify(execFile)("git", ["-C", root, ...args], {
					timeout: 10000,
					maxBuffer: 1024 * 1024,
				})
			).stdout.trim();
		if ((await realpath(await git("rev-parse", "--show-toplevel"))) !== root)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Git label does not belong to the measured package root.",
			);
		const [revision, tree, status] = await Promise.all([
			git("rev-parse", "HEAD"),
			git("rev-parse", "HEAD^{tree}"),
			git("status", "--porcelain", "--untracked-files=normal"),
		]);
		const label = z
			.object({
				revision: z.string().regex(/^[a-f0-9]{40}$/),
				tree: z.string().regex(/^[a-f0-9]{40}$/),
			})
			.parse({ revision, tree });
		return {
			state: status === "" ? ("clean" as const) : ("dirty" as const),
			...label,
			statusDigest: hash(status),
		};
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		return {
			state: "unavailable" as const,
			revision: null,
			tree: null,
			statusDigest: null,
		};
	}
}

export async function measureStorageCustody(testPaths: readonly string[]) {
	const [source, build, git, runtime, compiledTests] = await Promise.all([
		Promise.all(["src", "scripts", "tests"].map(inventory)).then(
			async (parts) => [
				...parts.flat(),
				...(await Promise.all(
					[
						"package.json",
						"package-lock.json",
						"tsconfig.json",
						"docs/runtime/pins.json",
						"vendor/shared-contracts/candidate-pin.json",
						"vendor/shared-contracts/jevelopers-shared-contracts-0.9.7.tgz",
					].map(
						async (path) =>
							[path, hash(await readFile(resource(path)))] as const,
					),
				)),
			],
		),
		inventory("dist"),
		gitLabel(),
		measureCanonicalRuntime(defaultOutputPolicy),
		Promise.all(
			[...new Set(testPaths)].sort().map(async (path) => ({
				path,
				digest: hash(await readFile(resource(`dist/tests/${path}`))),
			})),
		),
	]);
	return {
		source: { git, fileCount: source.length, digest: fingerprint(source) },
		build: {
			fileCount: build.length,
			digest: fingerprint(build),
			gitCorrespondence: "unproven" as const,
			measurementProfile: "private-default-output-policy" as const,
			compiledImplementationDigest: runtime.source_digest,
			rendererCommitment: runtime.renderer_commitment,
			parserCommitment: runtime.parser_commitment,
			browserDigest: runtime.browser_digest,
			privateRendererDigest: runtime.private_renderer_digest,
		},
		compiledTests,
	} as const;
}

export function requireStorageCustody(
	before: Awaited<ReturnType<typeof measureStorageCustody>>,
	after: Awaited<ReturnType<typeof measureStorageCustody>>,
) {
	if (fingerprint(before) !== fingerprint(after))
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Storage source/build/test custody changed during execution.",
		);
}
