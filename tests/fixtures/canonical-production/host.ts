import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePrimitive } from "@jevelopers/shared-contracts";
import { createProductionError } from "@jevelopers/shared-contracts/production-operations";
import type { ProductionContext } from "@jevelopers/shared-contracts/production-operations";
import { DurabilityDatabase } from "../../../src/internal/durability.js";
import { parseComposition } from "../../../src/composition/private-model.js";
import type { CompositionPorts } from "../../../src/composition/private-model.js";
import { defaultOutputPolicy } from "../../../src/exporters/private-policy.js";
import {
	fixtureFonts,
	fixtureInput,
	fixtureLayout,
	fixtureConstraints,
	artworkPng,
	safeLogo,
} from "../composition/corpus.js";
import { syntheticRecords, ownerFixture } from "./records.js";
import type { SyntheticRecords } from "./records.js";
import {
	checked,
	contract,
	CandidateFailure,
} from "../../../src/api/canonical-values.js";
import { createCandidateProductionOperations } from "../../../src/api/candidate.js";
import type {
	CanonicalHost,
	CanonicalProfile,
} from "../../../src/api/candidate.js";

export type FixtureHost = {
	readonly root: string;
	readonly state: {
		revoked: boolean;
		stale: boolean;
		missing: boolean;
		tampered: boolean;
		access: boolean;
		now: string;
		resolverCalls: number;
		assetCalls: number;
		supplierCalls: number;
		generationCalls: number;
	};
	readonly records: SyntheticRecords;
	readonly candidate: ReturnType<typeof createCandidateProductionOperations>;
	readonly controller: AbortController;
	readonly host: () => CanonicalHost;
	readonly db: DurabilityDatabase;
	readonly restart: () => ReturnType<
		typeof createCandidateProductionOperations
	>;
	readonly [Symbol.asyncDispose]: () => Promise<void>;
};
export async function fixtureHost(): Promise<FixtureHost> {
	const root = await mkdtemp(join(tmpdir(), "pp-canonical-production-"));
	const state = {
		revoked: false,
		stale: false,
		missing: false,
		tampered: false,
		access: true,
		now: "2026-10-10T12:05:00.000Z",
		resolverCalls: 0,
		assetCalls: 0,
		supplierCalls: 0,
		generationCalls: 0,
	};
	const art = artworkPng(),
		fonts = await fixtureFonts(),
		rawComposition = await ownerFixture("Composition"),
		rawApproval = await ownerFixture("ApprovalReceipt");
	const font = fonts.find((f) => f.descriptor.ref === "synthetic-latin");
	if (!font) throw new Error("required real fixture font missing");
	const layout = fixtureLayout();
	const input = parseComposition(fixtureInput(art), layout);
	const nowMs = () => Date.parse(state.now);
	const ports: CompositionPorts = {
		resolve: async () => null,
		permission: async ({ binding, composition }) => ({
			ref: binding.ref,
			version: binding.version,
			digest: binding.digest,
			permissionRef: binding.permissionRef,
			scope: binding.scope,
			purpose: binding.purpose,
			state: state.revoked ? "revoked" : "allowed",
			validUntil: nowMs() + 60000,
			appliesTo: composition ?? "source",
		}),
		compositionPermission: async ({ model, compositionHash }) => ({
			state: state.revoked ? "revoked" : "allowed",
			compositionHash,
			approvalRef: model.input.approvalRef,
			approvalDigest: model.input.approvalDigest,
			validUntil: nowMs() + 60000,
		}),
	};
	const baseProfile: CanonicalProfile = {
		template_ref: rawComposition.template_ref,
		layout,
		input,
		fonts: [
			{ reference: rawComposition.font_refs[0] ?? checkedFontRef(), font },
		],
		asset_refs: [],
		slot_ids: Object.fromEntries(layout.slots.map((s) => [s.id, s.id])),
		field_ids: { name: "name", detail: "detail" },
		constraints: fixtureConstraints(layout),
		output_policy: defaultOutputPolicy,
		private_permissions: ports,
		policy_refs: rawComposition.policy_refs,
		expected_approval_binding: structuredClone(rawApproval.binding),
	};
	const records = await syntheticRecords({
		art,
		logo: safeLogo,
		profile: baseProfile,
	});
	const dbPath = join(root, "state.sqlite");
	let db = new DurabilityDatabase(dbPath, undefined, nowMs);
	const controller = new AbortController();
	const unavailable = () =>
		checked(
			createProductionError("APPROVAL_UNAVAILABLE", {
				scope: records.scope,
				correlation_id: records.request.correlation_id,
				operation: "composeArtifact",
			}),
		);
	const rawOutcome = await ownerFixture("ApprovalVerificationOutcome");
	const verification = () => ({
		...rawOutcome,
		...records.scope,
		status: state.revoked
			? ("revoked" as const)
			: state.stale
				? ("stale" as const)
				: ("valid" as const),
		receipt_ref: records.request.binding.approval_ref,
		checked_at: checked(validatePrimitive("UtcTime", state.now)),
	});
	const context: ProductionContext = {
		scope: records.scope,
		authority: {
			actor_id: records.approval.actor_id,
			audience: "print-production",
		},
		clock: { now: () => checked(validatePrimitive("UtcTime", state.now)) },
		policy_version: "1.0.0",
		environment: "test",
		billing_mode: "simulated",
		evidence_mode: "offline",
		runtime: records.runtime,
		references: {
			resolve: async (reference) => {
				state.resolverCalls++;
				if (state.missing) throw new CandidateFailure("NOT_FOUND");
				const value = records.records.get(reference.id);
				return { ok: true, value: contract(reference.contract, value) };
			},
		},
		templates: {
			resolve: async () => {
				state.resolverCalls++;
				return { ok: true, value: records.template };
			},
		},
		authorization: {
			verify: async () => ({ ok: true, value: verification() }),
		},
		assets: {
			resolve: async (reference) => {
				state.assetCalls++;
				const use = records.composition.asset_uses.find(
					(a) => a.asset_ref.id === reference.id,
				);
				if (!use) return { ok: false, error: unavailable() };
				const bytes = use.purpose === "artwork" ? art : safeLogo;
				return {
					ok: true,
					value: state.tampered
						? Buffer.concat([bytes, Buffer.from("tamper")])
						: bytes,
				};
			},
			verifyPermission: async () => ({ ok: true, value: verification() }),
		},
		storage: {
			readStatus: async () => {
				throw new CandidateFailure("RETRYABLE_STORAGE_FAILURE");
			},
			publish: async () => {
				throw new CandidateFailure("RETRYABLE_STORAGE_FAILURE");
			},
		},
		metering: { observe: async () => ({ ok: false, error: unavailable() }) },
	};
	const host = (): CanonicalHost => ({
		context,
		db,
		private_scope: input.scope,
		profiles: [records.profile],
		producer: {
			module: "print-production",
			source_revision: checked(
				validatePrimitive(
					"SourceRevision",
					"705f9e1e91aa96bb05dbf4806c34d8f9d570dbf8",
				),
			),
			build_revision: "synthetic-host-only",
		},
		external_references: records.references,
		inspection_policy_ref: records.composition.policy_refs.output,
		batch_signal: controller.signal,
		access: async () => state.access,
	});
	const candidate = createCandidateProductionOperations(host());
	return {
		root,
		state,
		records,
		candidate,
		controller,
		host,
		get db() {
			return db;
		},
		restart() {
			db.close();
			db = new DurabilityDatabase(dbPath, undefined, nowMs);
			return createCandidateProductionOperations(host());
		},
		async [Symbol.asyncDispose]() {
			db.close();
			await rm(root, { recursive: true, force: true });
		},
	};
}
function checkedFontRef(): never {
	throw new Error("missing canonical font fixture reference");
}
