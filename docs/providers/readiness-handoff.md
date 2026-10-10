# EI-X03: provider and account readiness handoff

**Local requirements:** EI-03, EI-12, JEV-EI-01. **Acceptance contribution:** FIN-01 and EVAL-04 under Finance and reliability, EVAL-03 under Product and frontend, and SPN-01 under Finance and reliability. **Owner role:** Agent and research. Account access, model choices, budget authority and the compatible JEV adapter are pending.

The required readiness records are separate for JEV, research/vision/reasoning and budget authorization. GPT Image remains Creative and fulfillment's responsibility; Neatlogs remains harness-owned. The latter two are tracked as related release records and do not block this narrow research-readiness handoff. The checker never inspects credentials or calls a provider.

For each applicable provider, the responsible owner supplies a sanitized record with provider/endpoint/API version, SDK/runtime version, explicit model ID/version, parameters, retry limit, account/project eligibility, dependency mode, rate-card source/effective date and usage basis. Do not write credential values or secrets into evidence. Keep absent account access, adapter incompatibility, budget authorization and smoke execution as separate states. Do not substitute a moving `latest` alias.

The issue records `jev-1.13.0` as a documented candidate, not account proof or an accepted model configuration. Creative chooses and verifies any GPT Image model; no model ID, price, API shape or budget is selected here. An owner must document a safe nonbillable readiness procedure or state that none exists. It must never claim a successful inference. Any later authorized smoke run records the exact configuration, mode, provider request and usage references without secrets.

Finance supplies the authorized budget reference. Revalidate it before dispatch so revocation between readiness and execution blocks work. If no budget authority exists, return the agreed safe blocked result. Simulated, recorded, sandbox and live modes remain distinct. Usage and cost remain unknown until evidence establishes another basis; unknown is not zero.

The narrow EI-X03 gate still requires an actual compatible pinned sole JEV adapter, owner-verified account/project readiness, explicit configuration and budget authorization/revalidation. A passing mock branch test does not establish access. No paid call or account change is part of this handoff.
