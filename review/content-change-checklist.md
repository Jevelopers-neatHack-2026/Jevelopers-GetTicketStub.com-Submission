# Landing content change checklist

Use alongside the organization PR template and [content policy](content-policy.md). This is a blank working checklist, not an approval receipt. Replace unknown values with actual evidence; unchecked required items remain pending. Use neutral `Refs` links.

## Candidate and source

- [ ] Issue links and local LP criteria: **pending**.
- [ ] Page/section IDs, claim IDs, example/scene IDs, asset paths, CTA/native/no-JavaScript and metadata occurrences: **pending**.
- [ ] Original source provenance and exact upstream revisions/permissions; historical origins retained separately from the current audit: **pending**.
- [ ] Exact tested local commit SHA, component/runtime/configuration versions and artifact manifest/affected file digests: **pending**.
- [ ] Changes match approved upstream material or remain explicitly provisional; rationale and supported physical/digital, price and automation boundaries recorded: **pending**.

## Evidence and review

- [ ] Evidence classification is visible beside every affected claim/example; origin/provenance and execution/provider mode are recorded separately: **pending**.
- [ ] Permission/license, publication destination and scope, permission expiry and rights restrictions checked: **pending**.
- [ ] Finance/reliability sensitive-data review, applicable scans and visual inspection recorded with actual commands/versions/results; no customer data, credentials, private transcripts or unredacted sensitive artifacts included: **pending**.
- [ ] Accountable maintainer **person**, backup **person**, responder and accepted responsibility references: **unconfirmed**.
- [ ] Product capabilities/pricing/automation/physical-digital reviewer **person**, role, decision reference, timestamp and exact revision: **unconfirmed**.
- [ ] marketing-material narrative reviewer **person**, role, decision reference, timestamp and exact revision: **unconfirmed**.
- [ ] brand-kit identity and applicable rights reviewer **person**, role, decision reference, timestamp and exact revision: **unconfirmed**.
- [ ] Finance/reliability reviewer **person**, role, decision reference, timestamp and exact revision: **unconfirmed**.
- [ ] Receiving-app owner review of destination/environment and exact assembled artifact if affected: **pending**.

Mark a review responsibility N/A only with the actual responsible owner's scoped rationale. Role-only placeholders, author assertions and fixture data do not count as signoff. Preserve pending or rejected decisions and the conditions that would resolve them.

## Freshness, withdrawal and verification

- [ ] Next review deadline, applicable earlier triggers, responder and stale-content disposition: **pending**.
- [ ] Withdrawal selection from an immutable baseline; affected old claim/media absent from active mappings and all public payloads, including decoded HTML text/attributes, metadata, dynamic content and no-JavaScript links; original asset byte sequence absent even inside renamed/padded files: **pending/N/A with reason**.
- [ ] Actual `node scripts/withdrawal.mjs --baseline FULL_SHA --claim ID --asset site/assets/FILE` outcome and manifest digest recorded if applicable: **pending/N/A with reason**.
- [ ] Author audit performed on the actual source; all affected inventory pins refreshed using actual immutable commits, without replacing historical source provenance or fabricating approval: **pending**.
- [ ] Build, affected content/proof/CTA/privacy/metadata/UX/brand checks, governance draft checks, required release checks and negative/recovery cases recorded with exact commands, Node/browser versions, date/time/timezone, modes and outcomes: **pending**.
- [ ] Prior failed/skipped results retained with superseding evidence; required unavailable validators and external checks remain non-passing: **pending**.
- [ ] Independent required review and current candidate checks complete before merge; postmerge affected checks run on the resulting main revision: **pending**.

## Publication and handoff

- [ ] Exact publication destination and actual operation-specific authorization: **pending**.
- [ ] Safe rollback revision/artifact with still-valid rights and approvals, responsible operator and recovery verification: **pending**.
- [ ] Receiving-app owner records deployment/removal, cache/old-asset-URL checks and source/artifact identity; no deployed claim inferred from a local build: **pending**.
- [ ] Sanitized immutable evidence references, modes, results, limitations and owner blockers handed to the authorized EVAL-03/04 maintainers; master status left to integration-evals: **pending**.
- [ ] Local issue closure decision covers every criterion after merge and review; gate/epic remain open until their full scoped acceptance exists: **pending**.
