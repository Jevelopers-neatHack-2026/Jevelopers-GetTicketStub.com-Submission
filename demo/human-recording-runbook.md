# Human recording runbook (planned internal handoff)

**Asset:** `DEMO-HUMAN-RECORDING-RUNBOOK-001` · **Acceptance:** MM-03-C
**Status:** planned internal handoff, not an approved final v1. It is a plan for a human teammate. No dry run, rehearsal, phone QA or recording has been performed from it, and no teammate has reviewed it. Nothing here approves public speaking, captions or publication.
**Not this:** the 150-second silent rehearsal ([`rehearsal-scenes.json`](rehearsal-scenes.json)) is concept footage and stays as it is. This runbook plans a different, live video of the deployed build and the public sponsor evidence. The live video is not a synthetic concept; the old rehearsal's label does not carry over to it. Shot modes are set per shot in section 6.

## 1. Who does what

| Role | Who | State |
| --- | --- | --- |
| Video contributors | **Crystal and Lars**, a team effort | Owner-relayed correction, [issue 22 comment 6118435312](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118435312): Crystal and Lars are each doing a video, and both contributions are preserved. It supersedes the earlier [comment 6118253750](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118253750) reading of Crystal as sole recorder. No GitHub handle is recorded and none is needed to record. Lars is offline; no response is expected and this is not a new blocker. |
| Final assembly / editing | Not confirmed | Open. No assignment is invented. |
| Selected submission video(s) | Not confirmed | Open until the owner chooses. Submitting both videos is not required; the owner selects the submission video(s); the final human receipt is chosen later. |
| Submitter (human X account) | Not confirmed | The user's reply "likely lejefa/completedotech" is tentative. No role mapping is recorded and no handle is inferred. Whoever submits uses their own X account and name for the entry. |
| Submission-form leader | Not confirmed | The authorized human team leader verifies their check-in email and submits for the team. Do not infer this role from a video contributor or X account. |
| Product / deployment owner | Product owner | Confirms the deployed build (section 3). |
| Source owners | Per sponsor, section 6 | Keep evidence, finance, brand, rights and destination authority. |
| Agents | None | **No agent records, posts, uploads or submits.** Agent capture is `CANCELLED_USER_REQUEST_NO_RESTART`; restarting it needs a separate, fresh, explicit authorization. The owner's choice of a recorder does not reauthorize it. |

The user-assigned marketing-material supervisor stays accountable for this copy.

## 2. What the organizer and the entry require

Submission procedure rechecked on 2026-10-12 against the [organizer page](https://neatlogs.com/hackathon) and [submission page](https://neatlogs.com/submission): an authorized teammate attaches the demo video to a public quote-post of the official launch post and includes `@neatlogs`, `@EntireHQ` and `@arithecfo`. The authorized team leader also verifies their check-in email and completes the three-step submission form. **Both steps are required.** Record the posted-entry URL and a redacted final form acknowledgement separately; opening or saving a draft is not submission.

The organizer FAQ confirms the **at most three minutes** limit and coverage of all three tools. Preserve architecture, implementation, runtime, reasoning and result for **each** of Neatlogs, Entire and CFO.ai as a repository acceptance requirement under [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9). That more detailed five-facet wording was not reverified on the currently served organizer pages. Do not weaken the local requirement or invent an aspect ratio or file-size limit. The team, project, repository and business-plan fields and their claim, Finance and permission limits below are unchanged. The latest organizer deadline on Discord remains authoritative and requires confirmation by the human submitter.

These are internal planning instructions, not an entry, permission to publish, or a completed submission. No agent recording, upload, post or form submission is authorized by this update.

| Entry field | Value | State |
| --- | --- | --- |
| Team | Jevelopers | **Known** (`CLAIM-X-DEST-TEAM-001` for the X post; `CLAIM-RUNBOOK-ENTRY-FIELDS-001` for the runbook title card); wording review pending |
| Project | TicketStub | **Known** (`CLAIM-X-DEST-PROJECT-001` for the X post; `CLAIM-RUNBOOK-ENTRY-FIELDS-001` for the runbook title card); wording review pending. Required qualifier: project name only; product availability is unverified. |
| Public repository | `https://github.com/Jevelopers-neatHack-2026/getticketstub.com` | **Known** (`CLAIM-X-DEST-REPO-001`); wording review pending. Locator only. |
| Business plan | `https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/f375fcf20584f5c98dbd4f3b69f884c52994224e/evidence/cfo-ai/2026-10-11-r2` | **Known and required** (`CLAIM-X-DEST-PLAN-001`); wording review pending. Locator only; not Finance approval; `CFO-R2-001` unresolved. |
| Name (submitter) | | **Unknown.** Human submitter's own name. |
| Demo URL | | **Unknown** until the video is published. |
| Official neatlogs post URL | | **Unknown.** Recheck before submitting. |
| Discord cutoff | | **Unknown.** Recheck before submitting. |
| Posted entry URL | | **Unknown** until a human posts. |
| Submission form | `https://neatlogs.com/submission` | Known organizer locator; form completion remains pending. |
| Submission-form leader | | **Unknown.** Confirm the authorized human team leader separately from the X submitter. |
| Final form acknowledgement | | **Unknown** until the human leader submits. Record a redacted confirmation reference and timestamp, not private form contents. |

## 3. Known versus must-confirm before the take

**Known (pin on the pre-take card):**

| Item | Value | Source |
| --- | --- | --- |
| Product source reviewed by the ledger | `getticketstub.com` `eb8decceeffd29c3c1f1ebf4f6a653ef3a98e073` | `CLAIM-PRODUCT-CAPABILITY-001` limitations; source availability only |
| Newer product source reported | `6daa197` (merged #56 agent actions with the `ask_user` fix, and #61 exact download) | [issue 22 comment 6118271571](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118271571): **not published** at that time and `/api/health` had no commit field. The later public receipt [comment 6118956932](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118956932) records the live deployment is the old build versus the local production `6daa` build, with the deployment still missing the health commit (product #82), so the deployed build stays unproven. Product PR 89 checkout is not needed for the take and PR 90 additional styles is not needed before it; the guide sets no gate on either. Not in the claim ledger. |
| Style set | Current 5 editions versus 8 new SVG templates, undecided | [issue 22 comment 6118297805](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118297805). The style count may be omitted until the owner confirms the deployed set. |
| Neatlogs source | integration-evals [`31b4f53b46a584c4b5b4a6a7076f6800c37b00e5`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/31b4f53b46a584c4b5b4a6a7076f6800c37b00e5/evidence/neatlogs/2026-10-11) (PR [#35](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/35)) | `CLAIM-SPN-01-NEATLOGS-001` |
| Entire source | integration-evals [`a9d68ef0116b1c20f7d70e0161016e21b4bb13b7`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/a9d68ef0116b1c20f7d70e0161016e21b4bb13b7/evidence/entire/2026-10-11) (PR [#31](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/31)) | `CLAIM-SPN-02-ENTIRE-001` |
| CFO.ai source | integration-evals r2 [`6420af494a5276f69c337f47dac3ad4c1854d524`](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2), merged `f375fcf20584f5c98dbd4f3b69f884c52994224e` (PR [#24](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/24)) | `CLAIM-SPN-03-CFO-001` |
| CFO.ai workbook to show | **Reviewer** workbook [`cfo-native-export.xlsx`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2/cfo-native-export.xlsx), SHA-256 `43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14`, blank-safe opening-cash guards | Selected by the owner in [issue 22 comment 6118253750](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118253750): "Yes to the CFO.ai segment", with exact revision/hash, hypothetical labels and the generic-export limitation disclosed; re-affirmed in [comment 6118435312](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118435312). A segment choice only, not Finance or package approval |
| Generic workbook | [`cfo-native-export-generic.xlsx`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2/cfo-native-export-generic.xlsx), `969941bac6f07d9678bb04238f0d5167baab9956f5e320bb33b77841be809416` | **Not an accepted editable forecast.** Finance finding [`CFO-R2-001`](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/20#issuecomment-6112840013) is unresolved. |

**Must be confirmed before recording (all open blockers):**

1. The exact deployed product commit and URL, from the product owner (say whether it is `6daa197` or another).
2. A human producer rehearsal of that exact build. Do not record the final take against an unrehearsed build.
3. The deployed style set, if any style count will be shown or said.
4. Who does final assembly and editing, which video or videos are selected for submission, and the human submitter, with the submitter's own account and name.
5. The cleared example input (section 4).
6. Whether a recovery moment is selected (section 5).
7. Prepare the submission fields in section 2 and confirm the intended human roles. Final demo and posted-entry URLs and the final form acknowledgement are collected after the take (section 9); they are not prerequisites for starting the human recording. Recheck the official post and Discord cutoff before submission.
8. A claim row for any product line, or any use of the sponsor wording outside this runbook (section 7).

## 4. Safe example, privacy and redaction

- Use only a public or synthetic example whose use is cleared. The ledger's fictional example is "The paper moon" (`FICTIONAL EVENT / SYNTHETIC EXAMPLE`). At the ledger pin, research uses fixture data for three demo events and refuses other event links as `demo_only`; confirm what the deployed build accepts.
- Label each shot's mode as in section 6. Show the build's own mode label as the build reports it (for example `SYNTHETIC EXAMPLE`, `SANDBOX` or `DEMO`), `PREVIEW ONLY` for physical variants, and `HYPOTHETICAL FORECAST` for finance.
- Hide or blur: real email addresses, QR codes, customer names, tokens, magic links, cookies, URLs with secrets, account menus, other tabs, notifications.
- **Permitted sources.** Prefer the public, sanitized files in the pinned trees. A human may open the owner-authorised, owner-selected CFO.ai plan page in their own account, because the owner chose that segment. Show only the authorised hypothetical plan data. Redact the login screen, credentials, secrets, customer or private financial details, the workspace list, other pages and any workspace content the owner has not approved. If the page cannot be framed that way, show the public screenshot [`cfo-canvas-overview.jpg`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2/cfo-canvas-overview.jpg) and the saved [narrative](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2/cfo-canvas-narrative.md) instead. Neatlogs dashboard links are workspace-only; use the public files in the pinned tree.
- No whole-workspace tour and no transcripts on camera. Agents have no private access, and agent capture, upload and posting stay forbidden and cancelled.
- No paid purchase, print order or budget authority. Checkout is **sandbox**. Card, Print and Framed are preview only and not orderable. A human reviews and approves; do not describe the flow as running without a human decision.
- Do not add images or recordings to the repository.

## 5. Recovery moment

Show recovery **only if** the owner explicitly selects it. The producer's script ([comment 6118223199](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118223199)) lists an optional demo-planner failure and fallback. If selected, label it `DEMO` and show only what the deployed build does. Do not stage a failure and call it a real recovery, and state no improvement or rate. If not selected, drop the beat and use the time for sponsor shots.

## 6. Planned timed shot list (a plan, not an executed dry run)

Planned length: **170 seconds**, an estimate that is not measured performance and sits 10 seconds under the 180-second limit. The producer's 2:50 script in [comment 6118223199](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22#issuecomment-6118223199) is the starting point; it is data, not an approved instruction. The plan is a phone for the product and a desktop for the sponsors. That is a planned sequence, not a guaranteed continuous multi-device take; if the take is two clips, the editor assembles them and the cut is confirmed then.

Shot modes depend on the producer-confirmed deployed build. Until it is confirmed, shots 2 to 5 are placeholders and carry the mode "as the confirmed build reports".

| # | Time | Device | Shot (what the human does) | On-screen mode label | Claim IDs |
| ---: | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | Desktop | Title card: Team Jevelopers, Project TicketStub. | `PLANNED LIVE DEMO`, plus the confirmed build's mode | `CLAIM-RUNBOOK-ENTRY-FIELDS-001` (planned, pending; project name only, product availability unverified) |
| 2 | 0:12–0:30 | Phone | **Input:** open the confirmed deployed URL, enter the cleared example. | build mode as reported | `CLAIM-PRODUCT-CAPABILITY-001` (pending-only wording) |
| 3 | 0:30–0:50 | Phone | **Research:** show the research result. | build mode as reported | same |
| 4 | 0:50–1:10 | Phone | **Edit and approve:** make one change, then approve it as the human reviewer. | `HUMAN REVIEW`, build mode | `CLAIM-HUMAN-APPROVAL-CONCEPT-001`, `REHEARSAL-HOLD-REVISE-001` (both planned) |
| 5 | 1:10–1:20 | Phone | **Save and download:** save, download the file; show Card/Print/Framed as preview only. | `SANDBOX`, `PREVIEW ONLY` | `CLAIM-PRODUCT-CAPABILITY-001` |
| 6 | 1:20–1:45 | Desktop | **Neatlogs** (five facets). | `SOURCE AVAILABLE` | `SPN-01`, `CLAIM-RUNBOOK-SPN-01-AVAIL-001` (planned, pending); `CLAIM-SPN-01-NEATLOGS-001` unchanged |
| 7 | 1:45–2:10 | Desktop | **Entire** (five facets). | `SOURCE AVAILABLE` | `SPN-02`, `CLAIM-RUNBOOK-SPN-02-AVAIL-001` (planned, pending); `CLAIM-SPN-02-ENTIRE-001` unchanged |
| 8 | 2:10–2:35 | Desktop | **CFO.ai**, reviewer workbook (five facets). | `HYPOTHETICAL FORECAST`; workbook hash on screen | `SPN-03`, `CLAIM-RUNBOOK-SPN-03-AVAIL-001` (planned, pending); `CLAIM-SPN-03-CFO-001` unchanged |
| 9 | 2:35–2:50 | Desktop | Close: submission fields and docs call to action. | `STATUS` | `EVENT-SUBMISSION-FIELDS-001`, `CTA-REPOSITORY-DOCS-001`, `CLAIM-EVAL02-COMPARISON-001` |

### 15-cell coverage matrix

Each cell lists public proof, what the human shows, a **proposed human explanation** (a plan, not private reasoning, not new execution, and not approved narration) and the exact gap. Links use the pinned trees:
`NL` = [Neatlogs tree](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/31b4f53b46a584c4b5b4a6a7076f6800c37b00e5/evidence/neatlogs/2026-10-11) · `EN` = [Entire tree](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/a9d68ef0116b1c20f7d70e0161016e21b4bb13b7/evidence/entire/2026-10-11) · `CFO` = [CFO.ai r2 tree](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2).

#### Neatlogs (shot 6)

| Facet | Proof and shot | Proposed explanation | Exact gap |
| --- | --- | --- | --- |
| Architecture | NL README and `traces.json`: which TicketStub runs were recorded. | The listed product runs were traced and the trace export is public. | Only the listed runs; not "all work is traced". |
| Implementation | NL `traces.json` entries (research, agent reply, art, recovery). | What each entry records. | The fifth entry has no screenshot. |
| Runtime | NL screenshots `trace-research-success.jpg`, `trace-research-failure.jpg`, `trace-agent-reply.jpg`. | What the recorded runs looked like. | Accepted diagnostic once per process, not all 7 exports; 3 of 7 sessions absent from the queried window, not shown to be receiver loss. |
| Reasoning | NL research and art trace pages. | Only what a trace page visibly shows. | No `EVAL-02` paired comparison; cost is provider-reported and partial, not billing. |
| Result | NL `trace-art-image.jpg` (`df77d370…78ed2`). | A well-formed production art run, as corrected at PR #35. | No "always falls back"; no savings or latency number. |

#### Entire (shot 7)

Proof set: the [Entire README](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/a9d68ef0116b1c20f7d70e0161016e21b4bb13b7/evidence/entire/2026-10-11) records manual GitHub Actions runs of the checksum-verified Entire CLI `v0.11.4` and `entire-graph` `v0.4.0`, one run per repository at an exact `main` commit, and the snapshots copied unchanged from the run artifacts with verified checksums. These are saved execution and output evidence, and the graphs are real results. The ten runs are, by repository and run:
[getticketstub.com 38166575087](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/actions/runs/38166575087) · [agent-harness 38167306765](https://github.com/Jevelopers-neatHack-2026/agent-harness/actions/runs/38167306765) · [cost-intelligence 38167313026](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/actions/runs/38167313026) · [creative-engine 38167322823](https://github.com/Jevelopers-neatHack-2026/creative-engine/actions/runs/38167322823) · [event-intelligence 38167329573](https://github.com/Jevelopers-neatHack-2026/event-intelligence/actions/runs/38167329573) · [fulfillment-connectors 38167337832](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/actions/runs/38167337832) · [integration-evals 38167345283](https://github.com/Jevelopers-neatHack-2026/integration-evals/actions/runs/38167345283) · [print-production 38167353404](https://github.com/Jevelopers-neatHack-2026/print-production/actions/runs/38167353404) · [shared-contracts 38167360776](https://github.com/Jevelopers-neatHack-2026/shared-contracts/actions/runs/38167360776) · [team-dashboard 38167367816](https://github.com/Jevelopers-neatHack-2026/team-dashboard/actions/runs/38167367816).
Each snapshot folder (for example `graph-getticketstub-c384776/` in EN) holds `graph-snapshot.ndjson`, `SHA256SUMS` and `graph-version.json`. Open only what the viewer can reach; if a run page is not public to the viewer, show the snapshot folder in EN instead.

| Facet | Proof and shot | Proposed explanation | Exact gap |
| --- | --- | --- | --- |
| Architecture | EN README configuration table and the snapshot headers. | Entire is configured per repository, checkpoints go to a private checkpoint repository, and the graph export maps files, symbols and relations of each repository. | Project config PRs were open and unmerged when recorded; Entire was removed from the owner's machine; no cloud capture environment is verified. |
| Implementation | The manual `Entire graph` workflow runs above; EN checkpoint page for the one checkpoint bound to `3358f0d`. | A manual workflow installs the pinned CLI and plugin and exports a compact snapshot for an exact commit. A public relationship graph gives agents and reviewers context about how code connects. | The checkpoint is one historical, manually attached checkpoint; the plugin install is not version-pinned, so each run's `graph-version.json` is the record. |
| Runtime | The ten run URLs and their downloaded-artifact checksums. | The tooling really ran on GitHub Actions and produced these outputs. | These are CI executions of the graph export. No live agent hook or Entire session is running; nothing is mirrored on entire.io. |
| Reasoning | Snapshot relations and the merged `init-agents` files (`.entire/graph-agent.md`, `AGENTS.md`, `CLAUDE.md`) named in the README. | How the graph links symbols and files, and why that context helps a person or agent read the code. No private agent decision is claimed. | No transcript or agent decision is shown; transcripts are private and are not needed for this explanation. |
| Result | The ten snapshots: repository, commit, file, symbol and relation counts from the README table, read from the page. | Ten graph outputs exist, each tied to its repository and commit and checksum-verified. | No measured improvement, `EVAL-02` comparison or savings claim; the counts are shown, not interpreted. |

#### CFO.ai (shot 8)

Proof set: the [r2 README](https://github.com/Jevelopers-neatHack-2026/integration-evals/tree/6420af494a5276f69c337f47dac3ad4c1854d524/evidence/cfo-ai/2026-10-11-r2) records that the repairs were made in the existing CFO.ai canvas, re-exported natively, with a saved canvas narrative, an overview screenshot, and desktop-Excel input-change verification. It is a saved native proof, not merely a document. The human does not recalculate or copy any figure; whatever appears is read live from the workbook or the public page, labelled hypothetical.

| Facet | Proof and shot | Proposed explanation | Exact gap |
| --- | --- | --- | --- |
| Architecture | CFO README, `cfo-canvas-narrative.md`, `SHA256SUMS`; the workbook hash on screen. | The plan lives in a native CFO.ai canvas, was exported natively, and is kept as a reviewer workbook plus a generic export. | The canvas needs workspace login and is not public; the generic export is not accepted. |
| Implementation | `export-postprocessing-diff.json` and the README line on the four blank-safe formulas (`Model inputs!B69, C72, B74, B76`). | The repairs were made in the canvas and re-exported; four opening-cash links were made blank-safe so an unknown cash stays unknown. | The exporter still writes the blank-coercing form in the generic export (`CFO-R2-001`). |
| Runtime | `excel-verification.json` and the reviewer workbook opened in desktop Excel. **Optional, owner-specified step:** the README's suggested demo coverage edits paid conversion (`01!B7`); after checking the file hash, edit a throwaway copy and discard it, and read the changed output off the screen. | The workbook recalculates in desktop Excel when an input changes. | The recalculation record is agent-prepared, not Finance acceptance. It is a saved workbook run in Excel, not a live CFO.ai service. The edit step needs owner confirmation and is not part of any approved claim. |
| Reasoning | Narrative and the assumptions in table 01 of the workbook. | State the assumptions (traffic, conversion, costs and the opening cash are estimates), what a blank-safe guard does (blank opening cash shows "Opening cash unknown" in the reviewer workbook), and what it means for plan availability (the funding view is blank until a cash value is entered). | Actual cash, demand, billed usage and taxes are unknown; no Finance waiver; `CFO-R2-001` unresolved. |
| Result | The scenario view in the reviewer workbook and the saved overview screenshot. | Three hypothetical scenarios (Conservative, Base, Growth) and the separate owner-reported actual-expenses table, shown as on-screen reading only. | Hypothetical forecasts, not actual sales; no figure is stated here or in the voice-over; no Finance, package or actual-sales approval; the generic export is disclosed as limited. |

**Sponsor limits that apply to every cell.**
Neatlogs: source availability only; owner acceptance was relayed in chat ([integration-evals PR 33 comment 6114638937](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/33#issuecomment-6114638937)) and is not an independent review; the `REQUEST_CHANGES` `NL-R1/2/3` history stays; [getticketstub.com issue 27 comment 6114684677](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27#issuecomment-6114684677) is a declaration, not approval; no "every step traced".
Entire: owner acceptance was relayed in chat at PR 31, not an Entire or independent statement; the single checkpoint is historical and limited.
CFO.ai: forecasts are hypothetical; owner acceptance was relayed, then an independent Finance `REQUEST_CHANGES` `CFO-R2-001` followed and is unresolved; no Finance, package or actual-expense approval; the cost-intelligence export (issue 3) is pending. The human does the final plan-link entry.

A count of 14 repositories is not asserted; only the ten published snapshots are shown.

## 7. Beat text and spoken lines

Nothing below is approved for public speaking, captioning or publication. "Approved CTA" means exact docs-CTA text and docs-only target already carry wording and route approval; that is not publication approval. No figures: no financial, latency, savings or performance numbers, no "every step/session" claims.

**Canonical runbook rows (planned, review pending).** The wording below is copied exactly from `messaging/claims.json`. Each row's destination is this runbook only. It describes what the visible public artifacts show in the beat. It is not a caption, narration, X post or external copy, so it is not a spoken line. Using it in any other destination needs its own claim row and review.

| Shot | Exact allowed wording (runbook beat text) | Row and required qualifier |
| ---: | --- | --- |
| 1 | Team Jevelopers. Project TicketStub. | `CLAIM-RUNBOOK-ENTRY-FIELDS-001`. Qualifier: project name only; product availability is unverified. Field review pending. Not the X-only `CLAIM-X-DEST-*` review. |
| 6 | The published integration-evals evidence at the pinned commit includes Neatlogs trace screenshots and a trace export from selected TicketStub runs. | `CLAIM-RUNBOOK-SPN-01-AVAIL-001`. Listed runs only; cost is provider-reported and partial; no `EVAL-02` comparison; owner acceptance is not independent review; `NL-R1/2/3` stand. |
| 7 | The published integration-evals evidence at the pinned commit includes Entire graph snapshots from manual GitHub Actions runs on ten repository commits, and one historical checkpoint record. | `CLAIM-RUNBOOK-SPN-02-AVAIL-001`. Manual runs, no agent session or live hook; checkpoint bound to `3358f0d` only; no agent-decision or transcript claim; no total repository count. |
| 8 | This hypothetical business-plan workbook is the CFO.ai export with four blank-safe opening-cash guards added by the CFO.ai assistant. It is not actual sales, and the generic export has a documented limitation. | `CLAIM-RUNBOOK-SPN-03-AVAIL-001`. Shows no figures; `CFO-R2-001` unresolved; no Finance, package or generic-export waiver; Excel verification is agent-prepared. |

**Existing rows for the close (shot 9).**

| Shot | Proposed line | Basis | State |
| ---: | --- | --- | --- |
| 9 | "Quote-post the official neatlogs post with team, name, project, public repository and demo link." | `EVENT-SUBMISSION-FIELDS-001` | planned |
| 9 | "Explore the repository docs." | `CTA-REPOSITORY-DOCS-001` | approved CTA text; docs-only target |

The existing planned `EVENT-SUBMISSION-FIELDS-001` line describes the quote-post only; it is not a complete submission procedure. Its exact ledger wording and pending state are preserved. Follow section 9 for the additional form step. Any replacement public line needs its own exact claim wording and review before use.

**Product beats (shots 2 to 5): instruction-only.** No product claim row was added, so these shots carry no spoken line and no caption. The human performs the step and the screen shows only what the producer-confirmed deployed build does:

- Shot 2: enter the cleared example event.
- Shot 3: show the research result and any source marks the build shows.
- Shot 4: make one change and approve it as the human reviewer, if the build has that step.
- Shot 5: save and download, with Card, Print and Framed shown as previews and checkout as sandbox, if the build behaves so.

These steps stay conditional until the producer confirms the deployed build, the cleared example, the mode label, the approval step and the download behavior. A product line needs a new claim row for the confirmed build. `CLAIM-PRODUCT-CAPABILITY-001` and `CLAIM-HUMAN-APPROVAL-CONCEPT-001` are unchanged and do not turn the old concept wording into proof of the live build.

Do not say or caption: the brand slogan, "Every …" claims about tracing or checkpointing, "live" or "available now" product claims, a style count, or any financial, latency, savings or performance figure.

## 8. Pre-take checklist (human)

- [ ] Product owner confirmed the exact deployed commit and URL; written on the pre-take card.
- [ ] A human producer rehearsed that exact build.
- [ ] Style set confirmed, or no style count shown or said.
- [ ] Cleared example input; email, QR, customer and token data hidden.
- [ ] Mode labels visible: build mode, sandbox, preview only, hypothetical forecast.
- [ ] Pins on the card: Neatlogs `31b4f53b`, Entire `a9d68ef0`, CFO.ai r2 `6420af49` and reviewer workbook hash `43884eaf…12a14`; the generic workbook is not shown as accepted.
- [ ] CFO.ai page, if opened live, is the owner-authorised plan only, with login, credentials, workspace list and unapproved content redacted; otherwise the public screenshot is used.
- [ ] Recovery decision made; if selected, labelled `DEMO`.
- [ ] Every spoken line is an approved line or has its own claim row for that destination; the four runbook rows are not speech or caption approval. Product beats stay silent until a product row exists.
- [ ] Final assembly owner, selected submission video(s) and submitter confirmed; submitter uses their own X account and name.
Final runtime, captions, transcript, public links and the form receipt are checked after the take below, not asserted before recording.

## 9. After the take

Whoever does final assembly reviews each selected export end to end and records its real runtime. A human does any posting, upload or submission. Nothing in this runbook shows that a recording, QA, a teammate dry run or a submission has happened.


### Final media and submission checklist (human, after the take)

- [ ] Review the selected final video, captions and transcript against the exact claims and source revisions. Measure runtime (at most 180 seconds), check rendered-pixel redaction, and obtain applicable rights, brand, accessibility and destination decisions before public use. The internal rehearsal does not substitute for this media.
- [ ] Recheck the official launch post via the organizer submission page and the authoritative Discord cutoff. Confirm the human X submitter and the submission-form leader separately; no tentative handle mapping becomes an assignment.
- [ ] The authorized teammate creates a public quote-post of that official launch post, includes `@neatlogs`, `@EntireHQ` and `@arithecfo`, and must attach the demo video before posting. Include the required team, name, project, public repository, demo and business-plan information; retain the hypothetical-plan limitation. Verify the published links and record the posted-entry URL.
- [ ] The authorized team leader verifies their check-in email at [the submission form](https://neatlogs.com/submission), enters the quote-post link and required project/team/tool details, reviews the entry and selects `Submit project`. The leader's submission covers the team. `Continue` saves a draft; it does not complete the entry.
- [ ] Record the posted-entry URL and a separate redacted final form acknowledgement reference and timestamp in [issue #22](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/22). **Both receipts are required** for the submission-completion check; neither a post alone nor a form alone is a completed entry. Missing or unreviewed evidence keeps the submission gate blocked; these receipts alone do not clear other acceptance, media or permission requirements.

Do not commit the verification email, authentication links, private form fields, workspace information or unredacted screenshots. Record only the minimum sanitized confirmation reference. This checklist performs no action and grants no publication or submission permission. Agent capture remains `CANCELLED_USER_REQUEST_NO_RESTART`.
