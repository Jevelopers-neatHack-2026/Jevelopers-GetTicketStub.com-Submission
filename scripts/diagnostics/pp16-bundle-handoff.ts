import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { verifyProductionBundleFiles } from "@jevelopers/shared-contracts/production-operations";

export interface CorpusFile {
	readonly name: string;
	readonly bytes: Uint8Array;
}
export interface InventoryEntry {
	readonly name: string;
	readonly length: number;
	readonly sha256: string;
}
export interface Variant {
	readonly id: string;
	readonly description: string;
	readonly files: readonly CorpusFile[];
	readonly expected: "accepted" | "rejected";
	readonly expectedProblems: readonly string[];
}

// Files that describe the payloads rather than being payloads themselves.
const controls = new Set([
	"manifest.json",
	"archive.zip",
	"detached.json",
	"trusted-commitment.json",
]);
const byName = (a: { name: string }, b: { name: string }) =>
	a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const sha256 = (bytes: Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

export function inventoryOf(files: readonly CorpusFile[]): InventoryEntry[] {
	return [...files].sort(byName).map((f) => ({
		name: f.name,
		length: f.bytes.byteLength,
		sha256: sha256(f.bytes),
	}));
}

// Independent byte-level reference check against a pinned inventory:
// exact roster, exact lengths, exact SHA-256. Returns sorted problem codes.
export function referenceCheck(
	files: readonly CorpusFile[],
	pinned: readonly InventoryEntry[],
): string[] {
	const problems: string[] = [];
	const seen = new Map(files.map((f) => [f.name, f]));
	if (seen.size !== files.length) problems.push("duplicate-name");
	for (const entry of pinned) {
		const file = seen.get(entry.name);
		if (!file) problems.push(`missing:${entry.name}`);
		else if (
			file.bytes.byteLength !== entry.length ||
			sha256(file.bytes) !== entry.sha256
		)
			problems.push(`hash-mismatch:${entry.name}`);
	}
	const known = new Set(pinned.map((e) => e.name));
	for (const file of files)
		if (!known.has(file.name)) problems.push(`extra:${file.name}`);
	return problems.sort();
}

const flipped = (file: CorpusFile): CorpusFile => {
	const bytes = Uint8Array.from(file.bytes);
	const last = bytes.byteLength - 1;
	bytes[last] = (bytes[last] ?? 0) ^ 0x01;
	return { name: file.name, bytes };
};

// Variants derive from, and never mutate, the baseline files.
export function buildVariants(baseline: readonly CorpusFile[]): Variant[] {
	const sorted = [...baseline].sort(byName);
	const payload = sorted.find((f) => !controls.has(f.name));
	const manifest = sorted.find((f) => f.name === "manifest.json");
	const detached = sorted.find((f) => f.name === "detached.json");
	if (!payload || !manifest || !detached || payload.bytes.byteLength === 0)
		throw new Error("Baseline lacks a payload, manifest or detached file.");
	const replace = (target: CorpusFile) =>
		sorted.map((f) => (f.name === target.name ? flipped(f) : f));
	const without = (name: string) => sorted.filter((f) => f.name !== name);
	return [
		{
			id: "valid",
			description: "Unmodified pipeline bytes.",
			files: sorted,
			expected: "accepted",
			expectedProblems: [],
		},
		{
			id: "tampered-payload",
			description: `Last byte of ${payload.name} flipped.`,
			files: replace(payload),
			expected: "rejected",
			expectedProblems: [`hash-mismatch:${payload.name}`],
		},
		{
			id: "tampered-manifest",
			description: "Last byte of manifest.json flipped.",
			files: replace(manifest),
			expected: "rejected",
			expectedProblems: ["hash-mismatch:manifest.json"],
		},
		{
			id: "tampered-detached",
			description: "Last byte of detached.json flipped.",
			files: replace(detached),
			expected: "rejected",
			expectedProblems: ["hash-mismatch:detached.json"],
		},
		{
			id: "missing-payload",
			description: `${payload.name} removed.`,
			files: without(payload.name),
			expected: "rejected",
			expectedProblems: [`missing:${payload.name}`],
		},
		{
			id: "missing-manifest",
			description: "manifest.json removed.",
			files: without("manifest.json"),
			expected: "rejected",
			expectedProblems: ["missing:manifest.json"],
		},
		{
			id: "extra-file",
			description: "Unlisted extra.bin added with fixed synthetic bytes.",
			files: [
				...sorted,
				{ name: "extra.bin", bytes: new TextEncoder().encode("pp16-extra") },
			],
			expected: "rejected",
			expectedProblems: ["extra:extra.bin"],
		},
	];
}

const limitations = [
	"Synthetic fixture: no customer, supplier or real event data.",
	"Unapproved: accepted:false shared-contracts candidate; no approval, rights, supplier, product or order authority is established.",
	"Ineligible: handoffEligible is false; supplier eligibility is LEGACY_UNREPRESENTABLE/blocked in the candidate.",
	"canonical_usage_intake is unavailable, finance_receipt is null and usage_refs is empty; no usage or finance evidence exists.",
	"Diagnostic evidence for bounded offline byte inspection only. Not an approved-package conformance fixture.",
];
const linuxOnly =
	"Bytes are authoritative only when produced by the Linux CI runtime workflow in the digest-pinned renderer image.";

const scopeSchema = z.object({
	tenant_id: z.string(),
	project_id: z.string(),
	usage_refs: z.array(z.unknown()),
	schema_version: z.string(),
	bundle_id: z.string(),
	bundle_hash: z.string(),
});
const lineageSchema = z.object({
	accepted: z.literal(false),
	live_integration: z.literal(false),
	canonical_usage_intake: z.literal("unavailable"),
	finance_receipt: z.null(),
});
const commitmentSchema = z.object({
	eligibility: z.object({ handoff_eligible: z.literal(false) }),
});

export interface CorpusInput {
	readonly bundle: readonly CorpusFile[];
	readonly revision: string;
}
type Owner = (
	files: readonly CorpusFile[],
	scope: { tenant_id: string; project_id: string },
	commitment: unknown,
) => { ok: boolean; detail: string };

export function buildCorpus(
	input: CorpusInput,
	pin: unknown,
	owner: Owner,
	runtime: { node: string; platform: string },
) {
	const find = (name: string) => {
		const file = input.bundle.find((f) => f.name === name);
		if (!file) throw new Error(`Bundle lacks ${name}.`);
		return JSON.parse(Buffer.from(file.bytes).toString("utf8")) as unknown;
	};
	const manifest = scopeSchema.parse(find("manifest.json"));
	lineageSchema.parse(find("lineage.json"));
	const commitment = commitmentSchema.parse(find("trusted-commitment.json"));
	if (manifest.usage_refs.length !== 0)
		throw new Error("usage_refs must be empty.");
	// The trusted commitment is a control for the owner verifier, not a payload.
	const pinnedFiles = input.bundle.filter(
		(f) => f.name !== "trusted-commitment.json",
	);
	const pinned = inventoryOf(pinnedFiles);
	const scope = {
		tenant_id: manifest.tenant_id,
		project_id: manifest.project_id,
	};
	const results = buildVariants(pinnedFiles).map((variant) => {
		const problems = referenceCheck(variant.files, pinned);
		const verdict = owner(variant.files, scope, commitment);
		const referenceMatches =
			JSON.stringify(problems) === JSON.stringify(variant.expectedProblems);
		const ownerMatches = verdict.ok === (variant.expected === "accepted");
		return {
			id: variant.id,
			description: variant.description,
			expected: variant.expected,
			expectedProblems: variant.expectedProblems,
			referenceProblems: problems,
			ownerVerifier: verdict,
			inventory: inventoryOf(variant.files),
			conforms: referenceMatches && ownerMatches,
		};
	});
	return {
		corpus: "pp16-bundle-handoff-diagnostic",
		corpus_version: 1,
		synthetic: true,
		accepted: false,
		handoffEligible: false,
		canonical_usage_intake: "unavailable",
		finance_receipt: null,
		usage_refs: [],
		production_revision: input.revision,
		shared_contracts_pin: pin,
		manifest: {
			schema_version: manifest.schema_version,
			bundle_id: manifest.bundle_id,
			bundle_hash: manifest.bundle_hash,
		},
		runtime,
		provenance: linuxOnly,
		baseline_inventory: pinned,
		variants: results,
		blocked_variants: [
			{
				id: "stale-spec",
				blocked:
					"Needs a second genuine supplier specification revision; none exists. Not fabricated.",
			},
			{
				id: "approved-valid",
				blocked:
					"Needs application-issued approval binding, accepted shared-contracts mapping and supplier spec; see fulfillment-connectors#10.",
			},
		],
		limitations,
		conforms: results.every((r) => r.conforms),
		eligibility_recorded: commitment.eligibility,
	};
}

const ownerVerify: Owner = (files, scope, commitment) => {
	const result = verifyProductionBundleFiles(
		files.map((f) => ({ filename: f.name, bytes: f.bytes })),
		// Branded owner types; the verifier itself rejects malformed values.
		{ scope: scope as never, trusted_commitment: commitment as never },
	);
	if (!result.ok)
		return {
			ok: false,
			detail: result.errors.map((e) => e.code).join(","),
		};
	return {
		ok: result.value.integrity === "passed",
		detail: `integrity=${result.value.integrity};eligibility=${result.value.eligibility}`,
	};
};

async function readDirectory(directory: string): Promise<CorpusFile[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((e) => e.isFile())
			.map(async (e) => ({
				name: e.name,
				bytes: await readFile(join(directory, e.name)),
			})),
	);
}

async function main(outDirectory: string) {
	if (process.platform !== "linux")
		throw new Error(
			"The PP-16 corpus is only produced from Linux CI renderer bytes.",
		);
	const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
	const out = resolve(outDirectory);
	const bundle = await readDirectory(join(out, "bundle"));
	const revision =
		process.env["GITHUB_SHA"] ??
		(await promisify(execFile)("git", ["rev-parse", "HEAD"])).stdout.trim();
	const pin = JSON.parse(
		await readFile(join(root, "vendor/shared-contracts/candidate-pin.json"), {
			encoding: "utf8",
		}),
	) as unknown;
	const corpus = buildCorpus({ bundle, revision }, pin, ownerVerify, {
		node: process.version,
		platform: process.platform,
	});
	const variantsRoot = join(out, "variants");
	await rm(variantsRoot, { recursive: true, force: true });
	const pinnedFiles = bundle.filter(
		(f) => f.name !== "trusted-commitment.json",
	);
	for (const variant of buildVariants(pinnedFiles)) {
		const directory = join(variantsRoot, variant.id);
		await mkdir(directory, { recursive: true });
		for (const file of variant.files)
			await writeFile(join(directory, file.name), file.bytes);
	}
	await writeFile(
		join(out, "CORPUS.json"),
		`${JSON.stringify(corpus, null, 2)}\n`,
	);
	if (!corpus.conforms) {
		console.error("PP-16 variants did not produce their expected outcomes.");
		process.exitCode = 1;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const target = process.argv[2];
	if (!target) throw new Error("Usage: pp16-bundle-handoff <out-directory>");
	await main(target);
}
