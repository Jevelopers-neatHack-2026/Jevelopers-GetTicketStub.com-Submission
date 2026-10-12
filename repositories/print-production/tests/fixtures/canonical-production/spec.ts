import type { ContractMap } from "@jevelopers/shared-contracts";
import type { ProductionScope } from "@jevelopers/shared-contracts/production-operations";
import {
	deriveCapabilityIdentities,
	hashPrintSpec,
} from "@jevelopers/shared-contracts/capability";
import { checked, contract, sha } from "../../../src/api/canonical-values.js";
export function syntheticSpecification(input: {
	readonly spec: ContractMap["PrintSpec"];
	readonly capture: ContractMap["FulfillmentCapabilitySnapshot"];
	readonly scope: ProductionScope;
}): {
	readonly spec: ContractMap["PrintSpec"];
	readonly capture: ContractMap["FulfillmentCapabilitySnapshot"];
} {
	const { spec: rawSpec, capture: rawCapture, scope } = input;
	const specDraft = contract("PrintSpec", {
		...rawSpec,
		...scope,
		sku: "synthetic-commemorative-ticket",
		constraints: {
			...rawSpec.constraints,
			geometry: {
				trim: {
					state: "known",
					value: {
						width_nm: "97600000",
						height_nm: "46800000",
						unit: "nm",
						evidence_ref: "fixture:synthetic-spec",
					},
				},
				printable: {
					state: "known",
					value: {
						width_nm: "101600000",
						height_nm: "50800000",
						unit: "nm",
						evidence_ref: "fixture:synthetic-spec",
					},
				},
				outer_frame: { state: "unknown", reason_code: "not_in_source" },
			},
			inset_geometry_basis: { state: "known", value: "trim" },
			minimum_bleed: {
				state: "known",
				value: {
					top_nm: "2000000",
					right_nm: "2000000",
					bottom_nm: "2000000",
					left_nm: "2000000",
					unit: "nm",
				},
			},
			minimum_safe_area: {
				state: "known",
				value: {
					top_nm: "3000000",
					right_nm: "3000000",
					bottom_nm: "3000000",
					left_nm: "3000000",
					unit: "nm",
				},
			},
			minimum_resolution_dpi: { state: "known", value: 290 },
			color: {
				state: "known",
				value: { spaces: ["sRGB"], profiles: ["srgb"] },
			},
			files: {
				state: "known",
				value: {
					minimum_count: 1,
					maximum_count: 3,
					mime_types: ["image/svg+xml", "image/png", "application/pdf"],
				},
			},
		},
	});
	const spec = {
		...specDraft,
		spec_identity: sha(checked(hashPrintSpec(specDraft))),
	};
	const captureDraft = {
		...rawCapture,
		...scope,
		products: [spec],
		source: { ...rawCapture.source, retrieved_at: "2026-10-10T12:00:00.000Z" },
		freshness: {
			maximum_age_seconds: 3600,
			fresh_until: "2026-10-10T13:00:00.000Z",
		},
	};
	const identities = checked(deriveCapabilityIdentities(captureDraft));
	const capture = {
		...captureDraft,
		content_identity: sha(identities.content_identity),
		capture_identity: sha(identities.capture_identity),
	};

	return { spec, capture };
}
