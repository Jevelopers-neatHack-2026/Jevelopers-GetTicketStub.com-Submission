import { randomUUID } from "node:crypto";
import type {
	ArtifactFile,
	ArtifactRef,
	PreflightReport,
	ProductionResource,
} from "@jevelopers/shared-contracts";
import {
	productionContentHash,
	checkProductionPreflight,
} from "@jevelopers/shared-contracts/production-operations";
import { inspectArtifact as inspectPrivate } from "../preflight/private-inspection.js";
import type {
	FinalFileEvidence,
	Finding,
} from "../preflight/private-inspection.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import type { CanonicalInputs } from "./canonical-inputs.js";
import {
	byteHash,
	contentHash,
	contract,
	jsonBytes,
	sha,
	version,
	checked,
} from "./canonical-values.js";

export function blocked(
	runtime: CandidateRuntime,
): PreflightReport["eligibility"] {
	return {
		state: "blocked",
		reason_codes: ["OWNER_ACCEPTANCE_PENDING"],
		checked_at: runtime.now(),
		evidence_mode: runtime.context.evidence_mode,
		handoff_eligible: false,
	};
}
export function evidence(
	runtime: CandidateRuntime,
	value: unknown,
): ProductionResource {
	const raw = contract("ProductionResource", {
		contract: "ProductionResource",
		...version,
		...runtime.context.scope,
		id: randomUUID(),
		revision: 1,
		kind: "lineage",
		byte_hash: byteHash(jsonBytes(value)),
		license_ref: null,
		content_hash: sha(`sha256:${"0".repeat(64)}`),
	});
	const record = { ...raw, content_hash: productionContentHash(raw) };
	runtime.state.put(`evidence:${record.id}`, { record, value });
	return record;
}
export function resourceRef(value: ProductionResource) {
	return {
		contract: "ProductionResource" as const,
		schema_version: "1.0.0" as const,
		id: value.id,
		revision: value.revision,
		content_hash: value.content_hash,
	};
}
type CanonicalFinding = PreflightReport["body"]["findings"][number];

const findingCodes: Readonly<Record<string, CanonicalFinding["code"]>> = {
	SPEC_UNKNOWN: "SPEC_UNKNOWN",
	PRODUCT_MISMATCH: "PRODUCT_MISMATCH",
	DIMENSIONS_MISMATCH: "DIMENSIONS_MISMATCH",
	BLEED_MISMATCH: "BLEED_MISMATCH",
	SAFE_MISMATCH: "SAFE_MISMATCH",
	DPI_MISMATCH: "DPI_MISMATCH",
	DPI_LOW: "DPI_MISMATCH",
	PROFILE_UNSUPPORTED: "PROFILE_UNSUPPORTED",
	EXPORT_UNSUPPORTED: "EXPORT_UNSUPPORTED",
	FONT_UNSUPPORTED: "FONT_UNSUPPORTED",
	TRANSPARENCY_MISMATCH: "TRANSPARENCY_MISMATCH",
	CURRENT_PERMISSION_BLOCKED: "APPROVAL_UNAVAILABLE",
};
const diagnosticValues = new Set([
	"supported",
	"unsupported",
	"unknown",
	"passed",
	"failed",
	"srgb",
	"icc",
	"cmyk",
	"pdf-x",
	"present",
	"absent",
	"approved-fallback",
	"pinned order",
	"valid millimetre geometry",
	"pinned font descriptors",
	"verified model, source, display and render relationships",
	"intact parsed asset",
	"exact source digest list",
	"declared slot",
	"resolved asset",
	"policy compliant geometry",
	"intact pinned font",
	"exact source, format, glyphs and bounds",
	"measured exact text",
	"opaque unclipped normal text",
	"full content coverage",
	"slot bounds",
	"safe rectangle",
	"positive opacity and supported normal foreground paint",
	"no intersecting later paint over required content",
	"opaque approved art covers all bleed corners",
	"render of exact measured content",
	"complete render",
	"one evidence record per format",
	"independently inspected file",
	"current applicable external permission",
]);
function diagnosticValue(
	value: Finding["observed"],
	referenceValue = false,
): Finding["observed"] {
	if (typeof value !== "string") return value;
	if (
		diagnosticValues.has(value) ||
		(referenceValue && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) ||
		/^[a-f0-9]{64}$/.test(value) ||
		/^uniform physical size [0-9.]+\.\.[0-9.]+$/.test(value)
	)
		return value;
	return `redacted:${contentHash(value)}`;
}
function observedValue(finding: Finding): Finding["observed"] {
	return diagnosticValue(
		finding.observed,
		["ASSET_MISSING", "SLOT_UNKNOWN", "CONTENT_OCCLUSION"].includes(
			finding.code,
		),
	);
}
function diagnosticPath(path: string): string {
	return /^(?:layout|model|fonts?|assets|sourceArtworkHashes|constraints|slots|nodes|fields|files|svg|permissions|composition)(?:\.[A-Za-z0-9_-]+)*$/.test(
		path,
	)
		? path
		: `redacted:${contentHash(path)}`;
}
function findingPath(path: string): CanonicalFinding["field_path"] {
	const root = path.split(".")[0];
	switch (root) {
		case "files":
			return "/files";
		case "layout":
			return "/coordinate_geometry";
		case "slots":
		case "nodes":
			return "/slots";
		case "fields":
			return "/values";
		case "assets":
		case "sourceArtworkHashes":
		case "permissions":
			return "/binding";
		case "model":
			return "/artifact_ref";
		default:
			return "/preflight";
	}
}
function nanometres(value: number): number | null {
	if (!Number.isFinite(value)) return null;
	const [coefficient = "0", exponent = "0"] = value.toString().split("e");
	const [whole = "0", fraction = ""] = coefficient.split(".");
	const significand = BigInt(whole + fraction);
	const scale = 6 + Number(exponent) - fraction.length;
	const divisor = scale < 0 ? 10n ** BigInt(-scale) : 1n;
	if (significand % divisor !== 0n) return null;
	const nm =
		scale < 0 ? significand / divisor : significand * 10n ** BigInt(scale);
	const result = Number(nm);
	return Number.isSafeInteger(result) ? result : null;
}
function findingQuantities(
	finding: Finding,
): Pick<CanonicalFinding, "observed" | "expected" | "unit"> {
	const observed = observedValue(finding);
	const expected = diagnosticValue(finding.expected) ?? "detail in evidence";
	switch (finding.unit) {
		case "mm": {
			const observedNm =
				typeof observed === "number" ? nanometres(observed) : null;
			const expectedNm =
				typeof expected === "number" ? nanometres(expected) : null;
			if (
				(finding.observed === null || observedNm !== null) &&
				expectedNm !== null
			)
				return { observed: observedNm, expected: expectedNm, unit: "nm" };
			return {
				observed: "detail in evidence",
				expected: "detail in evidence",
				unit: "state",
			};
		}
		case "dpi":
		case "count":
		case "digest":
		case "state":
			return {
				observed:
					typeof observed === "string" && observed.length > 128
						? "detail in evidence"
						: observed,
				expected:
					typeof expected === "string" && expected.length > 128
						? "detail in evidence"
						: expected,
				unit: finding.unit,
			};
	}
}
export function projectPreflight(
	runtime: CandidateRuntime,
	request: {
		readonly artifact: ArtifactRef;
		readonly inputs: CanonicalInputs;
		readonly report: Awaited<ReturnType<typeof inspectPrivate>>;
		readonly fileEvidence: readonly FinalFileEvidence[];
		readonly files: readonly ArtifactFile[];
	},
): PreflightReport {
	const { artifact, inputs, report, fileEvidence, files } = request;
	const proof = resourceRef(
		evidence(runtime, {
			reportVersion: report.reportVersion,
			ruleVersion: report.ruleVersion,
			reportHash: report.reportHash,
			findingsHash: report.findingsHash,
			constraintHash: report.constraintHash,
			policyHash: report.policyHash,
			artifact,
			modelReady: report.modelReady,
			filesReady: report.filesReady,
			currentPermission: report.currentPermission,
			fileEvidence,
			files,
		}),
	);
	const parser = inputs.composition.runtime_ref;
	const body: PreflightReport["body"] = {
		artifact_ref: artifact,
		spec_ref: inputs.composition.spec_ref,
		rule_ref: runtime.host.inspection_policy_ref,
		status: report.draftReady
			? "passed"
			: report.modelReady
				? "unknown"
				: "failed",
		model_ready: report.modelReady,
		files_ready: report.filesReady,
		checked_files: fileEvidence.map((file) => ({
			file_hash: sha(`sha256:${file.fileDigest}`),
			parser_ref: parser,
			checks: file.checks.map((check) => ({
				name: check.name,
				state: check.state,
				evidence_ref: proof,
			})),
			composition_hash: artifact.composition_ref.content_hash,
			render_hash: artifact.render_hash,
			semantic_hash:
				files.find((f) => f.byte_hash === sha(`sha256:${file.fileDigest}`))
					?.semantic_hash ?? null,
		})),
		findings: report.findings.map((finding) => ({
			code: findingCodes[finding.code] ?? "PREFLIGHT_FAILED",
			severity: finding.severity,
			state: finding.state,
			field_path: findingPath(finding.path),
			rule_ref: runtime.host.inspection_policy_ref,
			spec_ref: inputs.composition.spec_ref,
			...findingQuantities(finding),
			repair_eligible: finding.repairEligible,
			evidence_ref: resourceRef(
				evidence(runtime, {
					artifact,
					rule_ref: runtime.host.inspection_policy_ref,
					spec_ref: inputs.composition.spec_ref,
					report_hash: report.reportHash,
					finding: {
						...finding,
						code: /^[A-Z][A-Z0-9_]*$/.test(finding.code)
							? finding.code
							: `redacted:${contentHash(finding.code)}`,
						path: diagnosticPath(finding.path),
						observed: observedValue(finding),
						expected: diagnosticValue(finding.expected),
						specRevision:
							finding.specRevision === null ||
							/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(finding.specRevision)
								? finding.specRevision
								: `redacted:${contentHash(finding.specRevision)}`,
						evidenceRef: /^evidence-[a-f0-9]{64}$/.test(finding.evidenceRef)
							? finding.evidenceRef
							: `redacted:${contentHash(finding.evidenceRef)}`,
					},
				}),
			),
		})),
	};
	const value = contract("PreflightReport", {
		contract: "PreflightReport",
		...version,
		report_ref: {
			contract: "PreflightReport",
			schema_version: "1.0.0",
			id: randomUUID(),
			revision: 1,
			content_hash: contentHash(body),
		},
		body,
		eligibility: blocked(runtime),
	});
	if (value.body.status === "passed")
		checked(
			checkProductionPreflight(value, {
				artifact_ref: artifact,
				spec_ref: inputs.composition.spec_ref,
				rule_ref: runtime.host.inspection_policy_ref,
				parser_ref: parser,
				files,
			}),
			"PREFLIGHT_FAILED",
		);
	runtime.state.put(`preflight:${value.report_ref.id}`, value);
	return value;
}
