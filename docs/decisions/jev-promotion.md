# JEV promotion evaluation policy

**Status:** Proposed; owner decisions pending. Policy revision `1.0.0`; checked-in corpus `jev-ei-synthetic-smoke-fixture-1.0.0`.

This decision record addresses EI-12P and JEV-EI-07 and contributes evidence to EVAL-02, EVAL-03, and EVAL-04. It does not verify the global acceptance criteria or other owners' deliverables. Agent and research owns domain questions and corpus adjudication. Finance and reliability owns comparable cost/quality review and published-evidence review. Product and frontend reviews evidence classification and presentation. The original global roles remain in the policy file.

No owner approval is claimed. The checker has no trusted role-signing keys or authenticated owner-decision source, so local approval fields, copied receipts, or hashes cannot authorize promotion. Approval and promotion remain fail-closed until an authenticated review mechanism and the required evidence exist.

## Proposed decision targets

These are concrete values for owner review, not approved promises, measured results, or paid-call authorization:

- For a standard workflow of three seeds, at most 12 source pages, 20 passages, and one correction, end-to-end latency is at most 20 seconds at p50 and 60 seconds at p95. A single question is at most 1,000 ms at p50 and 3,000 ms at p95, including provider wait and retries. Report cold and warm cache separately.
- All-in downstream cost is at most **USD 5.00 per event-case / arm / seed**, including billable retries, retrieval and provider use, review, one correction, and attributable downstream creative correction. Unknown cost is not zero and fails the cost gate. The proposed total for the three required arms is **USD 10,800**: 3 arms × 240 held-out cases × 3 seeds × USD 5.00. A separate optional vision arm adds a proposed **USD 3,600** cap and needs separate approval.
- All hard quality and deterministic safety floors must pass. Relative to deterministic-only, the candidate rule requires either at least a 5 percentage-point gain in adjudicated correct final package rate within the per-case cap, or at least a 20% decrease in total downstream cost per correct package while remaining within a 1 percentage-point quality non-inferiority margin. No hard-gated metric may regress by more than 1 percentage point.
- Proposed relative error severity is 1 point for false source exclusion and a benign quoted-content false alarm, and 5 points for unsupported fact acceptance, wrong-occurrence merge, missed date/venue conflict, and wrong-entity asset acceptance. Unauthorized capability or scope expansion has zero tolerance regardless of model score.

Finance and reliability must accept or replace the latency, cost, rate-card, error-cost, and tradeoff terms. Agent and research must accept or replace question thresholds, slices, and adjudication rules. These decisions are pending. A status edit or local receipt hash is not proof of owner review.

## Questions and measurement

The versioned registry covers seven questions: source type, relevance, injection signal, occurrence identity, factual support, conflict, and brand role. Every entry declares its classes, positive/negative/unknown grouping, candidate thresholds, metric formulas and denominators, calibration-only threshold selection, negative slices, and confidence interval method.

The proposed targets include 0.98 overall relevance recall and 0.95 per language/noisy slice; 1.00 critical-evidence retention; 0.97 same-occurrence precision; 0.98 accepted-support correctness; 0.95 missing-evidence recall; 0.95 conflict precision and recall; at least 0.60 eligible adequate-evidence automatic coverage; and zero unauthorized capability or scope expansions. Source type, injection, and brand-role thresholds are also in `promotion-v1.json`. These values are proposals only.

Report per-question positive, negative, and unknown counts with their denominators; confusion matrices where applicable; false exclusions; false merges and splits; unsupported acceptance; conflict misses; asset-role and wrong-entity errors; uncertainty/abstention; eligible automatic coverage; and every required negative slice. A zero denominator is `not_applicable` and blocks that gate, never zero. The candidate interval method is a 10,000-resample percentile cluster bootstrap over independently adjudicated event/source families, fixed seed 424242, with 95% intervals.

## Authored smoke fixtures and split lock

`evals/corpus/authored-cases.jsonl` contains 20 individually authored fictional event-research fixtures: 10 calibration and 10 held-out. Each split has one case from each of the ten required scenario families. Held-out includes eight non-English cases across Spanish, French, German, and Japanese. The texts and seven label expectations are explicitly authored and the two unsupported-source cases leave occurrence identity uncertain because the content supplies no occurrence evidence.

These expectations have **not** been independently adjudicated. The `source_family_id`, `event_family_id`, and `template_family_id` values are case-scoped fixture identifiers used to test artifact linkage. They do not certify independent real-world events or source families. The corpus is not benchmark-eligible and cannot establish quality, calibration, safety, cost, latency, permission, privacy, or live qualification.

Required acceptance minima remain 120 calibration cases, 240 held-out cases, 20 held-out cases per required family, and 40 held-out non-English cases across at least four languages including a CJK language. The checked-in smoke fixture falls short of each count minimum. The checker reports these as promotion blockers rather than treating a smaller fixture set as a benchmark. Agent and research must provide the permission-audited, human-adjudicated corpus and independent family-lineage review. Finance and reliability must review permission/privacy evidence. Held-out threshold tuning remains prohibited.

The fixtures contain no external sources, customer records, image bytes, external asset URLs, or reproduction-rights claims. They use fictional event names and `fixture://` evidence references. The checker screens text for email-like addresses, phone numbers, and external URLs.

Policy, question registry, manifest, split-lock, and evaluation-artifact storage formats are explicitly versioned. Preserve previously supported fixtures as immutable history or document an owner-reviewed migration, and review changes with affected producers and consumers. The checker rejects an unsupported manifest or lock schema version with an actionable validation error instead of coercing it. No application event-store or runtime storage implementation exists in the inspected base revision, so its storage version remains outside this contribution.

Materialize the split artifacts from the authored cases with:

```sh
python3 evals/build_synthetic_corpus.py
```

This command only maps the checked-in authored cases to observations, labels, manifest, and split lock. It does not create or pad benchmark rows. Membership changes require a reviewed corpus/lock version update and impact record. The held-out use ledger is empty and marked `not_consumed`.

## Bounded comparison plan

Before any comparison, pin the question registry, application schema, policy, JEV model and adapter, deterministic baseline, generative baseline, dependencies, and runtime. A change to any of those pins, thresholds, or the configured workload/budget requires a fresh three-arm comparison with a new held-out version after calibration and budgets are refrozen. Do not use a moving model alias or tune on held-out data. Use identical input identities and configured budgets across deterministic-only, active JEV-assisted, and pinned generative-baseline arms. The planned comparison uses 240 held-out cases and three seeds per arm, at most 12 source pages, 20 passages, and one correction. Report cold and warm results separately.

JEV questions are staged to preserve dependencies. Stage 1 batches the independent source type, relevance, injection, identity, and brand-role questions over the common pinned state. Stage 2 batches factual support and conflict after the stage-1 identity result is available. Each batch is capped at 10,000 input and 2,000 output tokens. Across 240 cases × 3 seeds, the two stages produce 1,440 initial batches. At most one retry per case-seed across all stages adds 720 batches, for ceilings of 2,160 billable attempts, 21.6 million input tokens, and 4.32 million output tokens. Published input pricing for candidate `jev-1.13.0` is USD 0.042 per million tokens and published output pricing is free, so the candidate input ceiling is USD 0.9072 and output ceiling USD 0.00. Charge input once per batch even when it contains several independent questions; count a retry as a separate batch.

The candidate and published rate come from the [official TypeSafe model documentation](https://docs.typesafe.ai/models), inspected 2026-10-10. Candidate endpoint is `/v1/systemone`. Account access, invoice rate card, eligibility, actual dispatch, and billed use remain unverified. This is not an accepted runtime pin or a budget grant.

For the text generative baseline, cap each case attempt at 10,000 input and 2,000 output tokens, with one retry: 1,440 attempts maximum, 14.4 million input tokens, and 2.88 million output tokens. Provider/model and both token prices remain unknown, not zero, so this arm cannot run until reviewed and priced. The separate vision arm is capped at two image inputs and 2,000 output tokens per case attempt, or 2,880 image inputs, 1,440 attempts, and 2.88 million output tokens. Vision model and image/token prices are unknown, its cost ceiling remains null, and no permission-audited image corpus exists. Real visual qualification is blocked.

The deterministic arm has no model tokens, up to 720 case/seed executions, and 1,440 end-to-end attempts including one retry; retrieval and review cost must still be metered. The USD 5.00 per-case/arm/seed all-in ceiling already includes retries and one correction. The USD 10,800 comparison cap covers only the three required arms; it is arithmetic for owner review, not paid authorization. No provider or paid calls are authorized.

Before a comparison, retain raw outputs, sample and slice counts, component and dependency revisions, schema and model pins, per-stage usage and total downstream cost, p50/p95 cold and warm latency, sanitized trace/evidence references, negative results, and limitations. No application implementation, baseline result, provider call, paid call, runtime/model pin, measured latency, or cost record exists at this revision.

The checker validates policy and corpus artifacts only. It does not execute model evaluation, application security acceptance, or a live comparison. EVAL-03 evidence-presentation review and EVAL-04 published-evidence review remain pending. Later comparison and release obligations remain with [EI-12E](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/21) and [EI-12R](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/22). EI-12P approval alone cannot promote the classifier or close those gates.

## Commands and current expected result

Structural validation should accept the artifacts but report the undersized corpus and unresolved decisions as blockers, exiting zero with `--validate-only`:

```sh
python3 evals/check_policy.py --policy evals/policies/promotion-v1.json --corpus evals/corpus/manifest.json --validate-only
```

Promotion validation should exit `2` with `status: "blocked"`. It reports all seven question-label summaries, positive/negative/unknown counts and denominators, corpus minima and actual counts, held-out consumption, and blockers:

```sh
python3 evals/check_policy.py --policy evals/policies/promotion-v1.json --corpus evals/corpus/manifest.json
```

Exit `1` indicates malformed or inconsistent artifacts; exit `2` indicates structurally valid artifacts with unresolved approval or evidence gates. Neither synthetic-fixture admission nor successful structural validation is a promotion pass.
