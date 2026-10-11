import type {
	ApprovalReceipt,
	CommonEnvelope,
	Composition,
	TemplateSpec,
} from "@jevelopers/shared-contracts";
import type {
	ProductionContext,
	ProductionOperation,
	ProductionReferenceValue,
} from "@jevelopers/shared-contracts/production-operations";
import type {
	CompositionInput,
	CompositionPorts,
} from "../composition/private-model.js";
import type {
	PrivateLayout,
	ResolvedConstraints,
} from "../templates/private-layout.js";
import type { PinnedFont } from "../typography/private-text.js";
import type { OutputPolicy } from "../exporters/private-policy.js";
import type { DurabilityDatabase, Scope } from "../internal/durability.js";

/** Authenticated, independently supplied source mappings. Never inferred from a request. */
export type CanonicalProfile = {
	readonly template_ref: Composition["template_ref"];
	readonly layout: PrivateLayout;
	readonly input: CompositionInput;
	readonly fonts: readonly {
		readonly reference: TemplateSpec["font_refs"][number];
		readonly font: PinnedFont;
	}[];
	readonly asset_refs: readonly {
		readonly reference: Composition["asset_uses"][number]["asset_ref"];
		readonly private_ref: string;
		readonly private_revision: string;
	}[];
	readonly slot_ids: Readonly<Record<string, string>>;
	readonly field_ids: Readonly<Record<string, string>>;
	readonly constraints: ResolvedConstraints | null;
	readonly output_policy: OutputPolicy;
	readonly policy_refs: Composition["policy_refs"];
	readonly private_permissions: CompositionPorts;
	readonly expected_approval_binding: ApprovalReceipt["binding"];
};
export type CanonicalHost = {
	readonly context: ProductionContext;
	readonly db: DurabilityDatabase;
	readonly private_scope: Scope;
	readonly external_references: readonly ProductionReferenceValue[];
	readonly profiles: readonly CanonicalProfile[];
	readonly producer: CommonEnvelope["producer"];
	readonly inspection_policy_ref: Composition["policy_refs"]["output"];
	readonly batch_signal: AbortSignal;
	/** Fresh authenticated access check, including read/re-observation. */
	readonly access: (operation: ProductionOperation) => Promise<boolean>;
};
