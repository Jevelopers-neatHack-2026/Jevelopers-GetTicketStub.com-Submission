import { z } from "zod";
import { parseAsset } from "../assets/private-assets.js";
import {
	imagePlacement,
	recheckPermissions,
	renderSvgWithFonts,
	requirePhysicalTextSize,
	artifactIdentityHash,
	verifyArtifactIdentity,
} from "../composition/private-model.js";
import type {
	CompositionPorts,
	LayoutNode,
	PrivateArtifact,
} from "../composition/private-model.js";
import {
	CompositionError,
	canonical,
	contains,
	digest,
	digestSchema,
	fingerprint,
	freeze,
	overlaps,
	parse,
	transformed,
} from "../composition/primitives.js";
import type { Digest, Rect, Transform } from "../composition/primitives.js";
import {
	compareTemplateCompatibility,
	resolveLayout,
} from "../templates/private-layout.js";
import type { ResolvedConstraints } from "../templates/private-layout.js";
import { layoutText } from "../typography/private-text.js";
import type { TextLayout } from "../typography/private-text.js";

export type Finding = {
	readonly code: string;
	readonly ruleVersion: "private-preflight-2";
	readonly specRevision: string | null;
	readonly severity: "hard_failure" | "repairable" | "warning" | "information";
	readonly state: "failed" | "unknown" | "unsupported" | "passed";
	readonly path: string;
	readonly observed: string | number | null;
	readonly expected: string | number;
	readonly unit: "mm" | "dpi" | "count" | "digest" | "state";
	readonly repairEligible: boolean;
	readonly evidenceRef: string;
};
const checkNames = [
	"dimensions",
	"content",
	"fonts",
	"container",
	"profile",
] as const;
const finalEvidenceSchema = z
	.object({
		format: z.enum(["svg", "png", "pdf"]),
		compositionHash: digestSchema,
		renderHash: digestSchema,
		artifactIdentityHash: digestSchema,
		svgDigest: digestSchema,
		fileDigest: digestSchema,
		parserRevision: z.string().min(1),
		checks: z
			.array(
				z
					.object({
						name: z.enum(checkNames),
						state: z.enum(["passed", "failed", "unknown", "unsupported"]),
						evidenceDigest: digestSchema,
					})
					.strict()
					.readonly(),
			)
			.readonly(),
	})
	.strict()
	.readonly();
export type FinalFileEvidence = z.infer<typeof finalEvidenceSchema> & {
	readonly bindingHash: Digest;
};
function normalizeFileEvidence(
	value: unknown,
): z.infer<typeof finalEvidenceSchema> {
	const file = parse(finalEvidenceSchema, value);
	return freeze({
		...file,
		checks: [...file.checks].sort((a, b) =>
			canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
		),
	});
}
export function finalFileEvidence(value: unknown): FinalFileEvidence {
	const file = normalizeFileEvidence(value);
	return freeze({ ...file, bindingHash: fingerprint(file) });
}
function covers(outer: Rect, t: Transform, inner: Rect): boolean {
	const a = (-t.rotation * Math.PI) / 180;
	return [
		[inner.x, inner.y],
		[inner.x + inner.width, inner.y],
		[inner.x, inner.y + inner.height],
		[inner.x + inner.width, inner.y + inner.height],
	].every(([x = 0, y = 0]) => {
		const px = ((x - t.x) * Math.cos(a) - (y - t.y) * Math.sin(a)) / t.scaleX,
			py = ((x - t.x) * Math.sin(a) + (y - t.y) * Math.cos(a)) / t.scaleY;
		return (
			px >= outer.x - 1e-6 &&
			px <= outer.x + outer.width + 1e-6 &&
			py >= outer.y - 1e-6 &&
			py <= outer.y + outer.height + 1e-6
		);
	});
}
function identifyReport<T extends { readonly findings: readonly Finding[] }>(
	envelope: T,
) {
	return freeze({
		...envelope,
		envelope,
		findingsHash: fingerprint(envelope.findings),
		reportHash: fingerprint(envelope),
	});
}
export function inspectModel(
	artifact: PrivateArtifact,
	constraints: ResolvedConstraints | null,
	files: readonly FinalFileEvidence[] = [],
) {
	const checkedFiles = files
		.map((file) => ({
			...file,
			checks: [...file.checks].sort((a, b) =>
				canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
			),
		}))
		.sort((a, b) =>
			canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0,
		);
	files = checkedFiles;
	const findings: Finding[] = [];
	const { model } = artifact,
		{ layout, input } = model;
	const add = (
		code: string,
		path: string,
		observed: Finding["observed"],
		expected: Finding["expected"],
		unit: Finding["unit"] = "state",
		severity: Finding["severity"] = "hard_failure",
		state: Finding["state"] = "failed",
	) =>
		findings.push({
			code,
			ruleVersion: "private-preflight-2",
			specRevision: constraints?.revision ?? null,
			severity,
			state,
			path,
			observed,
			expected,
			unit,
			repairEligible: severity === "repairable",
			evidenceRef: `evidence-${fingerprint({ code, path, composition: artifact.compositionHash })}`,
		});
	try {
		resolveLayout(layout);
	} catch (error) {
		if (error instanceof CompositionError)
			add(
				"GEOMETRY_INVALID",
				"layout",
				null,
				"valid millimetre geometry",
				"mm",
			);
		else throw error;
	}
	if (
		fingerprint(model) !== artifact.compositionHash ||
		digest(artifact.svg) !== artifact.renderHash
	)
		add(
			"COMPOSITION_INTEGRITY",
			"model",
			artifact.compositionHash,
			fingerprint(model),
			"digest",
		);
	if (
		fingerprint(model.fonts) !==
		fingerprint(artifact.fontBytes.map((f) => f.descriptor))
	)
		add("FONT_INTEGRITY", "fonts", null, "pinned font descriptors", "digest");
	try {
		verifyArtifactIdentity(artifact);
	} catch (error) {
		if (error instanceof CompositionError)
			add(
				"ARTIFACT_IDENTITY",
				error.path,
				null,
				"verified model, source, display and render relationships",
				"digest",
			);
		else throw error;
	}
	const compatibility = compareTemplateCompatibility(
		layout,
		layout,
		constraints,
	);
	for (const reason of compatibility.reasons)
		add(
			reason,
			"constraints",
			compatibility.state,
			"supported",
			"state",
			"hard_failure",
			compatibility.state === "unknown" ? "unknown" : "unsupported",
		);
	if (layout.profile !== "srgb")
		add(
			"PROFILE_UNSUPPORTED",
			"layout.profile",
			layout.profile,
			"srgb",
			"state",
			"hard_failure",
			"unsupported",
		);
	for (const asset of artifact.assets) {
		try {
			const parsed = parseAsset(
				asset.binding,
				Buffer.from(asset.sourceBase64, "base64"),
			);
			if (fingerprint(parsed) !== fingerprint(asset))
				add(
					"ASSET_INTEGRITY",
					`assets.${asset.binding.ref}`,
					asset.renderDigest,
					parsed.renderDigest,
					"digest",
				);
		} catch (error) {
			if (error instanceof CompositionError)
				add(
					error.code,
					`assets.${asset.binding.ref}`,
					null,
					"intact parsed asset",
				);
			else throw error;
		}
		if (asset.color !== "srgb")
			add(
				"ASSET_PROFILE_UNKNOWN",
				`assets.${asset.binding.ref}.profile`,
				asset.color,
				"srgb",
				"state",
				"hard_failure",
				"unknown",
			);
		if (layout.transparency === "forbid" && asset.alpha)
			add(
				"TRANSPARENCY_FORBIDDEN",
				`assets.${asset.binding.ref}.alpha`,
				"present",
				"absent",
			);
	}
	if (
		fingerprint(artifact.sourceArtworkHashes) !==
		fingerprint(
			artifact.assets
				.filter((a) => a.binding.purpose === "artwork")
				.map((a) => a.binding.digest),
		)
	)
		add(
			"SOURCE_ART_INTEGRITY",
			"sourceArtworkHashes",
			null,
			"exact source digest list",
			"digest",
		);
	let bleedCovered = false;
	const contentBounds: { readonly node: LayoutNode; readonly bounds: Rect }[] =
		[];
	const paintBounds: { readonly node: LayoutNode; readonly bounds: Rect }[] =
		[];
	for (const slot of layout.slots) {
		const assigned = input.nodes.filter((n) => n.slot === slot.id && n.visible);
		if (slot.required && assigned.length !== 1)
			add("REQUIRED_SLOT", `slots.${slot.id}`, assigned.length, 1, "count");
	}
	for (const node of input.nodes) {
		if (!node.visible) continue;
		const slot = layout.slots.find((s) => s.id === node.slot);
		if (!slot) {
			add("SLOT_UNKNOWN", `nodes.${node.id}.slot`, node.slot, "declared slot");
			continue;
		}
		let box: Rect;
		switch (node.kind) {
			case "artwork":
			case "overlay": {
				const asset = artifact.assets.find(
					(a) =>
						a.binding.ref === node.asset.ref &&
						a.binding.version === node.asset.version &&
						a.binding.digest === node.asset.digest,
				);
				if (!asset) {
					add(
						"ASSET_MISSING",
						`nodes.${node.id}.asset`,
						node.asset.ref,
						"resolved asset",
					);
					continue;
				}
				try {
					box = imagePlacement(node, asset);
				} catch (error) {
					if (error instanceof CompositionError) {
						add(
							error.code,
							`nodes.${node.id}.placement`,
							null,
							"policy compliant geometry",
						);
						continue;
					}
					throw error;
				}
				const source = node.crop ?? {
					x: 0,
					y: 0,
					width: asset.width,
					height: asset.height,
				};
				const dpi = Math.min(
					source.width / ((box.width * node.transform.scaleX) / 25.4),
					source.height / ((box.height * node.transform.scaleY) / 25.4),
				);
				if (
					asset.mime === "image/png" &&
					dpi < Math.max(layout.minDpi, constraints?.minDpi ?? 0)
				)
					add(
						"DPI_LOW",
						`nodes.${node.id}.dpi`,
						dpi,
						Math.max(layout.minDpi, constraints?.minDpi ?? 0),
						"dpi",
					);
				if (
					node.kind === "artwork" &&
					!asset.alpha &&
					node.opacity === 1 &&
					node.blend === "normal" &&
					covers(box, node.transform, layout.bleed) &&
					(!node.clip || covers(node.clip, node.transform, layout.bleed)) &&
					(node.fit !== "cover" ||
						covers(node.box, node.transform, layout.bleed))
				)
					bleedCovered = true;
				if (node.fit === "cover") box = node.box;
				break;
			}
			case "text": {
				try {
					requirePhysicalTextSize(node, slot.minFontMm, slot.maxFontMm);
				} catch (error) {
					if (error instanceof CompositionError)
						add(
							"TEXT_SIZE_POLICY",
							error.path,
							node.field.sizeMm * node.transform.scaleY,
							`uniform physical size ${slot.minFontMm}..${slot.maxFontMm}`,
							"mm",
						);
					else throw error;
				}
				const text = artifact.texts.find(
					(t) =>
						t.field.fieldRef === node.field.fieldRef &&
						t.field.rowRef === node.field.rowRef,
				);
				let fresh: TextLayout;
				try {
					fresh = layoutText(node.field, artifact.fontBytes);
				} catch (error) {
					if (error instanceof CompositionError) {
						add(
							error.code,
							`fields.${node.field.rowRef}.${node.field.fieldRef}`,
							null,
							"intact pinned font",
						);
						continue;
					}
					throw error;
				}
				if (!text || fingerprint(fresh) !== fingerprint(text))
					add(
						"TEXT_INTEGRITY",
						`fields.${node.field.rowRef}.${node.field.fieldRef}`,
						null,
						"exact source, format, glyphs and bounds",
						"digest",
					);
				if (fresh.state === "blocked") {
					add(
						fresh.code,
						`fields.${node.field.rowRef}.${node.field.fieldRef}`,
						null,
						"measured exact text",
					);
					continue;
				}
				if (fresh.overflow)
					add(
						"TEXT_OVERFLOW",
						`nodes.${node.id}.text`,
						fresh.bounds.width,
						node.field.bounds.width,
						"mm",
						"repairable",
					);
				if (node.opacity !== 1 || node.clip || node.blend !== "normal")
					add(
						"EXACT_TEXT_VISIBILITY",
						`nodes.${node.id}.text`,
						node.opacity,
						"opaque unclipped normal text",
					);
				box = fresh.bounds;
				break;
			}
			case "shape":
				box = {
					x: node.box.x - node.strokeWidth / 2,
					y: node.box.y - node.strokeWidth / 2,
					width: node.box.width + node.strokeWidth,
					height: node.box.height + node.strokeWidth,
				};
				break;
			case "guide":
				continue;
			default: {
				const unreachable: never = node;
				return unreachable;
			}
		}
		const world = transformed(box, node.transform);
		paintBounds.push({ node, bounds: world });
		if (node.clip && !contains(node.clip, box))
			add(
				"CONTENT_CLIPPED",
				`nodes.${node.id}.clip`,
				null,
				"full content coverage",
			);
		if (!contains(slot.bounds, world))
			add(
				"SLOT_BOUNDS",
				`nodes.${node.id}.bounds`,
				null,
				"slot bounds",
				"mm",
				node.kind === "text" ? "repairable" : "hard_failure",
			);
		if (node.kind === "text" || node.kind === "overlay") {
			if (!contains(layout.safe, world))
				add(
					"SAFE_BOUNDS",
					`nodes.${node.id}.safe`,
					null,
					"safe rectangle",
					"mm",
					node.kind === "text" ? "repairable" : "hard_failure",
				);
			contentBounds.push({ node, bounds: world });
		}
		if (node.kind === "shape") contentBounds.push({ node, bounds: world });
		if (node.opacity < 1)
			add(
				"LAYER_OPACITY",
				`nodes.${node.id}.opacity`,
				node.opacity,
				1,
				"state",
				"warning",
			);
	}
	for (const target of paintBounds) {
		const required =
			(target.node.kind === "text" && target.node.field.required) ||
			(target.node.kind !== "artwork" &&
				layout.slots.some((s) => s.id === target.node.slot && s.required));
		if (!required) continue;
		for (const cover of paintBounds) {
			if (
				cover.node.order <= target.node.order ||
				cover.node.opacity === 0 ||
				!overlaps(target.bounds, cover.bounds)
			)
				continue;
			add(
				"CONTENT_OCCLUSION",
				`nodes.${target.node.id}.visibility`,
				cover.node.id,
				"no intersecting later paint over required content",
				"state",
				"hard_failure",
				"unsupported",
			);
		}
	}
	if (!bleedCovered)
		add(
			"BLEED_COVERAGE",
			"layout.bleed",
			null,
			"opaque approved art covers all bleed corners",
			"mm",
		);
	try {
		if (
			renderSvgWithFonts(
				model,
				artifact.assets,
				artifact.texts,
				artifact.fontBytes,
			) !== artifact.svg
		)
			add(
				"DISPLAY_INTEGRITY",
				"svg",
				artifact.renderHash,
				"render of exact measured content",
				"digest",
			);
	} catch (error) {
		if (error instanceof CompositionError)
			add(error.code, "svg", null, "complete render");
		else throw error;
	}
	const duplicateFiles =
		new Set(files.map((f) => f.format)).size !== files.length;
	if (duplicateFiles)
		add(
			"EXPORT_DUPLICATE",
			"files",
			files.length,
			"one evidence record per format",
			"count",
		);
	for (const format of layout.exports) {
		const file = files.find((f) => f.format === format);
		if (!file) {
			add(
				"EXPORT_MISSING",
				`files.${format}`,
				null,
				"independently inspected file",
				"state",
				"hard_failure",
				"unknown",
			);
			continue;
		}
		let bindingValid = false;
		try {
			const { bindingHash, ...payload } = file;
			bindingValid =
				fingerprint(normalizeFileEvidence(payload)) === bindingHash;
		} catch (error) {
			if (!(error instanceof CompositionError)) throw error;
		}
		if (
			file.compositionHash !== artifact.compositionHash ||
			file.renderHash !== artifact.renderHash ||
			file.artifactIdentityHash !== artifactIdentityHash(artifact) ||
			file.svgDigest !== digest(artifact.svg) ||
			!bindingValid ||
			(file.format === "svg" && file.fileDigest !== file.svgDigest)
		)
			add(
				"EXPORT_BINDING",
				`files.${format}`,
				file.compositionHash,
				artifact.compositionHash,
				"digest",
			);
		for (const name of new Set([
			...checkNames,
			...(constraints?.requiredChecks ?? []),
		])) {
			const checks = file.checks.filter((c) => c.name === name);
			if (checks.length !== 1 || checks[0]?.state !== "passed")
				add(
					"EXPORT_CHECK",
					`files.${format}.${name}`,
					checks[0]?.state ?? null,
					"passed",
					"state",
					"hard_failure",
					checks[0]?.state ?? "unknown",
				);
		}
	}
	if (
		artifact.texts.some(
			(t) => t.state === "measured" && t.fontDecision === "approved-fallback",
		)
	)
		add(
			"APPROVED_FONT_FALLBACK",
			"fonts",
			"approved-fallback",
			"pinned order",
			"state",
			"information",
			"passed",
		);
	findings.sort((a, b) =>
		a.path < b.path
			? -1
			: a.path > b.path
				? 1
				: a.code < b.code
					? -1
					: a.code > b.code
						? 1
						: 0,
	);
	const modelReady = !findings.some(
		(f) =>
			!f.path.startsWith("files") &&
			(f.severity === "hard_failure" ||
				f.severity === "repairable" ||
				(f.severity === "warning" &&
					!layout.allowedWarnings.some((w) => w === f.code))),
	);
	const filesReady = !findings.some((f) => f.path.startsWith("files"));
	const normalizedConstraints = constraints
		? {
				...constraints,
				profiles: [...constraints.profiles].sort(),
				exports: [...constraints.exports].sort(),
				fonts: [...constraints.fonts].sort(),
				requiredChecks: [...constraints.requiredChecks].sort(),
			}
		: null;
	const policy = {
		layout,
		inputPolicyRevision: input.inputPolicyRevision,
		rendererRevision: input.rendererRevision,
	};
	return identifyReport({
		reportVersion: 2 as const,
		ruleVersion: "private-preflight-2" as const,
		compositionHash: artifact.compositionHash,
		renderHash: artifact.renderHash,
		revision: artifact.revision,
		artifactIdentityHash: artifactIdentityHash(artifact),
		sourceArtworkHashes: artifact.sourceArtworkHashes,
		constraints: normalizedConstraints,
		constraintHash: fingerprint(normalizedConstraints),
		policy,
		policyHash: fingerprint(policy),
		checkedFiles,
		findings,
		modelReady,
		filesReady,
		draftReady: modelReady && filesReady,
		productionEligibility: "unknown" as const,
		handoffEligible: false as const,
		currentPermission: "unchecked" as const,
		contentBounds,
	});
}
export async function inspectArtifact(
	artifact: PrivateArtifact,
	constraints: ResolvedConstraints | null,
	ports: CompositionPorts,
	now: number,
	files: readonly FinalFileEvidence[] = [],
) {
	const report = inspectModel(artifact, constraints, files);
	try {
		await recheckPermissions(artifact, ports, "inspect", now);
		return identifyReport({
			...report.envelope,
			currentPermission: "allowed" as const,
		});
	} catch (error) {
		if (error instanceof CompositionError) {
			const finding: Finding = {
				code: "CURRENT_PERMISSION_BLOCKED",
				ruleVersion: "private-preflight-2",
				specRevision: constraints?.revision ?? null,
				severity: "hard_failure",
				state: "unknown",
				path: "permissions",
				observed: null,
				expected: "current applicable external permission",
				unit: "state",
				repairEligible: false,
				evidenceRef: `evidence-${artifact.compositionHash}`,
			};
			const findings = [...report.findings, finding].sort((a, b) =>
				a.path < b.path ? -1 : a.path > b.path ? 1 : a.code < b.code ? -1 : 1,
			);
			return identifyReport({
				...report.envelope,
				findings,
				modelReady: false,
				draftReady: false,
				currentPermission: "blocked" as const,
			});
		}
		throw error;
	}
}
