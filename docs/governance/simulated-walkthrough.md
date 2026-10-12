# Simulated change walkthrough (BK-07.5)

> **FICTIONAL SIMULATION. Not a historical approval. Not release eligible.**
> Every name, date, revision, URL and verdict below is invented to exercise the process. Nobody reviewed or approved anything here. Do not cite this file as evidence of approval, and do not copy its records into a real decision register. The SHA-256 values are hashes of the short fictional fixture strings quoted in the "Files and hashes" tables (computed over the exact text, no trailing newline), **not** hashes of real repository files. Real reviewer roles are still unfilled (see [responsibility table](../brand-governance.md#responsibility-table-bk-071)). Fictional `example.invalid` URLs are deliberately unresolvable.

Fictional baseline (not a real record): release `SIM-REL-1.0.0` was covered by an imaginary earlier decision `SIM-0-baseline`, approved (fictional) on 2098-12-01. It is referenced only so the rollback target in scenario C has an identity.

## Scenario A: unapproved core change is rejected from release

Walk: class is core identity, so approver, provenance reviewer and all affected consumer reviewers are required. Every reviewer row is `pending` and technical and consumer reviewers are unappointed, so the record cannot become `approved`. The eligibility check finds no controlling `approved` decision for the proposed hash, so the change is excluded and the last approved value stays.

```markdown
FICTIONAL SIMULATION - not a historical approval - not release eligible
# Decision: Replace Ticket Orange (fictional)

- **Decision ID:** SIM-A-core-orange
- **Status:** rejected (release gate, fictional)
- **Change class:** core identity
- **Proposed by / date:** sim-author-a / 2099-01-01
- **Superseded by / supersedes:** none
- **Reinstates:** none

## Change and exact diff
- **Base revision:** 0000000000000000000000000000000000000000
- **Proposed revision:** 1111111111111111111111111111111111111111
- **Diff:** `git diff 0000000000000000000000000000000000000000..1111111111111111111111111111111111111111 -- tokens/tokens.json` (fictional; yields `-ts-orange=#E4572E` / `+ts-orange=#D9480F`)

## Files and hashes
| Path | Revision | SHA-256 |
|---|---|---|
| tokens/tokens.json (fixture `FICTIONAL tokens.json PROPOSED-A: ts-orange=#D9480F`) | 1111111111111111111111111111111111111111 | c1679fb514a3af96a79b0d51af9812eaf8bf1467791c95499c8e21d855b19ae6 |

## Rationale
Fictional: author prefers a deeper orange. Alternative of keeping the current orange is preserved.

## Scope of approval
- **Covers:** nothing, as it was never approved
- **Does not cover:** every file and hash above

## Rights and provenance
None supplied (fictional gap). Reference: none.

## Affected consumers
| Consumer | Impact | Reviewer | Notified (where/when) |
|---|---|---|---|
| sim-consumer-1 | colour change | unknown | not notified |

## Evidence and validation
No checks run (fictional).

## Reviewers
| Role | Name | Dated evidence link | Verdict |
|---|---|---|---|
| Accountable approver | sim-approver | pending | pending |
| Technical token/export | unknown | pending | pending |
| Provenance | unknown | pending | pending |
| Consumer: sim-consumer-1 | unknown | pending | pending |

## Disposition
- **Decision date:** 2099-01-03 (fictional, gate rejection)
- **Decision:** rejected, missing required approvals; proposer may resubmit
- **Release eligible:** no
- **Deprecation / rollback / revocation notes:** none; last approved value stays
- **Fresh authorization for fallback:** not applicable
```

## Scenario B: compatible token addition, traceable path

Walk a reader can follow: decision ID `SIM-B-token-add` -> diff -> file hashes -> rights reference -> reviewer evidence -> notification target. The class is compatible token addition, so approver and technical reviewer are required, provenance only if the asset is new (it is a value only, no new asset), and consumers are notified. All of those entries are present below. In a *real* process this would make the listed hashes release eligible while they still match. **Here every entry is fictional, so `Release eligible: no`.**

```markdown
FICTIONAL SIMULATION - not a historical approval - not release eligible
# Decision: Add example accent token (fictional)

- **Decision ID:** SIM-B-token-add
- **Status:** approved (fictional)
- **Change class:** compatible token addition
- **Proposed by / date:** sim-author-b / 2099-01-01
- **Superseded by / supersedes:** none
- **Reinstates:** none

## Change and exact diff
- **Base revision:** 2222222222222222222222222222222222222222
- **Proposed revision:** 3333333333333333333333333333333333333333
- **Diff:** `git diff 2222222222222222222222222222222222222222..3333333333333333333333333333333333333333 -- tokens/` (fictional). Exact synthetic change: `tokens.json` `+ts-example-accent=#2E9E6B`; `tokens.css` `+--ts-example-accent:#2E9E6B;`; `tailwind.preset.js` `+exampleAccent`. No existing token changes.

## Files and hashes
| Path | Revision | SHA-256 |
|---|---|---|
| tokens/tokens.json (fixture `FICTIONAL tokens.json AFTER: ts-ink=#111111; ts-example-accent=#2E9E6B`) | 3333333333333333333333333333333333333333 | ac75816d44b3c52d7953d3312b85e2b5949b57e91c82d4fb4a3f67f96a5f9ab1 |
| tokens/tokens.css (fixture `FICTIONAL tokens.css AFTER: --ts-ink:#111111; --ts-example-accent:#2E9E6B;`) | 3333333333333333333333333333333333333333 | 2ddfa655f9f3d0db8fe74c0f46191c06f43e861414befe66d573204e1ec85c7a |
| tokens/tailwind.preset.js (fixture `FICTIONAL tailwind.preset.js AFTER: ink, exampleAccent`) | 3333333333333333333333333333333333333333 | a2839c12111ab01e93256c055d496564faedffdfe8c97784ba1f0b04438157b8 |

## Rationale
Fictional: an example accent is needed for a demo. Alternative of reusing an existing token rejected as too limiting. No existing direction is removed.

## Scope of approval
- **Covers:** the new token `ts-example-accent` in the three files at the hashes above
- **Does not cover:** any other token, any other hash, any font, any other revision

## Rights and provenance
Rights ref `SIM-RIGHTS-0001` (fictional): `#2E9E6B` is an original value invented for this simulation, no third-party material, no expiry. Evidence: `https://example.invalid/sim/rights/SIM-RIGHTS-0001`.

## Affected consumers
| Consumer | Impact | Reviewer | Notified (where/when) |
|---|---|---|---|
| sim-consumer-1 | additive, none required | sim-consumer-1 (opted out of review) | `https://example.invalid/sim/notify/SIM-B-1`, 2099-01-02 |

## Evidence and validation
Fictional check: additive-only diff confirmed by `sim-tech` (see the reviewer link). No network or font effect.

## Reviewers
| Role | Name | Dated evidence link | Verdict |
|---|---|---|---|
| Accountable approver | sim-approver | `https://example.invalid/sim/review/SIM-B-approver` (2099-01-02) | approve (fictional) |
| Technical token/export | sim-tech | `https://example.invalid/sim/review/SIM-B-tech` (2099-01-02) | approve (fictional) |
| Provenance | sim-prov | `https://example.invalid/sim/review/SIM-B-prov` (2099-01-02) | approve (fictional) |
| Consumer: sim-consumer-1 | sim-consumer-1 | `https://example.invalid/sim/notify/SIM-B-1` (2099-01-02) | notified, opted out |

## Disposition
- **Decision date:** 2099-01-02
- **Decision:** approved (fictional), scope as above, valid only while hashes match
- **Release eligible:** no
- **Deprecation / rollback / revocation notes:** fallback is release `SIM-REL-1.0.0` with the BEFORE hashes listed in scenario C
- **Fresh authorization for fallback:** not applicable
```

## Scenario C: revocation, rollback and fresh fallback authorization (fictional)

On 2099-02-01 a fictional consumer reports a clash with `ts-example-accent`. The approver records a revocation of `SIM-B-token-add` and notifies the consumer. The historical records stay: `SIM-B-token-add` is not edited or deleted. Because `SIM-0-baseline` was an older approval, the fallback hashes do **not** regain eligibility by themselves. The approver must record a fresh decision that reinstates them, with current rights evidence and the required review of the breaking token/asset/path class (approver, technical, provenance, affected consumer, plus migration record), dated after the rollback was proposed. Until that record exists, there is no valid current decision for the fallback hashes and the release stays ineligible (fail closed).

- Affected version: `SIM-REL-1.1.0` (contains SIM-B). Fallback version: `SIM-REL-1.0.0`.
- Fallback revision: `2222222222222222222222222222222222222222`.
- Fallback hashes: `tokens/tokens.json` `6ca9d8c8d3b51fac02d55700465af7025bd0d575ce84b62be5f728d819a8600a`; `tokens/tokens.css` `6f1957637c67eb132e69f33ffea9ea7bc4e2df22bc79679fec56ecd80aa79225`; `tokens/tailwind.preset.js` `74bd8c536d46bfce765fa9a1e9011bffb45af0a61fed42d746f746de4e0d1af9`.
- Owner actions: approver records the revocation and the reinstatement below, then notifies consumers.
- Consumer action: `sim-consumer-1` removes or ignores the new token and pins `SIM-REL-1.0.0`. The producer edits no consumer repository.

```markdown
FICTIONAL SIMULATION - not a historical approval - not release eligible
# Decision: Reinstate SIM-REL-1.0.0 as fallback (fictional)

- **Decision ID:** SIM-C-reinstate-1-0-0
- **Status:** approved (fictional)
- **Change class:** breaking token/asset/path (removes existing token `ts-example-accent` and its exported path entries; the BEFORE state is compatible only for consumers that never adopted it)
- **Proposed by / date:** sim-approver / 2099-02-01
- **Superseded by / supersedes:** supersedes SIM-B-token-add (revoked 2099-02-01)
- **Reinstates:** SIM-0-baseline

## Change and exact diff
- **Base revision:** 3333333333333333333333333333333333333333
- **Proposed revision:** 2222222222222222222222222222222222222222
- **Diff:** `git diff 3333333333333333333333333333333333333333..2222222222222222222222222222222222222222 -- tokens/` (fictional; removes `ts-example-accent` from all three files)

## Files and hashes
| Path | Revision | SHA-256 |
|---|---|---|
| tokens/tokens.json (fixture `FICTIONAL tokens.json BEFORE: ts-ink=#111111`) | 2222222222222222222222222222222222222222 | 6ca9d8c8d3b51fac02d55700465af7025bd0d575ce84b62be5f728d819a8600a |
| tokens/tokens.css (fixture `FICTIONAL tokens.css BEFORE: --ts-ink:#111111;`) | 2222222222222222222222222222222222222222 | 6f1957637c67eb132e69f33ffea9ea7bc4e2df22bc79679fec56ecd80aa79225 |
| tokens/tailwind.preset.js (fixture `FICTIONAL tailwind.preset.js BEFORE: ink`) | 2222222222222222222222222222222222222222 | 74bd8c536d46bfce765fa9a1e9011bffb45af0a61fed42d746f746de4e0d1af9 |

## Rationale
Fictional: revoke the clashing addition and restore the last known state. `SIM-0-baseline` and `SIM-B-token-add` remain on record unchanged.

## Scope of approval
- **Covers:** the three files at the BEFORE hashes, as the release `SIM-REL-1.0.0`
- **Does not cover:** `SIM-REL-1.1.0`, the `ts-example-accent` token, any other hash

## Rights and provenance
Rights ref `SIM-RIGHTS-0002` (fictional), re-checked 2099-02-02 and unexpired: `#111111` ink is original to the simulation. Evidence: `https://example.invalid/sim/rights/SIM-RIGHTS-0002`.

## Affected consumers
| Consumer | Impact | Reviewer | Notified (where/when) |
|---|---|---|---|
| sim-consumer-1 | breaking: token `ts-example-accent` removed from `tokens.json`, `tokens.css`, `tailwind.preset.js`; consumer pins `SIM-REL-1.0.0` | sim-consumer-1 (approved, fictional, 2099-02-03) | `https://example.invalid/sim/notify/SIM-C-1`, 2099-02-03 |

Migration record (fictional, dated 2099-02-03, after the 2099-02-01 rollback proposal): `https://example.invalid/sim/migration/SIM-C-1`. Steps: replace uses of `--ts-example-accent` / `exampleAccent` with `--ts-ink` / `ink`, pin `SIM-REL-1.0.0`, re-run the consumer's own build. Deprecation window: none, as the token was in release `SIM-REL-1.1.0` only. The producer edits no consumer repository.

## Evidence and validation
Fictional check: BEFORE hashes recomputed on 2099-02-02 and match the table. Fictional migration evidence: `https://example.invalid/sim/migration/SIM-C-1` (2099-02-03).

## Reviewers
| Role | Name | Dated evidence link | Verdict |
|---|---|---|---|
| Accountable approver | sim-approver | `https://example.invalid/sim/review/SIM-C-approver` (2099-02-03) | approve (fictional) |
| Technical token/export | sim-tech | `https://example.invalid/sim/review/SIM-C-tech` (2099-02-02) | approve (fictional) |
| Provenance | sim-prov | `https://example.invalid/sim/review/SIM-C-prov` (2099-02-02) | approve (fictional) |
| Consumer: sim-consumer-1 | sim-consumer-1 | `https://example.invalid/sim/review/SIM-C-consumer` (2099-02-03) | approve migration (fictional) |

## Disposition
- **Decision date:** 2099-02-03
- **Decision:** approved (fictional); controls the BEFORE hashes from this date
- **Release eligible:** no
- **Deprecation / rollback / revocation notes:** revokes `SIM-B-token-add`; affected `SIM-REL-1.1.0`; fallback `SIM-REL-1.0.0` with the hashes above; consumer pins fallback
- **Fresh authorization for fallback:** rights `SIM-RIGHTS-0002` (2099-02-02) and the four required review links above (approver, technical, provenance, affected consumer) plus the migration record, all dated after the 2099-02-01 rollback proposal
```
