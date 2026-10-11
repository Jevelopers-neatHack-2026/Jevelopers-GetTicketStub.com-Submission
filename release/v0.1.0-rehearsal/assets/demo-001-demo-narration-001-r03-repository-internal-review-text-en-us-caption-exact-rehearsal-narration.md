# Timed narration and caption script

**Asset:** `DEMO-NARRATION-001` · **Status:** internal rehearsal copy; source-owner, rights, brand, and exact-copy review pending.

Use the `narration` field in [`rehearsal-scenes.json`](rehearsal-scenes.json) as the recording source. It matches each scene's `captionText` exactly. The current render is silent and local; no TTS or paid provider is used. Keep the captions, on-screen status, and accessible transcript synchronized after any copy change.

## Script

| Scene | Time | Narration / exact caption |
| --- | ---: | --- |
| `scene-01-concept-title` | 00:00–00:13 | TicketStub. Project name only; product availability is unverified. A keepsake concept. Synthetic concept only. No product behavior, live sponsor integration, or measured savings are demonstrated. |
| `scene-02-context-design-review` | 00:13–00:27 | Here, one ticket idea moves from context to design and a human review. Context → design → human review. Conceptual only; implementation is unverified. |
| `scene-03-hold-revise-handoff` | 00:27–00:43 | A reviewer may hold or revise this draft; production handoff is planned. Approval before production. This is a proposed review rule, not a verified product feature. |
| `scene-04-product-evidence-status` | 00:43–00:59 | Product capability, automation, and transaction copy is pending pinned product-release evidence. No product or sponsor results verified. |
| `scene-05-neatlogs-evidence` | 00:59–01:14 | Architecture: pending. Implementation: pending. Runtime: pending. Reasoning: pending. Result: pending. Neatlogs use evidence is pending; no Neatlogs usage claim is approved. |
| `scene-06-entire-evidence` | 01:14–01:29 | Architecture: pending. Implementation: pending. Runtime: pending. Reasoning: pending. Result: pending. Entire checkpoint and graph evidence is pending; no Entire usage claim is approved. |
| `scene-07-cfo-ai-evidence` | 01:29–01:44 | Architecture: pending. Implementation: pending. Runtime: pending. Reasoning: pending. Result: pending. CFO.ai business-plan evidence is pending; no CFO.ai use or financial claim is approved. |
| `scene-08-comparison-and-results` | 01:44–02:00 | No measured improvement or savings claim is approved; comparable baseline evidence is pending. No product or sponsor results verified. |
| `scene-09-submission-gate` | 02:00–02:15 | Quote-post the official neatlogs post with team, name, project, public repository and demo link. The final cutoff is announced on Discord. Official submission post URL and confirmed cutoff: pending; recheck the organizer page and Discord before submission. |
| `scene-10-status-and-docs-cta` | 02:15–02:30 | No product or sponsor results verified. Explore the repository docs. |

The five proposed scene rows are identified in the scene-map `ledgerJoinProposals` array and mapped to `messaging/claims.json`; they remain unapproved. The supervisor must route them through review before any status change. Do not treat this script as source-owner approval or as a final public voice-over.
