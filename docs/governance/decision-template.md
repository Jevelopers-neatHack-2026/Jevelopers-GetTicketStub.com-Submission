# Proposal and decision template

Copy this file to `docs/governance/decisions/<yyyy-mm-dd>-<slug>.md` for a real record. Simulated records belong only in `docs/governance/simulated-walkthrough.md` and must keep the `FICTIONAL SIMULATION` marker. See [brand governance](../brand-governance.md) for rules.

Do not fill the reviewer or decision fields on anyone's behalf. Leave `pending` until the person acts, and link that action.

```markdown
# Decision: <short title>

- **Decision ID:** <yyyy-mm-dd>-<slug>
- **Status:** proposal | review | approved | rejected | superseded
- **Change class:** core identity | breaking token/asset/path | compatible token addition | documentation-only
- **Proposed by / date:** <github handle> / <yyyy-mm-dd>
- **Superseded by / supersedes:** <decision ID or none>
- **Reinstates:** <earlier decision ID whose exact hashes this fresh decision re-authorizes, or none>

## Change and exact diff
- **Base revision:** <full commit SHA>
- **Proposed revision:** <full commit SHA or PR head SHA>
- **Diff:** <link or `git diff <base>..<head> -- <paths>`>

## Files and hashes
| Path | Revision | SHA-256 |
|---|---|---|
| <path> | <SHA> | <64 hex chars> |

## Rationale
<why; alternatives considered; rejected directions preserved>

## Scope of approval
- **Covers:** <exactly what>
- **Does not cover:** <exactly what>

## Rights and provenance
<licence, permission or origin references, with expiry if any>

## Affected consumers
| Consumer | Impact | Reviewer | Notified (where/when) |
|---|---|---|---|

## Evidence and validation
<checks run, output, accessibility or font/network notes>

## Reviewers
| Role | Name | Dated evidence link | Verdict |
|---|---|---|---|
| Accountable approver | | pending | pending |
| Technical token/export | | pending | pending |
| Provenance | | pending | pending |
| Consumer: <name> | | pending | pending |

## Disposition
- **Decision date:** pending
- **Decision:** pending
- **Release eligible:** no (becomes yes only when Status is approved and all rows above are filled with real evidence)
- **Deprecation / rollback / revocation notes:** <fallback version and hashes, owner actions>
- **Fresh authorization for fallback:** <for a rollback or reinstatement: link to current rights evidence and required-role review dated after the rollback was proposed, else `not applicable`>
```

Required fields checked by `tools/check_governance.py`: every `##` heading and every bullet label in the template block above must appear in each simulated record, and each simulated record must state `Release eligible: no`. The checker is structural: it cannot tell whether a real person acted.
