import type { DecisionDispatchInput, InspectionInput } from "../../src/api/v1.mjs";

type TargetBinding = `sha256:${string}`;

export function revalidateInspection(input: InspectionInput, target: TargetBinding): Promise<string> {
  return input.revalidateDispatch({
    reservation_ref: input.reservation_ref,
    billable_attempt_id: input.attempt.billable_attempt_id,
    transport_attempt_id: input.transport_attempt_id,
    dispatch_intent_ref: input.dispatch_intent_ref,
    target_binding_sha256: target,
    signal: input.signal,
  });
}

export function revalidateDecision(input: DecisionDispatchInput, target: TargetBinding): Promise<string> {
  const signal = input.signal;
  if (!signal) throw new Error("DecisionPort dispatch signal is required before revalidation.");
  return input.revalidateDispatch({
    reservation_ref: input.reservation_ref,
    billable_attempt_id: input.attempt.billable_attempt_id,
    transport_attempt_id: input.transport_attempt_id,
    dispatch_intent_ref: input.dispatch_intent_ref,
    target_binding_sha256: target,
    signal,
  });
}
