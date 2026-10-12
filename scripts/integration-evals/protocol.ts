import { constants } from "node:fs";
import { open, lstat, readdir, unlink, mkdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { isMainThread } from "node:worker_threads";
import { isAbsolute, join, parse, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { z } from "zod";

export const checkout = fileURLToPath(new URL("../../../", import.meta.url));
export const fixtureDirectory = join(
	checkout,
	"tests/fixtures/integration-evals/v1",
);
export const payloadHash =
	"969bc670d1540ffce4823ea9ca7b9c9bd5154052c78a0460cf8c235f88cca4de";
export const limitations = [
	"Unaccepted development component slice; mock-only synthetic origin; no runtime approval or financial authority.",
	"created_at and original_cutoff are logical scenario timestamps from request.clock, not authentic live capture/cutoff.",
	"Original fixture collected_at remains 2026-10-10T00:00:00Z; supplement provenance is separate.",
	"macOS subprocess characterization is not a Linux evaluator containment pass; print-preflight remains unsupported.",
] as const;

export class OwnerFailure extends Error {
	override readonly name = "OwnerFailure";
	constructor(readonly code: string) {
		super(code);
	}
}
export function requireOwner(
	condition: boolean,
	code: string,
): asserts condition {
	if (!condition) throw new OwnerFailure(code);
}
export function digest(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
export const requestSchema = z.strictObject({
	case: z.record(z.string(), z.unknown()),
	run_id: identifier,
	component_revision: z.string().regex(/^[a-f0-9]{40}$/),
	configuration_artifact: z.string().max(4096),
	artifact_directory: z.string().max(4096),
	namespace: identifier,
	seed: z.number().int().safe(),
	clock: z.iso.datetime({ offset: true }),
	providers: z
		.array(
			z.strictObject({
				id: identifier,
				mode: z.literal("mock-only"),
				model: z.string().max(256),
				endpoint: z.string().nullable().optional(),
				credential_env: identifier.nullable().optional(),
				eligible: z.literal(false).optional(),
				authority_ref: z.null().optional(),
				cap: z.null().optional(),
				currency: z.string().nullable().optional(),
				cleanup_supported: z.boolean().optional(),
				allowed_operations: z.array(z.string()).max(0).optional(),
			}),
		)
		.max(32),
});
export type OwnerRequest = z.infer<typeof requestSchema>;
export const configurationSchema = z.strictObject({
	schema_version: z.literal("print-invalid-owner/v1"),
	case_id: z.literal("print-invalid"),
	fixture_id: z.literal("asset-negative"),
	supplement_id: z.literal("print-invalid-synthetic/v1"),
	payload_sha256: z.literal(payloadHash),
	mode: z.literal("mock-only"),
	origin: z.literal("synthetic"),
	accepted: z.literal(false),
	node_sha256: z.string().regex(/^[a-f0-9]{64}$/),
	browser_root: z.string().max(4096),
	renderer_image: z.string().nullable(),
});
export type OwnerConfiguration = z.infer<typeof configurationSchema>;
/**
 * Verifies the configured renderer image against the pinned image and
 * installs the deterministic renderer environment for this process. The
 * owner command runs with a scrubbed environment, so on Linux the pinned
 * PP_RENDERER_IMAGE must be restored from the verified configuration before
 * the runtime environment gate (src/runtime/environment.ts) is reached.
 */
export async function applyRendererEnvironment(
	config: OwnerConfiguration,
): Promise<void> {
	const pins = z
		.object({ image: z.object({ reference: z.string() }) })
		.parse(
			JSON.parse(
				(
					await readBounded(join(checkout, "docs/runtime/pins.json"))
				).toString(),
			),
		);
	requireOwner(
		config.renderer_image ===
			(process.platform === "linux" ? pins.image.reference : null),
		"IMAGE_PIN_MISMATCH",
	);
	process.env["TZ"] = "UTC";
	process.env["LANG"] = "C.UTF-8";
	process.env["LC_ALL"] = "C.UTF-8";
	process.env["PLAYWRIGHT_BROWSERS_PATH"] = config.browser_root;
	if (config.renderer_image !== null)
		process.env["PP_RENDERER_IMAGE"] = config.renderer_image;
}
export async function safePath(path: string): Promise<void> {
	requireOwner(
		isAbsolute(path) && resolve(path) === path && !path.includes("\0"),
		"UNSAFE_PATH",
	);
	const root = parse(path).root;
	let current = root;
	for (const part of relative(root, path).split("/").filter(Boolean)) {
		current = join(current, part);
		const info = await lstat(current);
		requireOwner(!info.isSymbolicLink(), "SYMLINK_PATH");
	}
}
export async function readBounded(
	path: string,
	limit = 65536,
): Promise<Buffer> {
	await safePath(path);
	return readOpened(path, limit);
}
async function readOpened(path: string, limit: number): Promise<Buffer> {
	const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const info = await file.stat();
		requireOwner(info.isFile() && info.size <= limit, "INPUT_FILE_LIMIT");
		const bytes = Buffer.alloc(limit + 1);
		const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
		requireOwner(bytesRead <= limit, "INPUT_FILE_LIMIT");
		return bytes.subarray(0, bytesRead);
	} finally {
		await file.close();
	}
}
export async function readRequest(): Promise<OwnerRequest> {
	const bytes: Buffer[] = [];
	let size = 0;
	const timeout = setTimeout(() => {
		process.stderr.write('{"error":"STDIN_TIMEOUT"}\n');
		process.exit(1);
	}, 5000);
	try {
		for await (const chunk of process.stdin) {
			const piece = z.instanceof(Buffer).parse(chunk);
			size += piece.length;
			requireOwner(size <= 65536, "STDIN_LIMIT");
			bytes.push(piece);
		}
		return requestSchema.parse(
			JSON.parse(Buffer.concat(bytes).toString("utf8")),
		);
	} finally {
		clearTimeout(timeout);
	}
}
export async function ownedPaths(request: OwnerRequest) {
	const expectedCase: unknown = JSON.parse(
		(await readBounded(join(fixtureDirectory, "case.json"))).toString(),
	);
	requireOwner(
		isDeepStrictEqual(request.case, expectedCase),
		"UNSUPPORTED_CASE",
	);
	requireOwner(
		request.namespace === `${request.run_id}-print-invalid`,
		"NAMESPACE_MISMATCH",
	);
	requireOwner(
		process.env["IE_NAMESPACE"] === request.namespace &&
			process.env["IE_MODE"] === "mock-only" &&
			process.env["IE_SEED"] === String(request.seed) &&
			process.env["IE_CLOCK"] === request.clock &&
			process.env["IE_ARTIFACT_DIR"] === request.artifact_directory,
		"CONTEXT_MISMATCH",
	);
	const home = process.env["HOME"];
	requireOwner(
		home !== undefined && process.env["TMPDIR"] === home,
		"ISOLATION_ROOT_MISMATCH",
	);
	await safePath(home);
	await safePath(request.artifact_directory);
	requireOwner(
		request.artifact_directory === join(home, "artifacts") &&
			home !== parse(home).root &&
			home !== checkout.slice(0, -1) &&
			!checkout.startsWith(home + "/") &&
			!home.startsWith(checkout),
		"UNSAFE_ROOT",
	);
	requireOwner(
		(await lstat(home)).isDirectory() &&
			(await lstat(request.artifact_directory)).isDirectory(),
		"INVALID_ROOT",
	);
	return {
		root: join(request.artifact_directory, `pp-${request.namespace}`),
		marker: {
			owner: "print-production",
			namespace: request.namespace,
			run_id: request.run_id,
			request_sha256: digest(JSON.stringify(request)),
		},
	};
}
export async function sourceReceipt(request: OwnerRequest) {
	const git = async (args: readonly string[]) =>
		(
			await promisify(execFile)("git", [...args], {
				cwd: checkout,
				timeout: 5000,
				maxBuffer: 1048576,
				env: {
					PATH: process.env["PATH"] ?? "",
					HOME: process.env["HOME"] ?? "",
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			})
		).stdout.trim();
	const revision = await git(["rev-parse", "HEAD"]);
	requireOwner(revision === request.component_revision, "REVISION_MISMATCH");
	await git([
		"ls-files",
		"--error-unmatch",
		"scripts/integration-evals/cli.ts",
		"scripts/integration-evals/protocol.ts",
		"tests/fixtures/integration-evals/host.ts",
		"tests/fixtures/integration-evals/v1/supplement.json",
	]);
	const dirty = await git([
		"status",
		"--porcelain",
		"--untracked-files=normal",
	]);
	requireOwner(dirty === "", "DIRTY_CHECKOUT");
	const tree = await git(["rev-parse", "HEAD^{tree}"]);
	return { revision, tree };
}
export async function writeOwned(root: string, name: string, value: unknown) {
	await safePath(root);
	const path = join(root, name);
	const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
	const file = await open(
		path,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await file.writeFile(bytes);
	} finally {
		await file.close();
	}
	return { path, sha256: digest(bytes) };
}
export async function claimRoot(request: OwnerRequest) {
	const paths = await ownedPaths(request);
	await mkdir(paths.root, { mode: 0o700 });
	await writeOwned(paths.root, "owner.json", paths.marker);
	return paths;
}
let cleanupStarted = false;
export async function cleanup(request: OwnerRequest) {
	// cwd is a process-global directory handle. Only this single-purpose CLI
	// process may use it; no restoration through a mutable pathname is attempted.
	requireOwner(
		isMainThread &&
			process.argv[1] === fileURLToPath(new URL("./cli.js", import.meta.url)) &&
			process.argv[2] === "cleanup" &&
			!cleanupStarted,
		"CLEANUP_PROCESS_REQUIRED",
	);
	cleanupStarted = true;
	const { root, marker } = await ownedPaths(request);
	try {
		await safePath(root);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return { status: "absent", namespace: request.namespace, removed: [] };
		throw error;
	}
	const expected = await lstat(root, { bigint: true });
	requireOwner(expected.isDirectory(), "INVALID_OWNED_ROOT");
	process.chdir(root);
	const bound = await lstat(".", { bigint: true });
	requireOwner(
		bound.isDirectory() &&
			bound.dev === expected.dev &&
			bound.ino === expected.ino,
		"OWNED_ROOT_CHANGED",
	);
	let lock: FileHandle;
	try {
		lock = await open(
			".cleanup-lock",
			constants.O_WRONLY |
				constants.O_CREAT |
				constants.O_EXCL |
				constants.O_NOFOLLOW,
			0o600,
		);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			throw new OwnerFailure("CLEANUP_BUSY");
		throw error;
	}
	try {
		const entries = (await readdir(".")).filter((n) => n !== ".cleanup-lock");
		requireOwner(entries.includes("owner.json"), "OWNERSHIP_UNPROVEN");
		const actual: unknown = JSON.parse(
			(await readOpened("owner.json", 65536)).toString(),
		);
		requireOwner(isDeepStrictEqual(actual, marker), "OWNERSHIP_MISMATCH");
		const allowed = new Set([
			"owner.json",
			"state.sqlite",
			"state.sqlite-wal",
			"state.sqlite-shm",
			"mapping.json",
			"trace.json",
			"evaluation.json",
		]);
		requireOwner(entries.length <= allowed.size, "UNOWNED_CLEANUP_ENTRY");
		for (const name of entries) {
			requireOwner(allowed.has(name), "UNOWNED_CLEANUP_ENTRY");
			requireOwner((await lstat(name)).isFile(), "UNSAFE_CLEANUP_ENTRY");
		}
		const removed = entries.filter((n) => n !== "owner.json");
		for (const name of removed) await unlink(name);
		// Retain ownership proof for repeats. Removing the directory via root
		// would re-traverse replaceable ancestors and could remove a foreign root.
		return {
			status: "removed",
			namespace: request.namespace,
			removed,
			retained: ["owner.json"],
		};
	} finally {
		await lock.close();
		await unlink(".cleanup-lock");
	}
}
