# Product explanation — rehearsal scope

**Asset:** `DEMO-EXPLAINER-001` · **Issue:** MM-03 · **Status:** rehearsal draft; submission readiness blocked.

This explanation describes a concept for TicketStub. **TicketStub** is a project name only; product availability is unverified. **A keepsake concept.** Synthetic concept only. No product behavior, live sponsor integration, or measured savings are demonstrated.

## The concept shown

The rehearsal frames one ticket idea as **Context → design → human review**. Conceptual only; implementation is unverified. A proposed reviewer can hold or revise a draft before a **planned** production handoff. This is a proposed review rule, not a verified product feature. The exact hold/revise sentence is mapped by `REHEARSAL-HOLD-REVISE-001` in [`claims.json`](../messaging/claims.json); it remains proposed and unapproved, and does not assert product behavior.

The visual is the existing synthetic stub mockup and conceptual workflow diagram. They are draft assets, not captured application screens. The local review record says brand conformance, asset-specific rights, product behavior, and final visual review remain blocked or pending. A rendered rehearsal therefore uses a text fallback if an image, label, or adjacent qualifier cannot be read.

## What the rehearsal can and cannot demonstrate

| Part of the story | Rehearsal treatment | Evidence state |
| --- | --- | --- |
| Context for a ticket idea | Synthetic concept card | `mock`; no customer, event, or live ticket data |
| Design | Concept diagram | `mock`; it does not represent a shipped application path |
| Human review | Proposed review rule | `planned`; not a verified product feature |
| Hold or revise | Proposed rehearsal wording, mapped by `REHEARSAL-HOLD-REVISE-001`; exact-copy review pending | `planned`; no product control or actual reviewer action is shown |
| Production handoff | A named future step only | `planned`; no order, fulfillment, or transaction is performed |
| Product capability | Pinned `eb8decce` README (after runtime PR #20 merged) documents a runnable Next.js App Router preview; the default demo is simulated with sandbox mail and sandbox orders | `pending`; README-level preview status is not complete product-release acceptance, live sponsor integration, or result evidence |
| Comparison or result | No comparison is shown | `pending`; no measured improvement or savings claim is approved |

The evidence classes remain separate. Neatlogs SPN-01 evidence is pending; no Neatlogs usage claim is approved. Entire SPN-02 checkpoint and graph evidence is pending; no Entire usage claim is approved. CFO.ai SPN-03 business-plan evidence is pending; no CFO.ai use or financial claim is approved. Their architecture, implementation, runtime, reasoning, and result rows are each marked pending in the scene map. One sponsor's evidence cannot substitute for another's.

The official organizer also expects a public video of three minutes or less that explicitly covers all three sponsors across those five categories. This 150-second local rehearsal is not that final demo: it makes the missing evidence visible. The organizer's checked page does not specify a video aspect ratio or file-size limit, so this plan does not assign either one.

## Source pins and review

- Messaging state and exact copy: [`claims.json`](../messaging/claims.json), based on assigned starting revision `90b0865bd6bc4e6198f36b760b2691ff45e12064`.
- Historical product source for the earlier documentation-only rehearsal baseline: [`getticketstub.com` ownership at `5a298645`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/5a2986454297dd6df97088a8fbde69adc771f7a0/docs/architecture/OWNERSHIP.md); this is not the current runtime status.
- Current producer source status, 2026-10-11 UTC: [`getticketstub.com` README at `eb8decce`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/eb8decceeffd29c3c1f1ebf4f6a653ef3a98e073/README.md), after runtime PR #20 merged, SHA-256 `bc8beb6f077034d126756c064ea2b06c9dd1d755758be866bf47492c1442098c`. It documents a runnable preview with a simulated default demo, sandbox mail and sandbox orders; `/api/agent` answers 204 outside live mode and arbitrary event links are demo-only. This is source availability, not producer acceptance or approved wording; it does not establish the full product journey, real payment, email, fulfillment, live provider/sponsor behavior, hosted persistence, or release acceptance. GT-10B and GT-12 issue #6 remain open. Earlier pin, historical only: `7f59d339` (PR #22). This status text came from read-only source inspection and did not rerun the source; separate limited local observations of this revision were cancelled mid-QA, no runtime media was committed, and this rehearsal remains conceptual.
- Sponsor and comparison evidence index: [`integration-evals` at `ff1f6d2`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/evidence/README.md), planned index; no completed results established.
- Neatlogs use: [SPN-01 evidence issue](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20), pending.
- Entire use: [SPN-02 evidence issue](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/10), pending.
- CFO.ai use and plan: [SPN-03 evidence issue](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3), pending.
- Current event format and sponsor coverage: [official neatHack page](https://neatlogs.com/hackathon), checked 2026-10-11 UTC.

**Review status:** Exact wording is mapped to the ledger or marked as a scene-map proposal. Product owner, source owners, rights/brand/accessibility review, and independent candidate review remain pending. Do not present this concept as implementation, use, result, or submission evidence.
