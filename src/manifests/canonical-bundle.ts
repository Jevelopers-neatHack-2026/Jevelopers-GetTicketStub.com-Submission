import { randomUUID } from "node:crypto";
import { validateContractVersion } from "@jevelopers/shared-contracts";
import type {
	ProductionBundle_2_0_0,
	ProductionBundleRef,
	ArtifactRef,
	PreflightReport,
} from "@jevelopers/shared-contracts";
import {
	checkProductionBundleV2,
	productionBundleContentHash,
	productionPayloadSetHash,
	verifyProductionBundleFiles,
} from "@jevelopers/shared-contracts/production-operations";
import { outputFile } from "../exporters/private-policy.js";
import type { exportPrivateFiles } from "../exporters/private-output.js";
import { packZip, defaultZipLimits } from "../exporters/private-zip.js";
import type { CandidateRuntime } from "../api/canonical-runtime.js";
import type { CanonicalInputs } from "../api/canonical-inputs.js";
import { blocked, projectPreflight } from "../api/canonical-preflight.js";
import {
	byteHash,
	checked,
	contract,
	jsonBytes,
	sha,
	version,
	requireCandidate,
} from "../api/canonical-values.js";
import { canonicalFile, payloadBudget } from "./canonical-files.js";
import type { Id } from "../internal/durability.js";

export function assembleCanonicalBundle(
	runtime: CandidateRuntime,
	input: {
		readonly exported: Awaited<ReturnType<typeof exportPrivateFiles>>;
		readonly inputs: CanonicalInputs;
		readonly artifact: ArtifactRef;
		readonly correlation_id: ProductionBundle_2_0_0["correlation_id"];
		readonly row_scope?: ProductionBundle_2_0_0["row_scope"];
		readonly attempt?: Id;
	},
) {
	const { exported, inputs, artifact } = input;
	const visuals = exported.files.map((file) => {
		const descriptor = exported.descriptors.find((d) => d.name === file.name);
		requireCandidate(
			descriptor !== undefined,
			"INTEGRITY_FAILURE",
			"integrity",
		);
		return canonicalFile(file, "print_output", descriptor);
	});
	const report: PreflightReport = projectPreflight(runtime, {
		artifact,
		inputs,
		report: exported.report,
		fileEvidence: exported.evidence,
		files: visuals,
	});
	const reportFile = outputFile("preflight.json", jsonBytes(report));
	const reportDescriptor = {
		...canonicalFile(reportFile, "preflight_report"),
		semantic_hash: report.report_ref.content_hash,
	};
	const lineageFile = outputFile(
		"lineage.json",
		jsonBytes({
			contract_candidate: "0.9.3",
			accepted: false,
			live_integration: false,
			source_assets: inputs.composition.asset_uses,
			source_artwork_hashes: artifact.source_artwork_hashes,
			composition_ref: artifact.composition_ref,
			private_composition_hash: `sha256:${exported.report.envelope.compositionHash}`,
			render_hash: artifact.render_hash,
			private_revision_hash: artifact.private_revision_hash,
			facts_ref: inputs.composition.facts_ref,
			input_binding_hash: inputs.composition.input_binding_hash,
			resolved_layout_commitment: inputs.composition.resolved_layout_commitment,
			runtime: runtime.context.runtime,
			private_renderer_hash: `sha256:${exported.rendererDigest}`,
			browser: exported.browser,
			environment: exported.environment,
			output_policy: exported.policy,
			row_scope: input.row_scope ?? null,
			canonical_usage_intake: "unavailable",
			finance_receipt: null,
			local_execution_attempt: input.attempt ?? null,
		}),
	);
	const lineageDescriptor = canonicalFile(lineageFile, "lineage");
	const payloads = [...exported.files, reportFile, lineageFile];
	payloadBudget(payloads, runtime.host.db.limits);
	const files = [...visuals, reportDescriptor, lineageDescriptor];
	const now = runtime.now();
	const initial = checked(
		validateContractVersion("ProductionBundle", "2.0.0", {
			contract: "ProductionBundle",
			schema_version: "2.0.0",
			policy_version: "1.0.0",
			event_id: randomUUID(),
			...runtime.context.scope,
			correlation_id: input.correlation_id,
			producer: runtime.host.producer,
			occurred_at: now,
			observed_at: now,
			ingested_at: now,
			environment: runtime.context.environment,
			billing_mode: runtime.context.billing_mode,
			source_refs: [],
			bundle_id: randomUUID(),
			bundle_version: 1,
			bundle_hash: sha(`sha256:${"0".repeat(64)}`),
			handoff_ref: inputs.composition.handoff_ref,
			approval_ref: inputs.approval_ref,
			facts_ref: inputs.composition.facts_ref,
			composition_ref: artifact.composition_ref,
			template_ref: inputs.composition.template_ref,
			spec_ref: inputs.composition.spec_ref,
			capability_ref: inputs.composition.capability_ref,
			renderer_ref: inputs.composition.runtime_ref,
			font_refs: inputs.composition.font_refs,
			policy_refs: inputs.composition.policy_refs,
			composition: {
				facts_hash: inputs.composition.facts_ref.content_hash,
				composition_hash: artifact.composition_ref.content_hash,
				source_artwork_hashes: artifact.source_artwork_hashes,
				displayed_preview_hash: null,
				composed_preview_hash: null,
				render_hash: artifact.render_hash,
				private_revision_hash: artifact.private_revision_hash,
				input_binding_hash: inputs.composition.input_binding_hash,
				barcode_hash: null,
			},
			files,
			preflight: {
				report_ref: report.report_ref,
				status: report.body.status,
				reasons: report.body.status === "passed" ? [] : ["PREFLIGHT_FAILED"],
			},
			lineage_ref: {
				contract: "ProductionResource",
				schema_version: "1.0.0",
				id: lineageDescriptor.artifact_id,
				revision: 1,
				content_hash: lineageDescriptor.byte_hash,
			},
			row_scope: input.row_scope ?? null,
			usage_refs: [],
			decision_refs: [],
		}),
	);
	const bundle = checked(
		checkProductionBundleV2(
			{ ...initial, bundle_hash: productionBundleContentHash(initial) },
			runtime.context.scope,
		),
	);
	const bundleRef: ProductionBundleRef["bundle_ref"] = {
		contract: "ProductionBundle",
		schema_version: "2.0.0",
		id: bundle.bundle_id,
		revision: bundle.bundle_version,
		content_hash: bundle.bundle_hash,
	};
	const manifest = outputFile("manifest.json", jsonBytes(bundle));
	const manifestDescriptor = canonicalFile(manifest, "manifest");
	const archive = packZip(payloads, manifest, {
		...defaultZipLimits,
		maxEntryBytes: Math.min(defaultZipLimits.maxEntryBytes, 8388608),
		maxFiles: Math.min(
			defaultZipLimits.maxFiles,
			runtime.host.db.limits.maxFiles,
		),
		maxBytes: Math.min(
			defaultZipLimits.maxBytes,
			runtime.host.db.limits.maxOutputBytes,
		),
	});
	const archiveDescriptor = canonicalFile(archive, "archive");
	const detached = contract("ProductionBundleDetached", {
		contract: "ProductionBundleDetached",
		...version,
		bundle_ref: bundleRef,
		manifest: manifestDescriptor,
		archive: archiveDescriptor,
		lineage_hash: lineageDescriptor.byte_hash,
		payload_set_hash: productionPayloadSetHash(files),
	});
	const detachedFile = outputFile("detached.json", jsonBytes(detached));
	const detachedDescriptor = canonicalFile(detachedFile, "detached");
	const commitment = contract("ProductionBundleRef", {
		contract: "ProductionBundleRef",
		...version,
		bundle_ref: bundleRef,
		file_set: [
			...files,
			manifestDescriptor,
			archiveDescriptor,
			detachedDescriptor,
		],
		detached_ref: {
			contract: "ProductionBundleDetached",
			schema_version: "1.0.0",
			id: detachedDescriptor.artifact_id,
			revision: 1,
			content_hash: byteHash(detachedFile.bytes),
		},
		row_scope: bundle.row_scope,
		composition_ref: artifact.composition_ref,
		eligibility: blocked(runtime),
	});
	const all = [...payloads, manifest, archive, detachedFile];
	checked(
		verifyProductionBundleFiles(
			all.map((f) => ({ filename: f.name, bytes: f.bytes })),
			{ scope: runtime.context.scope, trusted_commitment: commitment },
		),
		"INTEGRITY_FAILURE",
	);
	return { bundle, report, commitment, files: all };
}
