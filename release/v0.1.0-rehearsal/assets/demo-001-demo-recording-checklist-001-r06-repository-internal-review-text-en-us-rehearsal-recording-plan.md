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
- **CFO.ai / SPN-03:** per `CLAIM-SPN-03-CFO-001`, an authentic plan is available as producer evidence at integration-evals revision 2 (`6420af494a5276f69c337f47dac3ad4c1854d524`, PR #24, merged as `f375fcf20584f5c98dbd4f3b69f884c52994224e`). Two decisions are recorded separately and in order: a relayed owner acceptance (a chat decision, not an independent human GitHub review), then a later independent Finance `REQUEST_CHANGES` `CFO-R2-001` because the generic export turns genuinely blank opening cash into zero. That finding is unresolved; no package-wide Finance approval or waiver exists, and the authoritative cost-intelligence export (issue 3) is pending. Availability and owner acceptance do not approve any CFO.ai use or financial claim, and the five-facet evidence and Finance/reliability review stay `PENDING`.
  - Reviewer workbook `cfo-native-export.xlsx` SHA-256: `43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14`.
  - Generic workbook `cfo-native-export-generic.xlsx` SHA-256: `969941bac6f07d9678bb04238f0d5167baab9956f5e320bb33b77841be809416`. The generic export is not an accepted editable forecast.
  - Before any CFO.ai screen is recorded: name the exact revision and workbook hash on screen or in notes; keep every forecast labeled "hypothetical forecast"; show only owner-authorised, public or synthetic plan data, with login, credentials, secrets, customer or private financial details and unapproved workspace contents redacted (a human may view the owner-selected plan in their own account); and never present the generic export as accepted. Do not state or compute financial figures here.
- **Comparison / EVAL-02:** comparable baseline and candidate runs, a reviewed method, and pinned outputs before any comparative, timing, efficiency, or savings result appears.
- **Privacy, rights, and accessibility:** format-specific source/derivative lineage, permission for the actual destination, sanitized evidence, redaction review, rendered pixel/text/metadata inspection, visible qualifiers, exact alt text/captions/transcript, and reviewer/date. Current mockups and the text-only canary do not pass media rights or pixel review.
- **Brand and exact claims:** approved brand subset and candidate review; supervisor joins any proposed scene wording to the exact claim ledger and obtains source-owner and destination decisions. Any source, wording, evidence, crop, or destination change triggers review again.
- **Submission details:** current organizer page, official X post URL, actual Discord cutoff, accountable submitter authorization and name, public demo URL, and supporting evidence links. Team, project, repository and business-plan values are known (wording review pending). Verify those values immediately before submission.

## Human recording runbook

The planned, timed human handoff is [`human-recording-runbook.md`](human-recording-runbook.md) (`DEMO-HUMAN-RECORDING-RUNBOOK-001`, internal and not an approved final v1). It is a plan only: no dry run, phone QA, teammate rehearsal or recording has happened. It plans a live video of the deployed build and the public sponsor evidence, which is separate from the silent concept rehearsal above, and it does not make any pending item complete.

Newer available sources (availability only, not approval):

- **Entire / SPN-02:** public source at `a9d68ef0116b1c20f7d70e0161016e21b4bb13b7` ([PR #31](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/31)) records manual GitHub Actions runs of Entire CLI `v0.11.4` and `entire-graph` `v0.4.0` on ten repository commits, with run URLs and checksum-verified snapshots. These are saved execution outputs and real graph results; the one historical checkpoint bound to `3358f0d` stays limited. SPN-02 remains `PENDING`.

- **Neatlogs / SPN-01:** public source at integration-evals `31b4f53b46a584c4b5b4a6a7076f6800c37b00e5` ([PR #35](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/35), corrects PR #33). Owner acceptance was relayed in chat; the independent `NL-R1/2/3` `REQUEST_CHANGES` history stays. SPN-01 remains `PENDING`.
- **CFO.ai / SPN-03:** the owner relay ([issue 22 comment 6118253750](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118253750)) selects the CFO segment and the **reviewer** workbook (`43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14`, blank-safe opening-cash guards) at public r2 `6420af49…` (merged `f375fcf2…`). The r2 README records repairs in the native CFO.ai canvas, a native export, a saved narrative and overview, and desktop-Excel input-change verification. This does not resolve `CFO-R2-001`, does not waive Finance review, approves no package or actual sales, and every forecast stays hypothetical.
- **Recorder:** Crystal is confirmed as recorder in the same relay. No GitHub handle is recorded and none is needed to record. The editor (if separate) and the human submitter are not confirmed; "likely lejefa/completedotech" is tentative with no role mapping. The submitter uses their own X account and name. The relay does not reauthorize agent capture.
- **Canonical runbook rows:** `CLAIM-RUNBOOK-SPN-01-AVAIL-001`, `-SPN-02-AVAIL-001`, `-SPN-03-AVAIL-001` and `CLAIM-RUNBOOK-ENTRY-FIELDS-001` are planned and pending, with the runbook as their only destination. The runbook uses their exact allowed wording and qualifiers (project name only, product availability unverified; no figures; `CFO-R2-001` unresolved). They are not caption, narration or X copy and approve nothing. No product row exists, so the product beats in the runbook stay instruction-only until the producer confirms the deployed build, cleared example, mode, approval step and download behavior.
- **Entry fields:** Team Jevelopers, Project TicketStub, the public repository URL and the required business-plan URL are known (four `CLAIM-X-DEST-*` rows, wording review pending). Still unknown: submitter name, demo URL, official post URL, Discord cutoff and posted-entry URL.
- **Product build:** a newer source (`6daa197`) was reported but not published as of [issue 22 comment 6118271571](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118271571). The exact approved deployed commit and a producer rehearsal are needed before the final take.

## Capture status and roles

Agent capture is cancelled and stays stopped. Restarting any agent capture requires a separate, fresh, explicit authorization. The recorder and the submitter are human teammates, and no agent posts, uploads, or submits.

SPN-01 and SPN-02 remain `PENDING`. Entire's public source is available: saved GitHub Actions execution outputs and graph results, plus one limited historical checkpoint. That is source availability, not approval, and no live agent hook is claimed.

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
| SPN-03 CFO.ai | `PENDING` | Plan available at r2 (owner acceptance recorded); `CFO-R2-001` unresolved; five-facet evidence and Finance/reliability review still needed |
| EVAL-02 comparable result | `PENDING` | Reproducible baseline/candidate data and reviewed method |
| EVAL-04 privacy/redaction | `PENDING` | Sanitized, format-specific media review |
| Brand, rights, accessibility, CTA | `PENDING` | Exact-source approvals, rendered checks, destination review |
| Official post, cutoff, required links, submitter authority | `PENDING` | Current organizer/Discord information and confirmed fields |

Review roles listed here are routing obligations only; no approval is claimed or requested by this document. The user-assigned marketing-material supervisor remains accountable for this candidate's copy and handoff, while source owners retain evidence, product, brand, rights, finance, and destination authority.
