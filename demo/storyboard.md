# Timed rehearsal storyboard

**Asset:** `DEMO-STORYBOARD-001` · **Acceptance:** MM-03-A/B/C  
**Status:** complete local rehearsal plan; not a final demo or submission-ready release.  
**Target:** 150 seconds (2:30), within the 120–150 second target and below the current official maximum of 180 seconds.

The scene contract for UI rendering is [`rehearsal-scenes.json`](rehearsal-scenes.json). Render it as a silent local video and use its `captionText` exactly. Keep every concept label visible alongside the related content. The complete accessible transcript is [`rehearsal-transcript.md`](rehearsal-transcript.md).

## Scene order

| Scene ID | Time | Duration | Audience purpose | Display source | Claim and status |
| --- | ---: | ---: | --- | --- | --- |
| `scene-01-concept-title` | 00:00–00:13 | 13s | Identify the project concept and label the artifact synthetic | `DEMO-SCREENSHOT-SET-001` · `demo/screenshots/synthetic-stub-mockup.svg` | `CLAIM-PRODUCT-NAME-001`, `CLAIM-KEEPSAKE-CONCEPT-001`, `CLAIM-SIMULATION-001` |
| `scene-02-context-design-review` | 00:13–00:27 | 14s | Establish the conceptual journey from context to design to review | `DEMO-WORKFLOW-DIAGRAM-001` · `demo/diagrams/demo-workflow.svg` | `CLAIM-PROCESS-CONCEPT-001`; proposed scene wording is pending ledger join |
| `scene-03-hold-revise-handoff` | 00:27–00:43 | 16s | Make the human hold/revise decision and planned handoff explicit | `DEMO-WORKFLOW-DIAGRAM-001` · `demo/diagrams/demo-workflow.svg` | `CLAIM-HUMAN-APPROVAL-CONCEPT-001`; proposed scene wording is pending ledger join |
| `scene-04-product-evidence-status` | 00:43–00:59 | 16s | Distinguish documentation from product runtime evidence | `DEMO-EXPLAINER-001` · `demo/product-explanation.md` | `CLAIM-PRODUCT-CAPABILITY-001`, `CLAIM-NO-RESULTS-VERIFIED-001` |
| `scene-05-neatlogs-evidence` | 00:59–01:14 | 15s | Allocate all five organizer-required Neatlogs evidence facets | `DEMO-SUBMISSION-NARRATIVE-001` · `demo/submission-narrative.md` | `SPN-01`; architecture, implementation, runtime, reasoning, result all `pending`; provider mode `not_run` |
| `scene-06-entire-evidence` | 01:14–01:29 | 15s | Allocate all five organizer-required Entire evidence facets | `DEMO-SUBMISSION-NARRATIVE-001` · `demo/submission-narrative.md` | `SPN-02`; architecture, implementation, runtime, reasoning, result all `pending`; provider mode `not_run` |
| `scene-07-cfo-ai-evidence` | 01:29–01:44 | 15s | Allocate all five organizer-required CFO.ai evidence facets | `DEMO-SUBMISSION-NARRATIVE-001` · `demo/submission-narrative.md` | `SPN-03`; architecture, implementation, runtime, reasoning, result all `pending`; provider mode `not_run` |
| `scene-08-comparison-and-results` | 01:44–02:00 | 16s | Show that comparison and outcome evidence are absent | `DEMO-EXPLAINER-001` · `demo/product-explanation.md` | `CLAIM-EVAL02-COMPARISON-001`, `CLAIM-NO-RESULTS-VERIFIED-001`; `pending` |
| `scene-09-submission-gate` | 02:00–02:15 | 15s | List required X submission fields and unresolved official post/cutoff | `DEMO-SUBMISSION-NARRATIVE-001` · `demo/submission-narrative.md` | Official organizer source checked 2026-10-11 UTC; event wording is separately proposed in the scene map |
| `scene-10-status-and-docs-cta` | 02:15–02:30 | 15s | Close with current status and the documentation-only CTA | `LAUNCH-X-CTA-001` · `launch/announcement-copy.md` | `CLAIM-NO-RESULTS-VERIFIED-001`, `CTA-REPOSITORY-DOCS-001` |

## Evidence treatment

The sponsor coverage is deliberately explicit. For **each** of Neatlogs, Entire, and CFO.ai the render allocates a visible row to architecture, implementation, runtime, reasoning, and result. Every row says `pending`; every sponsor scene also names the corresponding evidence class (`SPN-01`, `SPN-02`, or `SPN-03`) and `providerMode: not_run`. Do not insert sponsor screens, outputs, traces, checkpoints, financial plans, or results unless source owners supply pinned, sanitized evidence and the appropriate review.

This story has no performance graph, savings figure, forecast, live integration, customer record, or product-runtime screenshot. The local mockup/diagram are synthetic concept drafts. If one is missing, unclear, or cannot retain its label, use the scene's plain-text fallback from the JSON contract.

## Current external submission gate

The [organizer page](https://neatlogs.com/hackathon) was checked on 2026-10-11 UTC. It requires a video no longer than three minutes, public repository/supporting evidence, and sponsor coverage across architecture, implementation, runtime, reasoning, and result for each sponsor. It says to quote the official neatlogs post on X with team, name, project, public repository, and demo link; the final cutoff is announced on Discord. The post URL, final cutoff, submitter, team, final project name, public project-repository URL, demo URL, and submitter authorization remain pending here.

The story is therefore ready for **local rehearsal rendering only**. It does not prove a product workflow and cannot substitute for the required final demo or external evidence.
