import { z } from "zod";
import {
	composeArtifact,
	recheckPermissions,
	requirePhysicalTextSize,
} from "../composition/private-model.js";
import type {
	CompositionPorts,
	LayoutNode,
	PrivateArtifact,
} from "../composition/private-model.js";
import {
	CompositionError,
	contains,
	coordinateSchema,
	digestSchema,
	fingerprint,
	freeze,
	overlaps,
	parse,
	positiveSchema,
	precise,
	refSchema,
	requireCore,
	revisionSchema,
	transformed,
} from "../composition/primitives.js";
import type { Digest } from "../composition/primitives.js";
import {
	inspectArtifact,
	inspectModel,
} from "../preflight/private-inspection.js";
import type { FinalFileEvidence } from "../preflight/private-inspection.js";
import type { ResolvedConstraints } from "../templates/private-layout.js";
import { layoutText } from "../typography/private-text.js";

const fieldPolicySchema = z
	.object({
		node: refSchema,
		minSize: positiveSchema,
		maxSize: positiveSchema,
		step: positiveSchema,
		maxAttempts: z.number().int().min(1).max(32),
		maxMoveMm: coordinateSchema.refine((v) => v >= 0),
		fallbackOrder: z.array(refSchema).max(16).readonly(),
		allowNormalize: z.boolean(),
	})
	.strict()
	.readonly();
const policySchema = z
	.object({
		revision: revisionSchema,
		permissionRef: refSchema,
		permission: z.enum(["none", "mechanical"]),
		maxTotalAttempts: z.number().int().min(1).max(32),
		fields: z.array(fieldPolicySchema).max(256).readonly(),
	})
	.strict()
	.readonly();
export type RepairPolicy = z.infer<typeof policySchema>;
export function resolveRepairPolicy(value: unknown): RepairPolicy {
	const policy = parse(policySchema, value);
	if (
		new Set(policy.fields.map((f) => f.node)).size !== policy.fields.length ||
		policy.fields.some((f) => f.minSize > f.maxSize)
	)
		throw new CompositionError("INVALID_INPUT", "repair.policy");
	return policy;
}
export type RepairRequest =
	| { readonly kind: "shrink"; readonly node: string }
	| {
			readonly kind: "reposition";
			readonly node: string;
			readonly x: number;
			readonly y: number;
	  }
	| { readonly kind: "fallback"; readonly node: string }
	| { readonly kind: "normalize"; readonly node: string }
	| { readonly kind: "material"; readonly node: string };
export type RepairPlan = {
	readonly state: "PLANNED";
	readonly id: Digest;
	readonly precondition: Digest;
	readonly compositionPrecondition: Digest;
	readonly policyHash: Digest;
	readonly policyRevision: string;
	readonly permissionRef: string;
	readonly findingCodes: readonly string[];
	readonly request: RepairRequest;
	readonly affectedNode: string;
	readonly affectedFields: readonly string[];
	readonly before: LayoutNode;
	readonly after: LayoutNode;
	readonly bounds: RepairPolicy["fields"][number];
	readonly attempts: number;
	readonly reason: string;
};
export type RepairPermissionRequest = {
	readonly plan: RepairPlan;
	readonly result: PrivateArtifact;
	readonly now: number;
};
export type RepairPorts = CompositionPorts & {
	readonly repairPermission: (
		request: RepairPermissionRequest,
	) => Promise<unknown>;
};
const repairDecisionSchema = z
	.object({
		state: z.enum(["allowed", "denied", "unknown", "revoked"]),
		planHash: digestSchema,
		policyHash: digestSchema,
		precondition: digestSchema,
		result: digestSchema,
		permissionRef: refSchema,
		validUntil: z.number().int().nonnegative(),
	})
	.strict()
	.readonly();
export type ReviewResult = {
	readonly state: "NEEDS_EXTERNAL_REVIEW";
	readonly reasons: readonly string[];
	readonly original: PrivateArtifact;
};
const review = (
	original: PrivateArtifact,
	...reasons: string[]
): ReviewResult =>
	freeze({ state: "NEEDS_EXTERNAL_REVIEW", reasons, original });
export function planRepair(
	artifact: PrivateArtifact,
	policy: RepairPolicy,
	request: RepairRequest,
): RepairPlan | ReviewResult {
	const before = artifact.model.input.nodes.find((n) => n.id === request.node),
		bounds = policy.fields.find((f) => f.node === request.node);
	if (policy.permission !== "mechanical" || !before || !bounds)
		return review(artifact, "REPAIR_PERMISSION_MISSING");
	const slot = artifact.model.layout.slots.find((s) => s.id === before.slot);
	if (!slot) return review(artifact, "REPAIR_SLOT_UNKNOWN");
	if (before.kind === "text") {
		try {
			requirePhysicalTextSize(
				before,
				Math.max(slot.minFontMm, bounds.minSize),
				Math.min(slot.maxFontMm, bounds.maxSize),
			);
		} catch (error) {
			if (error instanceof CompositionError)
				return review(artifact, "SIZE_POLICY_BOUNDS");
			throw error;
		}
	}
	let after: LayoutNode = before,
		attempts = 1;
	const findings = inspectModel(artifact, null).findings.filter(
		(f) =>
			f.path.startsWith(`nodes.${before.id}.`) ||
			(before.kind === "text" &&
				f.path === `fields.${before.field.rowRef}.${before.field.fieldRef}`),
	);
	switch (request.kind) {
		case "shrink": {
			if (before.kind !== "text")
				return review(artifact, "SEMANTIC_LAYER_CHANGE");
			if (
				before.field.sizeMm > bounds.maxSize ||
				before.field.sizeMm < bounds.minSize
			)
				return review(artifact, "SIZE_POLICY_BOUNDS");
			let fitted = false;
			for (
				attempts = 1;
				attempts <= Math.min(bounds.maxAttempts, policy.maxTotalAttempts);
				attempts++
			) {
				const size = precise(before.field.sizeMm - bounds.step * attempts);
				if (size < bounds.minSize) break;
				if (
					size * before.transform.scaleY <
					Math.max(slot.minFontMm, bounds.minSize)
				)
					break;
				const field = { ...before.field, sizeMm: size },
					text = layoutText(field, artifact.fontBytes);
				if (text.state === "measured" && !text.overflow) {
					after = { ...before, field };
					fitted = true;
					break;
				}
			}
			if (!fitted) return review(artifact, "TEXT_CANNOT_FIT_WITHIN_BOUNDS");
			break;
		}
		case "reposition": {
			if (
				before.kind !== "text" ||
				!Number.isFinite(request.x) ||
				!Number.isFinite(request.y) ||
				Math.hypot(
					request.x - before.transform.x,
					request.y - before.transform.y,
				) > bounds.maxMoveMm
			)
				return review(artifact, "MOVE_POLICY_BOUNDS");
			const transform = {
					...before.transform,
					x: precise(request.x),
					y: precise(request.y),
				},
				text = layoutText(before.field, artifact.fontBytes);
			if (text.state !== "measured")
				return review(artifact, "TEXT_NOT_MEASURED");
			const world = transformed(text.bounds, transform),
				slot = artifact.model.layout.slots.find((s) => s.id === before.slot);
			if (
				!slot ||
				!contains(artifact.model.layout.safe, world) ||
				!contains(slot.bounds, world) ||
				before.clip
			)
				return review(artifact, "MOVE_CROPS_OR_LEAVES_SAFE_ZONE");
			const neighbors = inspectModel(artifact, null).contentBounds.filter(
				(b) => b.node.id !== before.id,
			);
			if (neighbors.some((b) => overlaps(world, b.bounds)))
				return review(artifact, "MOVE_OVERLAP");
			after = { ...before, transform };
			break;
		}
		case "fallback": {
			if (
				before.kind !== "text" ||
				!bounds.fallbackOrder.length ||
				!bounds.fallbackOrder.every((f) => before.field.fontOrder.includes(f))
			)
				return review(artifact, "FALLBACK_NOT_APPROVED");
			const text = layoutText(
				{ ...before.field, fontOrder: bounds.fallbackOrder },
				artifact.fontBytes,
			);
			if (text.state !== "measured" || text.overflow)
				return review(artifact, "FALLBACK_CANNOT_FIT");
			after = {
				...before,
				field: { ...before.field, fontOrder: [...bounds.fallbackOrder] },
			};
			break;
		}
		case "normalize": {
			if (before.kind !== "overlay" || !bounds.allowNormalize)
				return review(artifact, "NORMALIZATION_NOT_ALLOWED");
			after = {
				...before,
				asset: { ...before.asset, normalization: "safe-container-v1" },
			};
			break;
		}
		case "material":
			return review(artifact, "MATERIAL_CONTENT_OR_ART_CHANGE");
		default: {
			const unreachable: never = request;
			return unreachable;
		}
	}
	if (fingerprint(before) === fingerprint(after))
		return review(artifact, "NO_PROGRESS");
	const plan = {
		precondition: artifact.revision,
		compositionPrecondition: artifact.compositionHash,
		policyHash: fingerprint(policy),
		policyRevision: policy.revision,
		permissionRef: policy.permissionRef,
		findingCodes: findings.length
			? findings.map((f) => f.code).sort()
			: ["REQUESTED_MECHANICAL_OPERATION"],
		request,
		affectedNode: before.id,
		affectedFields:
			before.kind === "text"
				? [`${before.field.rowRef}/${before.field.fieldRef}`]
				: [],
		before,
		after,
		bounds,
		attempts,
		reason: `Explicit ${request.kind} under ${policy.revision}`,
	};
	return freeze({ state: "PLANNED", id: fingerprint(plan), ...plan });
}
export type RepairHistory = {
	readonly attempts: number;
	readonly seen: readonly Digest[];
};
const historySchema = z
	.object({
		attempts: z.number().int().min(0).max(32),
		seen: z.array(digestSchema).max(32).readonly(),
	})
	.strict()
	.readonly();
export type RepairFileCheck = (
	artifact: PrivateArtifact,
) => Promise<readonly FinalFileEvidence[]>;
export async function applyRepair(
	artifact: PrivateArtifact,
	plan: RepairPlan,
	policy: RepairPolicy,
	constraints: ResolvedConstraints | null,
	ports: RepairPorts,
	now: number,
	history: RepairHistory = { attempts: 0, seen: [] },
	checkFiles: RepairFileCheck = async () => [],
) {
	try {
		parse(historySchema, history);
	} catch (error) {
		if (error instanceof CompositionError)
			return review(artifact, "REPAIR_HISTORY_INVALID");
		throw error;
	}
	if (artifact.receipts.includes(plan.id))
		return freeze({
			state: "NO_OP" as const,
			artifact,
			report: await inspectArtifact(
				artifact,
				constraints,
				ports,
				now,
				await checkFiles(artifact),
			),
		});
	if (
		artifact.revision !== plan.precondition ||
		artifact.compositionHash !== plan.compositionPrecondition
	)
		return review(artifact, "STALE_PRECONDITION");
	if (
		fingerprint(policy) !== plan.policyHash ||
		policy.permission !== "mechanical"
	)
		return review(artifact, "REPAIR_POLICY_CHANGED");
	if (
		history.attempts + plan.attempts > policy.maxTotalAttempts ||
		history.seen.includes(artifact.compositionHash)
	)
		return review(artifact, "ATTEMPT_LIMIT_OR_OSCILLATION");
	const fresh = planRepair(artifact, policy, plan.request);
	if (fresh.state !== "PLANNED" || fingerprint(fresh) !== fingerprint(plan))
		return review(artifact, "PLAN_TAMPERED_OR_NO_PROGRESS");
	try {
		const derived = await composeArtifact(
			{
				...artifact.model.input,
				nodes: artifact.model.input.nodes.map((n) =>
					n.id === plan.affectedNode ? plan.after : n,
				),
			},
			artifact.model.layout,
			artifact.fontBytes,
			ports,
			now,
		);
		if (
			history.seen.includes(derived.compositionHash) ||
			derived.compositionHash === artifact.compositionHash
		)
			return review(artifact, "NO_PROGRESS_OR_OSCILLATION");
		if (
			fingerprint(derived.sourceArtworkHashes) !==
				fingerprint(artifact.sourceArtworkHashes) ||
			fingerprint(derived.texts.map((t) => t.field.source)) !==
				fingerprint(artifact.texts.map((t) => t.field.source))
		)
			return review(artifact, "SOURCE_CONTENT_CHANGED");
		const candidate = freeze({
			...derived,
			parent: artifact.revision,
			receipts: [...artifact.receipts, plan.id],
		});
		try {
			const decision = parse(
				repairDecisionSchema,
				await ports.repairPermission({ plan, result: candidate, now }),
			);
			requireCore(
				decision.state === "allowed" &&
					decision.planHash === plan.id &&
					decision.policyHash === plan.policyHash &&
					decision.precondition === artifact.revision &&
					decision.result === candidate.revision &&
					decision.permissionRef === plan.permissionRef &&
					decision.validUntil > now,
				"PERMISSION_BLOCKED",
				"repair.permission",
			);
		} catch (error) {
			if (error instanceof Error)
				return review(artifact, "REPAIR_PERMISSION_BLOCKED");
			throw error;
		}
		await recheckPermissions(candidate, ports, "repair", now);
		const report = await inspectArtifact(
			candidate,
			constraints,
			ports,
			now,
			await checkFiles(candidate),
		);
		if (
			!report.modelReady ||
			report.currentPermission !== "allowed" ||
			report.findings.some(
				(f) =>
					f.path.startsWith("files") &&
					(f.state === "failed" || f.state === "unsupported"),
			)
		)
			return review(artifact, "REPAIR_PREFLIGHT_OR_PERMISSION_FAILED");
		return freeze({
			state: "APPLIED_DRAFT" as const,
			artifact: candidate,
			receipt: {
				id: plan.id,
				precondition: plan.precondition,
				result: candidate.revision,
				policy: plan.policyRevision,
				attempts: plan.attempts,
				reportHash: report.reportHash,
				finalFiles: report.filesReady ? "checked" : "unknown",
			},
			report,
			history: {
				attempts: history.attempts + plan.attempts,
				seen: [...history.seen, artifact.compositionHash],
			},
		});
	} catch (error) {
		if (error instanceof CompositionError) return review(artifact, error.code);
		throw error;
	}
}
