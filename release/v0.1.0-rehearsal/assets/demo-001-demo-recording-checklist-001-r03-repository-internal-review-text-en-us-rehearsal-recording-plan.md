# Recording and rehearsal handoff

**Asset:** `DEMO-RECORDING-CHECKLIST-001` · **Acceptance:** MM-03-C
**Current result:** local silent rehearsal may be rendered at 150 seconds. Final submission recording is **BLOCKED** pending evidence, official fields, permission, and review. A rehearsal does not satisfy or substitute for the final demo.

## Current rehearsal build

1. Read [`product-explanation.md`](product-explanation.md), [`storyboard.md`](storyboard.md), [`narration.md`](narration.md), [`rehearsal-scenes.json`](rehearsal-scenes.json), and [`rehearsal-transcript.md`](rehearsal-transcript.md) from the same candidate revision.
2. Render locally as a silent video. Use the JSON `captionText` exactly; verify it equals `narration` and the transcript. Do not use TTS, paid providers, or unapproved external media.
3. Keep visible the concept, mock, planned, and pending labels and all adjacent claim qualifiers. Use the listed fallback if a concept label, caption, or qualification would be obscured or unreadable.
4. Show each sponsor's own five-row matrix (architecture, implementation, runtime, reasoning, result) with every row `PENDING`, the correct SPN identifier, and `providerMode: not_run`. Do not render a fake trace, checkpoint, plan, run, metric, or result.
5. Confirm scene order and timing. The current script is 150 seconds; the current official organizer maximum is three minutes (180 seconds). Leave room below 180 seconds for final caption timing and production edits.
6. Reopen the exported rehearsal and the transcript. Confirm every spoken word is captioned, each matrix and status appears in text, and the closing label says submission readiness is blocked.

The official organizer source checked 2026-10-11 UTC is [neatlogs.com/hackathon](https://neatlogs.com/hackathon). It does not specify a video aspect ratio or file-size limit. Do not invent or inherit a video constraint from the separate X image guidance.

## Final recording blockers

Do not turn the rehearsal into a final demo until each item below has a pinned, reviewable source and owner decision:

- **Product behavior:** the source used by the earlier documentation-only rehearsal baseline is historical (`getticketstub.com` ownership at `5a298645`). The pinned `eb8decce` source, after runtime PR #20 merged, documents a runnable Next.js App Router preview with sandbox mail and sandbox orders; the default demo is simulated (earlier `7f59d339` pin from PR #22 is historical). Source availability is not producer acceptance, and the separate limited local observations of that revision were cancelled mid-QA with no runtime media committed. That preview description is not proof of the complete product journey, live sponsor/provider behavior, production readiness, or release acceptance; GT-12 issue #6 remains open. The product owner must supply the validated journey and relevant implementation/failure evidence before it can support a final demo.
- **Neatlogs / SPN-01:** source-owned, sanitized evidence for architecture, implementation, runtime, reasoning, and result; each field remains distinct and the usage claim receives source-owner review.
- **Entire / SPN-02:** source-owned, sanitized evidence for architecture, implementation, runtime, reasoning, and result, including the required checkpoint/graph material; no Neatlogs evidence can fill this class.
- **CFO.ai / SPN-03:** the actual business plan and owner-reviewed evidence for architecture, implementation, runtime, reasoning, and result; no placeholder or estimate can stand in for the plan.
- **Comparison / EVAL-02:** comparable baseline and candidate runs, a reviewed method, and pinned outputs before any comparative, timing, efficiency, or savings result appears.
- **Privacy, rights, and accessibility:** format-specific source/derivative lineage, permission for the actual destination, sanitized evidence, redaction review, rendered pixel/text/metadata inspection, visible qualifiers, exact alt text/captions/transcript, and reviewer/date. Current mockups and the text-only canary do not pass media rights or pixel review.
- **Brand and exact claims:** approved brand subset and candidate review; supervisor joins any proposed scene wording to the exact claim ledger and obtains source-owner and destination decisions. Any source, wording, evidence, crop, or destination change triggers review again.
- **Submission details:** current organizer page, official X post URL, actual Discord cutoff, accountable submitter authorization, final team/name/project fields, public project-repository URL, public demo URL, and supporting evidence links. Verify those values immediately before submission.

## Final capture sequence

1. Freeze the exact script, scene map, source revisions, supported runtime, and approved assets. Record their checksums and the final asset/claim/provenance IDs.
2. Replace a pending scene only with evidence approved for that sponsor/class. Keep unavailable evidence explicitly pending; stop rather than fill the gap with simulated output.
3. Capture each source and relevant state at readable size, preserving context, design, actual human review, any real hold/revise decision, and the actual production handoff. Never imply a transaction occurred unless it did and is authorized for this recording.
4. Record one continuous timed pass and the final edit. Confirm each sponsor scene visibly covers its five required facets and links or labels the specific evidence. If a result is absent, retain a pending statement and do not call that sponsor coverage complete.
5. Reconcile voice-over, captions, transcript, on-screen labels, alt text, sources, and the final export. A copy, crop, source, or mode change invalidates affected review.
6. Check the official submission post, Discord cutoff, and ordinary X post composer constraints again. No post, upload, or submission is part of this handoff.

## Review record to complete before external use

| Review | Current state | Evidence needed |
| --- | --- | --- |
| Product behavior and product owner review | `BLOCKED` | Pinned runtime/evidence and owner decision |
| SPN-01 Neatlogs | `PENDING` | Its own five-facet evidence and source-owner review |
| SPN-02 Entire | `PENDING` | Its own five-facet checkpoint/graph evidence and source-owner review |
| SPN-03 CFO.ai | `PENDING` | Actual plan, five-facet evidence, and Finance/reliability review |
| EVAL-02 comparable result | `PENDING` | Reproducible baseline/candidate data and reviewed method |
| EVAL-04 privacy/redaction | `PENDING` | Sanitized, format-specific media review |
| Brand, rights, accessibility, CTA | `PENDING` | Exact-source approvals, rendered checks, destination review |
| Official post, cutoff, required links, submitter authority | `PENDING` | Current organizer/Discord information and confirmed fields |

Review roles listed here are routing obligations only; no approval is claimed or requested by this document. The user-assigned marketing-material supervisor remains accountable for this candidate's copy and handoff, while source owners retain evidence, product, brand, rights, finance, and destination authority.
