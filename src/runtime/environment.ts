import { readFile, readlink, readdir, statfs } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { arch, platform, release } from "node:os";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { requireCheck, VerificationFailure } from "./errors.js";
import { readResource, resource, sha256 } from "./resources.js";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pinsSchema = z
	.object({
		node: z.string(),
		npm: z.string(),
		icu: z.string(),
		unicode: z.string(),
		cldr: z.string(),
		locale: z.literal("en-US"),
		timezone: z.literal("UTC"),
		tools: z.record(
			z.enum([
				"typescript",
				"@biomejs/biome",
				"playwright",
				"playwright-core",
				"@fontsource/noto-sans",
				"fontkit",
				"pdf-lib",
				"pdfjs-dist",
				"pngjs",
				"zod",
				"@types/node",
				"@types/fontkit",
				"@types/pngjs",
			]),
			z.string().regex(/^\d+\.\d+\.\d+$/),
		),
		browser: z
			.object({
				revision: z.string(),
				version: z.string(),
				executableSha256: z.object({ darwin: hash, linux: hash }).strict(),
				linuxArchiveSha256: hash,
				linuxArchiveUrl: z.string().url(),
			})
			.strict(),
		image: z
			.object({
				reference: z.string(),
				registry: z.string(),
				manifestDigest: z.string(),
				configDigest: z.string(),
			})
			.strict(),
		local: z
			.object({
				platform: z.literal("darwin"),
				arch: z.literal("arm64"),
				osRelease: z.string(),
				osVersion: z.string(),
			})
			.strict(),
		font: z
			.object({
				file: z.string(),
				sha256: hash,
				license: z.string(),
				licenseSha256: hash,
				package: z.string(),
				version: z.string(),
				source: z.string(),
				upstream: z.string(),
			})
			.strict(),
		nodeArchives: z.record(z.string(), hash),
	})
	.strict();
export type RuntimePins = z.infer<typeof pinsSchema>;

export function parsePins(value: unknown): RuntimePins {
	const parsed = pinsSchema.safeParse(value);
	if (!parsed.success)
		throw new VerificationFailure(
			"TOOL_PIN_MISMATCH",
			"Runtime pins are missing or malformed.",
		);
	return parsed.data;
}

export async function loadPins(): Promise<RuntimePins> {
	try {
		return parsePins(
			JSON.parse((await readResource("docs/runtime/pins.json")).toString()),
		);
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		if (error instanceof Error)
			throw new VerificationFailure(
				"TOOL_PIN_MISMATCH",
				"Runtime pin file is missing or invalid.",
			);
		throw error;
	}
}

const packageMetadata = z.object({ version: z.string() });
const browserMetadata = z.object({
	browsers: z.array(
		z.object({
			name: z.string(),
			revision: z.string(),
			browserVersion: z.string().optional(),
		}),
	),
});

const namespaceId = z.string().regex(/^(ipc|net):\[\d+\]$/);
const linuxSecuritySchema = z.object({
	uid: z.number().int().positive(),
	gid: z.number().int().positive(),
	status: z.string(),
	apparmor: z.literal("docker-default (enforce)"),
	ipc: namespaceId,
	net: namespaceId,
	host: z.object({ ipc: namespaceId, net: namespaceId }),
	interfaces: z.array(z.string()),
	shmBytes: z.number().int().min(1073741824),
	shmType: z.literal(0x01021994),
});

export function requireLinuxContainerSecurity(value: unknown) {
	const parsed = linuxSecuritySchema.safeParse(value);
	requireCheck(
		parsed.success,
		"CONTAINER_POLICY_FAILURE",
		"Required Linux container security observations are missing or invalid.",
	);
	const observed = parsed.data;
	const field = (name: string) =>
		new RegExp(`^${name}:[ \\t]*(.+)$`, "m").exec(observed.status)?.[1]?.trim();
	const uids = field("Uid")?.split(/\s+/).map(Number);
	const gids = field("Gid")?.split(/\s+/).map(Number);
	const filters = Number(field("Seccomp_filters"));
	requireCheck(
		uids?.length === 4 &&
			uids.every((id) => id === observed.uid) &&
			gids?.length === 4 &&
			gids.every((id) => id === observed.gid) &&
			["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"].every((name) =>
				/^0+$/.test(field(name) ?? ""),
			) &&
			field("NoNewPrivs") === "1" &&
			field("Seccomp") === "2" &&
			Number.isInteger(filters) &&
			filters >= 1 &&
			observed.ipc.startsWith("ipc:") &&
			observed.host.ipc.startsWith("ipc:") &&
			observed.net.startsWith("net:") &&
			observed.host.net.startsWith("net:") &&
			observed.ipc !== observed.host.ipc &&
			observed.net !== observed.host.net &&
			observed.interfaces.length === 1 &&
			observed.interfaces[0] === "lo",
		"CONTAINER_POLICY_FAILURE",
		"Linux requires non-root, zero capabilities, enforced security filters, private IPC and isolated networking.",
	);
	return {
		uid: observed.uid,
		gid: observed.gid,
		capabilities: "none" as const,
		noNewPrivileges: true,
		seccomp: "filter" as const,
		apparmor: observed.apparmor,
		ipcNamespace: observed.ipc,
		networkNamespace: observed.net,
		hostNamespaces: observed.host,
		interfaces: observed.interfaces,
		shmBytes: observed.shmBytes,
	};
}

export async function observeLinuxContainerSecurity() {
	try {
		const [status, apparmor, ipc, net, host, interfaces, shm] =
			await Promise.all([
				readFile("/proc/self/status", "utf8"),
				readFile("/proc/self/attr/current", "utf8"),
				readlink("/proc/self/ns/ipc"),
				readlink("/proc/self/ns/net"),
				readFile("/run/pp-security/host-namespaces.json", "utf8"),
				readdir("/sys/class/net"),
				statfs("/dev/shm"),
			]);
		return requireLinuxContainerSecurity({
			uid: process.getuid?.(),
			gid: process.getgid?.(),
			status,
			apparmor: apparmor.trim(),
			ipc,
			net,
			host: JSON.parse(host),
			interfaces,
			shmBytes: shm.blocks * shm.bsize,
			shmType: shm.type,
		});
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		if (error instanceof Error)
			throw new VerificationFailure(
				"CONTAINER_POLICY_FAILURE",
				"Required Linux security state could not be observed.",
			);
		throw error;
	}
}

export async function assertEnvironment() {
	const pins = await loadPins();
	requireCheck(
		process.versions.node === pins.node,
		"ENVIRONMENT_PIN_MISMATCH",
		"Exact Node patch is required.",
	);
	const npmPath = resolve(
		dirname(process.execPath),
		"../lib/node_modules/npm/package.json",
	);
	const npmVersion = packageMetadata.parse(
		JSON.parse(await readFile(npmPath, "utf8")),
	).version;
	const agent = process.env["npm_config_user_agent"];
	requireCheck(
		npmVersion === pins.npm &&
			(agent === undefined || agent.startsWith(`npm/${pins.npm} `)),
		"ENVIRONMENT_PIN_MISMATCH",
		"Exact bundled npm is required.",
	);
	requireCheck(
		process.versions["icu"] === pins.icu &&
			process.versions["unicode"] === pins.unicode &&
			process.versions["cldr"] === pins.cldr,
		"ENVIRONMENT_PIN_MISMATCH",
		"ICU, Unicode and CLDR pins are required.",
	);
	requireCheck(
		process.env["TZ"] === "UTC" &&
			process.env["LANG"] === "C.UTF-8" &&
			process.env["LC_ALL"] === "C.UTF-8",
		"ENVIRONMENT_PIN_MISMATCH",
		"TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 are required.",
	);
	const tools: Record<string, string> = {};
	for (const [name, expected] of Object.entries(pins.tools)) {
		const version = packageMetadata.parse(
			JSON.parse(
				(await readResource(`node_modules/${name}/package.json`)).toString(),
			),
		).version;
		requireCheck(
			version === expected,
			"TOOL_PIN_MISMATCH",
			"A dependency version differs from its exact pin.",
		);
		tools[name] = version;
	}
	const browsers = browserMetadata.parse(
		JSON.parse(
			await readFile(
				resource("node_modules/playwright-core/browsers.json"),
				"utf8",
			),
		),
	);
	const chromium = browsers.browsers.find((item) => item.name === "chromium");
	requireCheck(
		chromium?.revision === pins.browser.revision &&
			chromium.browserVersion === pins.browser.version,
		"BROWSER_PIN_MISMATCH",
		"Chromium revision and version must match.",
	);
	let profile: "local-macos" | "pinned-linux-ci";
	let osVersion: string;
	let containerSecurity: Awaited<
		ReturnType<typeof observeLinuxContainerSecurity>
	> | null = null;
	switch (platform()) {
		case "darwin":
			osVersion = execFileSync("/usr/bin/sw_vers", ["-productVersion"], {
				encoding: "utf8",
			}).trim();
			requireCheck(
				arch() === pins.local.arch &&
					release() === pins.local.osRelease &&
					osVersion === pins.local.osVersion,
				"ENVIRONMENT_PIN_MISMATCH",
				"macOS calibration profile differs from its recorded pin.",
			);
			profile = "local-macos";
			break;
		case "linux": {
			const os = await readFile("/etc/os-release", "utf8");
			requireCheck(
				arch() === "x64" &&
					/^ID=ubuntu$/m.test(os) &&
					/^VERSION_ID="24.04"$/m.test(os) &&
					process.env["PP_RENDERER_IMAGE"] === pins.image.reference,
				"ENVIRONMENT_PIN_MISMATCH",
				"Linux requires the pinned amd64 Noble runner image.",
			);
			osVersion = "Ubuntu 24.04";
			profile = "pinned-linux-ci";
			containerSecurity = await observeLinuxContainerSecurity();
			break;
		}
		default:
			throw new VerificationFailure(
				"ENVIRONMENT_PIN_MISMATCH",
				"This OS has no accepted calibration profile.",
			);
	}
	return {
		pins,
		receipt: {
			profile,
			node: process.versions.node,
			npm: npmVersion,
			icu: process.versions["icu"],
			unicode: process.versions["unicode"],
			cldr: process.versions["cldr"],
			platform: platform(),
			arch: arch(),
			osRelease: release(),
			osVersion,
			locale: pins.locale,
			timezone: pins.timezone,
			environmentLocale: "C.UTF-8",
			image: profile === "pinned-linux-ci" ? pins.image.reference : null,
			containerSecurity,
			tools,
			packageLockSha256: sha256(await readResource("package-lock.json")),
		},
	};
}
