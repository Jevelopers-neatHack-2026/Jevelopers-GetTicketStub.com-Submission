# Messaging policy

This directory holds the exact-copy claim ledger consumed by demo, launch, and landing-page work. The ledger is a draft: product, sponsor, financial, route, rights, and independent review evidence is not complete, so release readiness is blocked. Exact copy mappings bind the current visual handoff, static HTML page, and accessible alternatives to specific claim/CTA IDs, provenance records, checksums, and the source commit that contains each file.

## What can be said now

- The pinned brand source says “No forms: drop your ticket and it's done.” Preserve it as positioning only, and keep the explicit qualifier with it. It does not prove autonomous completion, a form-free workflow, or a zero-input result.
- Product name and visual concept wording may appear only in the synthetic-concept context and with the qualifications in claims.json.
- A safe draft sentence for current concept material is “Synthetic concept only. No product behavior, live sponsor integration, or measured savings are demonstrated.”
- “No product or sponsor results verified.” is a status warning, not a result or endorsement claim.
- The five documentation/text-alternative CTAs listed in `claims.json` have exact wording and repository targets reviewed by the user-assigned accountable marketing-material supervisor on 2026-10-11 ([decision receipt](https://github.com/Jevelopers-neatHack-2026/marketing-material/pull/14#issuecomment-6105269875)). This is limited to those words and repository destinations. It does not approve the text alternative’s content/accessibility, brand or rights, product behavior, or release, and it confirms no application or landing-page transaction route.

All other capability, automation, live-integration, sponsor-use, comparative, savings, forecast, purchase, or financial claims are blocked or omitted until their exact evidence and owner review are recorded.

## Current visual candidate

The integrated tree contains a conceptual workflow, fictional ticket mockup, static HTML rehearsal page, and draft X key visual. Their exact SVG/PNG/HTML/alt-text paths and copy are inventoried; no generic screenshot directory or actual product screenshot is claimed. The SVG/PNG assets and all render previews were inspected by the author; a separate controlled synthetic fixture tests pixel, metadata, comment, and accessible-description removal. The text validator checks the receipt/checksum/copy joins but is not a general media scanner. Independent content/accessibility review, source-owner rights, brand, and destination approvals remain pending.

## Authority and source changes

Use the source-precedence list in claims.json. Brand-kit owns identity and vocabulary; landing-page-repo owns page composition and runtime; getticketstub.com owns product behavior; integration-evals and sponsor owners own comparisons and sponsor evidence; cost-intelligence owns financial definitions and actuals. The repository README, an issue, architecture notes, a proposed PR, a mock, or this policy alone cannot substantiate end-to-end behavior or a measured result.

Each source reference must identify repository, path, immutable revision, and evidence classification. A source revision change invalidates affected review and approval. A planned evidence index is a pointer to future evidence, not proof. The current product source pin is the [`getticketstub.com` README at `7f59d339`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/7f59d33922a0585205547d490b288b49eed32419/README.md), merged in [PR #22](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/22). It documents an existing Next.js App Router preview, default demo fixtures and simulated art/agent responses; no live provider calls were made to validate it. This establishes neither a deployed/accepted customer journey nor product-release readiness. For scoped adapter wording, use GT-10B #19 evidence; complete customer-application v1/release claims need a sanitized versioned GT-19 capability manifest and GT-12 #6 producer acceptance evidence.

EVAL-03 keeps the master evidence labels simulated, sandbox, live, estimated, and pending. Mock and planned are additional copy states that distinguish a conceptual asset or future work; do not replace the canonical labels. Never describe a simulation, sandbox, mock, plan, or estimate as a live result.

Neatlogs, Entire, and CFO.ai remain separate evidence classes: SPN-01 requires Neatlogs-specific run evidence; SPN-02 requires Entire checkpoint/graph evidence; SPN-03 requires the actual CFO.ai business plan and finance review. Evidence from one class cannot fill another. The current pinned integration-evals index is planned, and these three sponsor evidence references remain pending.

## CTA boundary

Marketing reviews the exact words and the intended action. The product or landing route owner must separately confirm the exact target and that it is implemented and available. The repository-documentation CTA is scoped to the existing README at a pinned revision. A local text-alternative CTA can be approved only with exact wording review, a tracked repository-relative target, and explicit route reviewer/date. Application, purchase, submission, demo, and landing conversion routes have no approved target or availability and must not be promoted.

## Readiness scopes

Run draft validation first, then `python3 tools/validate_collateral.py --mode selected --select ASSET_ID` to evaluate one known collateral asset, or repeat `--select` for a nonempty selection. The CLI runs the full structural/source/copy/inventory pass before readiness. Direct API callers must call `validate_all(...)` first, then `selected_collateral_blockers(...)` or `submission_blockers(...)`. Readiness checks only selected assets and their mapped claims, per-asset qualifier contexts, used CTAs, source/export/alternative rights, and lineage. Unknown or duplicate IDs are rejected. Pending internal guardrails and the canary do not block an unrelated selected asset.

Run `python3 tools/validate_collateral.py --mode submission --select ASSET_ID` to add the explicit final assets, product and EVAL/SPN evidence, brand review, organizer rules/cutoff, and independent content/accessibility review in `docs/collateral-inventory.json`. The current final package remains blocked. `--mode release` is a backwards-compatible fail-closed alias over the default visual asset set, not an approval sweep of every unused claim or CTA.

## Before downstream use

For each exact public sentence or CTA, record the claim/CTA ID next to the asset. Preserve the qualifier in every crop and accessible alternative. Follow review/messaging-checklist.md, then re-run draft validation and the appropriate selected/submission mode after any copy, source, mode, evidence, route, or destination change. Until an owner approves the exact row and all applicable gates pass, keep the copy in draft or omit it.
