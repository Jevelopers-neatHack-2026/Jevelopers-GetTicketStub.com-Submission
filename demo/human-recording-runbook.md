# Human recording runbook (planned internal handoff)

**Asset:** `DEMO-HUMAN-RECORDING-RUNBOOK-001` (suggested ID; root registers it in the inventory and package) · **Acceptance:** MM-03-C
**Status:** planned internal handoff, not an approved final v1. It is a plan for a human teammate. No dry run, rehearsal, phone QA or recording has been performed from it, and no teammate has reviewed it.
**Not this:** the 150-second silent rehearsal ([`rehearsal-scenes.json`](rehearsal-scenes.json)) is concept footage. It is not final footage and it is not what this runbook records.

## 1. Who does what

| Role | Who | State |
| --- | --- | --- |
| Recorder, editor, submitter | Tentative candidates from the user's reply: `lejefa` and `completedotech` (verbatim reply: "likely lejefa/completedotech") | **Tentative.** No exact role mapping and no confirmed GitHub handle is recorded. Do not guess. |
| Product / deployment owner | Product owner | Must confirm the deployed build (section 3). |
| Source owners | Per sponsor row in section 6 | Retain evidence, finance, brand, rights and destination authority. |
| Agents | None | **No agent records, posts, uploads or submits.** Agent capture is `CANCELLED_USER_REQUEST_NO_RESTART`; restarting it needs a separate, fresh, explicit authorization. |

The user-assigned marketing-material supervisor stays accountable for this copy. No separate human-only or vendor-only review gate is added here.

## 2. What the organizer requires

Verified 2026-10-12 at [neatlogs.com/hackathon](https://neatlogs.com/hackathon): the video is **at most three minutes**, and it must cover architecture, implementation, runtime, reasoning and result for **each** of Neatlogs, Entire and CFO.ai. The page gives no aspect ratio or file-size limit; do not invent one. The submission is a quote-post of the official neatlogs post on X with team, name, project, public repository and demo link; the final cutoff is announced on Discord.

Still unknown and human-only: official post URL, Discord cutoff, final team/name fields, the demo URL, the posted URL, and the submitter's authorization. Recheck all of them immediately before submitting.

## 3. Known versus must-confirm before the take

**Known (pin these on the pre-take card):**

| Item | Value | Source / note |
| --- | --- | --- |
| Product source reviewed by the ledger | `getticketstub.com` `eb8decceeffd29c3c1f1ebf4f6a653ef3a98e073` | `CLAIM-PRODUCT-CAPABILITY-001` limitations. Source availability only. |
| Newer product source reported by root | `6daa197` (includes the #56 agent-actions / `ask_user` fix and the #61 exact-download fix) | Root-captured deployment receipt 6118271571. **Not published** per the last receipt, and no health commit. Not in the claim ledger. |
| Eight new SVG styles | On an uncommitted branch, undecided (6118297805) | Do **not** assert 5 or 8 styles on screen or aloud until the owner confirms the deployed set. If the deployed styles are shown, describe them only as "the styles in the deployed build". |
| Neatlogs source | integration-evals `31b4f53b46a584c4b5b4a6a7076f6800c37b00e5` (PR #35), tree `evidence/neatlogs/2026-10-11` | `CLAIM-SPN-01-NEATLOGS-001` |
| Entire source | integration-evals `a9d68ef0116b1c20f7d70e0161016e21b4bb13b7` (PR #31), checkpoint `01M4P1DT7TRNWJ5EA42T47R1P0` bound to commit `3358f0d`, ten static CI graphs | `CLAIM-SPN-02-ENTIRE-001` |
| CFO.ai source | integration-evals r2 `6420af494a5276f69c337f47dac3ad4c1854d524`, merged `f375fcf20584f5c98dbd4f3b69f884c52994224e`; public tree `evidence/cfo-ai/2026-10-11-r2` | `CLAIM-SPN-03-CFO-001` |
| CFO.ai workbook to show | **Reviewer** workbook `cfo-native-export.xlsx`, SHA-256 `43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14`, guarded blank-cash version | Owner relay 6118253750 (root capture `issue22-premerge-comments-refresh.json`) records the CFO segment as Yes and the reviewer workbook as selected. The relay names Crystal; no GitHub handle or role is inferred. |
| Generic workbook | `cfo-native-export-generic.xlsx`, `969941bac6f07d9678bb04238f0d5167baab9956f5e320bb33b77841be809416` | **Not accepted as an editable forecast.** `CFO-R2-001` is unresolved. |

**The owner's chat relay approving a recorder does not reauthorize agent capture.**

**Must be confirmed before recording (all open):**

1. The exact approved deployed product commit (say whether it is `6daa197` or something else) and its URL, from the product owner.
2. A producer rehearsal of that exact build, run by a human. Do not record the final take against an unrehearsed build.
3. Which SVG style set is deployed (see above).
4. Final recorder, editor and submitter mapping, with confirmed handles.
5. The permission-cleared example input (section 4).
6. Whether a recovery moment is selected (section 5).
7. Exact spoken wording for every product and sponsor line (section 7). Until a ledger row exists, the line stays on-screen text from existing wording or silent action.

## 4. Safe example and redaction

- Use only a public or synthetic example whose use is cleared. The ledger's existing fictional example is "The paper moon" (`FICTIONAL EVENT / SYNTHETIC EXAMPLE`). At the ledger pin the product's research uses fixture data for three demo events and refuses arbitrary event links as `demo_only`; confirm what the deployed build accepts.
- Label the mode on screen the whole time: `SYNTHETIC EXAMPLE`, `SANDBOX` or `DEMO` as the build actually reports, and `PREVIEW ONLY` for physical variants.
- Blur or avoid: real email addresses, QR codes, customer names, tokens, magic links, cookies, URLs with secrets, account menus, other browser tabs and notifications.
- Never open private workspaces, dashboards behind login, transcripts or secrets on camera. Neatlogs dashboard links are workspace-only; use the public sanitized files in the pinned tree instead. A permitted human may open a source; agents never read the private workspace.
- Do not copy images into the repository and do not add new screenshots to it.
- No paid purchase, print order or budget authority. Checkout is a **sandbox**. Card, Print and Framed are preview only and not orderable. Human review/approval stays in the loop; do not describe the flow as running without a human decision.

## 5. Recovery moment

Show recovery **only if** the owner explicitly selects it. If selected, label it `DEMO` or `PLANNED` on screen, and show only what the deployed build really does. Do not stage a failure and call it a real recovery, and do not state any improvement or rate. If not selected, drop the beat and use the time for sponsor shots.

## 6. Planned shot list (proposal, not an executed dry run)

Planned length: **170 seconds**, 10 seconds under the 180-second limit (the 2:50 proposal in root receipt 6118223199 is data, not an approved instruction). One continuous take: phone for the product, desktop for the three sponsors. These timings are an author's plan, not measured performance.

| # | Time | Device | Shot (what the human does) | On-screen mode label | Claim IDs |
| ---: | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | Desktop | Title card: project name and the synthetic label. | `SYNTHETIC CONCEPT` | `CLAIM-PRODUCT-NAME-001`, `CLAIM-SIMULATION-001` |
| 2 | 0:12–0:30 | Phone | **Input:** open the confirmed deployed URL, enter the cleared example. | build mode as reported | `CLAIM-PRODUCT-CAPABILITY-001` (blocked) |
| 3 | 0:30–0:50 | Phone | **Research:** show the research result for that example. | build mode as reported | `CLAIM-PRODUCT-CAPABILITY-001` (blocked) |
| 4 | 0:50–1:10 | Phone | **Edit and approve:** change one visible detail, then approve it as the human reviewer. | `HUMAN REVIEW` | `CLAIM-HUMAN-APPROVAL-CONCEPT-001` (planned), `REHEARSAL-HOLD-REVISE-001` (planned) |
| 5 | 1:10–1:20 | Phone | **Save and download:** save, then download the exact file. Show Card/Print/Framed as preview only. | `SANDBOX`, `PREVIEW ONLY` | `CLAIM-PRODUCT-CAPABILITY-001` (blocked) |
| 6 | 1:20–1:45 | Desktop | **Neatlogs** (five facets, section 7). | `SOURCE AVAILABLE; CLAIM PENDING` | `SPN-01`, `CLAIM-SPN-01-NEATLOGS-001` |
| 7 | 1:45–2:10 | Desktop | **Entire** (five facets). | `SOURCE AVAILABLE; CLAIM PENDING` | `SPN-02`, `CLAIM-SPN-02-ENTIRE-001` |
| 8 | 2:10–2:35 | Desktop | **CFO.ai**, reviewer workbook (five facets). | `HYPOTHETICAL FORECAST` | `SPN-03`, `CLAIM-SPN-03-CFO-001` |
| 9 | 2:35–2:50 | Desktop | Close: no-results line, submission fields, docs call to action. | `STATUS` | `CLAIM-NO-RESULTS-VERIFIED-001`, `CLAIM-EVAL02-COMPARISON-001`, `EVENT-SUBMISSION-FIELDS-001`, `CTA-REPOSITORY-DOCS-001` |

Only after the product owner confirms the deployed build may shots 2 to 5 describe current features. Before that they are placeholders.

### 15-cell coverage matrix

Each cell is: source proof / shot / proposed explanation / limits. "Proposed explanation" is a planning note for the human, **not approved narration**; none of it may be spoken or captioned until a ledger row exists (section 8). Every cell shares the sponsor limits stated under the table.

| Facet | Neatlogs (shot 6) | Entire (shot 7) | CFO.ai (shot 8) |
| --- | --- | --- | --- |
| **Architecture** | Proof: pinned `traces.json` and README at `31b4f53b`. Explain which product runs were recorded in Neatlogs. Limit: only the listed runs; no claim that all work is traced. | Proof: README of the `a9d68ef0` tree. Explain what the checkpoint and the ten graphs are. Limit: static code-structure exports. | Proof: r2 README and `SHA256SUMS`. Explain that the plan is a saved workbook with a reviewer version and a generic version. Limit: generic version not accepted. |
| **Implementation** | Proof: README and `traces.json` entries (research, agent reply, art, recovery). Explain what each trace entry shows. Limit: fifth entry has no screenshot. | Proof: checkpoint `01M4P1DT7TRNWJ5EA42T47R1P0` on `3358f0d`. Explain it is one historical, manually attached checkpoint. Limit: no live hook; no "every session" claim. | Proof: reviewer workbook hash `43884eaf…12a14`. Explain what the workbook is, by name and hash. Limit: no recalculation here. |
| **Runtime** | Proof: public screenshots `trace-research-success.jpg`, `trace-research-failure.jpg`, `trace-agent-reply.jpg`. Explain what the recorded runs looked like. Limit: accepted diagnostic once per process, not all 7 exports; 3 of 7 sessions absent from the queried window, not shown to be receiver loss. | Proof: ten CI graph snapshots (headers only). Explain these are static exports. Limit: no runtime behavior shown, nothing mirrored on entire.io. | Proof: none at runtime. Explain that the plan is a document, not a running service. Limit: no runtime facet exists; state "pending". |
| **Reasoning** | Proof: the research and art trace pages in the pinned tree. Explain only what a trace page visibly shows. Limit: no `EVAL-02` paired comparison; cost is provider-reported and partial, not billing. | Proof: none public (the private transcript was not reviewed). Explain nothing beyond "pending". Limit: reasoning not shown. | Proof: workbook assumption sheet if shown. Explain only that every forecast is hypothetical. Limit: owner decision, not Finance waiver. |
| **Result** | Proof: art trace `trace-art-image.jpg` (`df77d370…78ed2`). Explain that this trace is a well-formed production art run corrected at PR #35. Limit: no "always falls back" claim; no savings or latency number. | Proof: none. Explain nothing beyond "pending". Limit: no result is shown by static graphs. | Proof: none approved. Explain nothing beyond "pending". Limit: no figures copied or computed; `CFO-R2-001` unresolved. |

**Neatlogs limits (all cells):** source availability only; owner acceptance was relayed in chat (PR #33 comment 6114638937) and is not an independent review; the independent `REQUEST_CHANGES` `NL-R1/2/3` history is preserved; getticketstub.com#27 comment 6114684677 is a declaration, not approval; there is no durable harness workflow acceptance; no "every step traced".
**Entire limits (all cells):** acceptance by the owner was relayed in chat at PR #31; not an Entire or independent statement.
**CFO.ai limits (all cells):** all forecasts are hypothetical; owner acceptance was relayed in chat, then an independent Finance `REQUEST_CHANGES` `CFO-R2-001` followed and is unresolved; there is no Finance package waiver and no actual-expense acceptance; the authoritative cost-intelligence export (issue 3) is pending. The mandatory X business-plan entry links the public plan tree (`CLAIM-X-DEST-PLAN-001`); the human does the final entry.

The historical count of 14 repositories versus 10 graphs from the original proposal is not asserted. Only the ten known published static graphs are shown.

## 7. Spoken lines (source-backed or blocked)

Every proposed spoken line must trace to an existing claim ID and its current state. Allowed wording is copied exactly; wording review is still pending for all of it.

| Shot | Proposed spoken line | Claim ID | State |
| ---: | --- | --- | --- |
| 1 | "Synthetic concept only. No product behavior, live sponsor integration, or measured savings are demonstrated." | `CLAIM-SIMULATION-001` | mock |
| 4 | "Approval before production." | `CLAIM-HUMAN-APPROVAL-CONCEPT-001` | planned |
| 4 | "A reviewer may hold or revise this draft; production handoff is planned." | `REHEARSAL-HOLD-REVISE-001` | planned |
| 6 | "Neatlogs use evidence is pending; no Neatlogs usage claim is approved." | `CLAIM-SPN-01-NEATLOGS-001` | blocked |
| 7 | "Entire checkpoint and graph evidence is pending; no Entire usage claim is approved." | `CLAIM-SPN-02-ENTIRE-001` | blocked |
| 8 | "CFO.ai business-plan evidence is pending; no CFO.ai use or financial claim is approved." | `CLAIM-SPN-03-CFO-001` | blocked |
| 6–8 | "Architecture: pending. Implementation: pending. Runtime: pending. Reasoning: pending. Result: pending." | `REHEARSAL-SPONSOR-FACETS-001` | planned |
| 9 | "No measured improvement or savings claim is approved; comparable baseline evidence is pending." | `CLAIM-EVAL02-COMPARISON-001` | blocked |
| 9 | "No product or sponsor results verified." | `CLAIM-NO-RESULTS-VERIFIED-001` | blocked |
| 9 | "Quote-post the official neatlogs post with team, name, project, public repository and demo link. The final cutoff is announced on Discord." | `EVENT-SUBMISSION-FIELDS-001` | planned |
| 9 | "Explore the repository docs." | `CTA-REPOSITORY-DOCS-001` | approved CTA text; destination is documentation only |
| 2, 3, 5 | **No spoken line.** Show the action silently with an existing on-screen label. | `CLAIM-PRODUCT-CAPABILITY-001` (blocked; allowed wording is "pending pinned product-release evidence") | blocked |

Do not say or caption: the brand slogan, universal "Every …" claims about tracing or checkpointing, "live" or "available now" product claims, or any financial, latency, savings or performance figure. See the prohibited variants on each ledger row; the rest have no source.

### Source conflicts, stated plainly

- The ledger's only allowed sponsor wording says "pending", while source for each sponsor now exists. The runbook therefore uses the "pending" wording for speech. Richer wording needs new ledger rows.
- The ledger's product pin (`eb8decce`) differs from the newer reported build (`6daa197`). The ledger does not describe the newer build, so no feature of it may be named.
- Neatlogs' own README says "silent receiver-side loss"; the ledger uses the narrower "not found in the queried window". Use the ledger form.

## 8. Requests to root (not implemented here)

Source edits are owned by the claims role. These are the rows the claims owner would need to add before any richer speech or captions. Each needs a pinned source, state, limitations and review.

| ID | Needed row or copy map | Why |
| --- | --- | --- |
| NSR-01 | Product journey spoken lines (input, research, edit, approve, save, download) with allowed wording, bound to the product owner's confirmed deployed commit, with state and mode labels (`SANDBOX`, `PREVIEW ONLY`, human approval). | `CLAIM-PRODUCT-CAPABILITY-001` allows only the "pending" sentence. |
| NSR-02 | Per-facet source-availability wording for SPN-01 (five facets) at `31b4f53b`, with the limits above. | The existing allowed wording says only "pending". |
| NSR-03 | Same for SPN-02 at `a9d68ef0` (one historical manual checkpoint, ten static graphs). | As above. |
| NSR-04 | Same for SPN-03 using the reviewer workbook hash, a "hypothetical forecast" label and the generic limitation, with no figures. | As above; `CFO-R2-001` open. |
| NSR-05 | Only if a recovery beat is selected: a `DEMO`/`PLANNED` recovery row. | None exists. |
| NSR-06 | A deployed-style-count row (5 or 8) once the owner confirms. | Undecided (6118297805). |

Also needed from root: register `DEMO-HUMAN-RECORDING-RUNBOOK-001` in the inventory, provenance and package (issue 11), and refresh checksums.

## 9. Pre-take checklist (human)

- [ ] Product owner has confirmed the exact deployed commit and URL; commit written on the pre-take card.
- [ ] A producer rehearsal of that exact build is done by a human.
- [ ] SVG style set confirmed; no unconfirmed count is spoken or shown.
- [ ] Example input is cleared; email, QR, customer and token data are blurred or absent.
- [ ] Mode labels are visible: synthetic, sandbox, preview only, hypothetical forecast.
- [ ] Neatlogs pin `31b4f53b`, Entire pin `a9d68ef0`, CFO.ai r2 `6420af49` and reviewer workbook hash `43884eaf…12a14` are on the pre-take card; the generic workbook is not shown as accepted.
- [ ] No private workspace, transcript or secret is on screen; only public sanitized files are opened.
- [ ] Recovery decision made and, if selected, labelled `DEMO`/`PLANNED`.
- [ ] Every spoken line matches section 7 exactly, or the shot is silent.
- [ ] Total runtime is under 180 seconds on the real take.
- [ ] Recorder, editor and submitter are confirmed with handles.
- [ ] Official post URL and Discord cutoff rechecked just before submission.
- [ ] Team, project, public repository, demo URL and plan link entered by the human submitter.
- [ ] Captions and transcript match the final audio; redaction checked on rendered pixels.

## 10. After the take

The recorder reviews the export end to end and records the real runtime. A human does any posting, upload or submission. Nothing in this runbook is evidence that a recording, QA, a teammate dry run or a submission has happened.
