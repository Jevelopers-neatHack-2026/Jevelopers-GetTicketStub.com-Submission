import type { Operation, SharedShape } from "./types.js";

/**
 * References are catalog pointers only. They do not define payload schemas or
 * assert that upstream issues have been accepted.
 */
export const CONTRACT_OWNERSHIP = {
  operation_envelope: { ownerRepository: "shared-contracts", upstreamIssue: "#4" },
  capability: { ownerRepository: "shared-contracts", upstreamIssue: "#4" },
  print_specification: { ownerRepository: "shared-contracts", upstreamIssue: "#4" },
  preflight_report: { ownerRepository: "shared-contracts", upstreamIssue: "#4" },
  production_bundle: { ownerRepository: "shared-contracts", upstreamIssue: "#24" },
  fulfillment_quote: { ownerRepository: "shared-contracts", upstreamIssue: "#25" },
  order_authorization: { ownerRepository: "shared-contracts", upstreamIssue: "#26" },
  shipment_observation: { ownerRepository: "shared-contracts", upstreamIssue: "#27" },
  operation_result: { ownerRepository: "shared-contracts", upstreamIssue: "#4" },
  budget_reservation: { ownerRepository: "shared-contracts", upstreamIssue: "#12" },
  fulfillment_usage: { ownerRepository: "shared-contracts", upstreamIssue: "#11" }
} as const satisfies Record<SharedShape, { readonly ownerRepository: string; readonly upstreamIssue: string }>;

export const INPUT_SHAPES: Readonly<Record<Operation, readonly SharedShape[]>> = {
  discover_capabilities: ["operation_envelope"],
  quote: ["operation_envelope", "production_bundle"],
  preflight: ["operation_envelope", "production_bundle", "print_specification"],
  submit: ["operation_envelope", "production_bundle", "fulfillment_quote", "order_authorization"],
  status: ["operation_envelope"],
  shipment: ["operation_envelope"],
  cancel: ["operation_envelope", "order_authorization"]
};

export const AUXILIARY_SHAPES: Readonly<Record<Operation, readonly SharedShape[]>> = {
  discover_capabilities: ["fulfillment_usage"],
  quote: ["fulfillment_usage"],
  preflight: ["fulfillment_usage"],
  submit: ["budget_reservation", "fulfillment_usage"],
  status: ["fulfillment_usage"],
  shipment: ["fulfillment_usage"],
  cancel: ["budget_reservation", "fulfillment_usage"]
};

export const OUTPUT_SHAPES: Readonly<Record<Operation, readonly SharedShape[]>> = {
  discover_capabilities: ["capability"],
  quote: ["fulfillment_quote"],
  preflight: ["preflight_report"],
  submit: ["operation_result"],
  status: ["shipment_observation"],
  shipment: ["shipment_observation"],
  cancel: ["operation_result"]
};

export const ALL_SHARED_SHAPES = Object.keys(CONTRACT_OWNERSHIP) as SharedShape[];

export function uniqueShapes(shapes: readonly SharedShape[]): SharedShape[] {
  return [...new Set(shapes)];
}
