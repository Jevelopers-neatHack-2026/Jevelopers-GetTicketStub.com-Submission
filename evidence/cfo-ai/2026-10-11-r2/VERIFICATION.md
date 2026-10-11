# Revision 2 verification record — 2026-10-11

All checks were run on 2026-10-11 between 17:50 and 18:35 UTC on macOS (Apple silicon) with Python 3.12, openpyxl and Microsoft Excel for Mac 16.113.4. This is an agent review, not owner acceptance.

## Commands and results

Run from this folder. The Excel checks need macOS, Microsoft Excel and openpyxl. They copy each workbook into Excel's sandbox container and never modify the source files.

| Command | Result |
| --- | --- |
| `python3 -I model.py` | PASS. Checks accounting identities, zero-order/zero-traffic aggregates, unknown vs zero vs funded opening cash, the Open-Meteo budget split and sensitivity direction. |
| `python3 -I verify-native-export.py cfo-native-export.xlsx` | pass. 10 sheets, 1,209 formula cells, 48 scenario/cash values equal `model.py` within 1e-6, no cached error cells, macros or external links ([export-verification.json](export-verification.json)). |
| `python3 -I verify-native-export.py cfo-native-export-generic.xlsx` | pass, same counts ([export-verification-generic-export.json](export-verification-generic-export.json)). |
| `python3 excel-recalc-check.py cfo-native-export.xlsx excel-verification.json` | Excel `calculate full`: 1,841/1,841 cells equal the cached values, 0 errors. All 12 input-change cases pass (see below). |
| `python3 excel-recalc-check.py cfo-native-export-generic.xlsx excel-verification-generic-export.json` | 1,841/1,841 cells equal, 0 errors. Every case matches the reviewer workbook except blank opening cash, where Conservative and Growth show UNFUNDED LAUNCH (residual CFO-003 in the exporter). |
| `python3 excel-recalc-check.py ../2026-10-11/cfo-native-export.xlsx original-export-excel-check.json --original` | Original export (SHA-256 `73827929…7d7bc1`): 1,663/1,663 cells equal, 0 errors. This closes the original "desktop Excel recalculation not run" limitation. Reproduces CFO-001 (74 `#VALUE!` cells at zero conversion or zero traffic), CFO-002 (edits to `01!B7` and `01!B33` have no effect) and CFO-003 (blank cash shows "Reserve funded"). |
| `cd ../2026-10-11 && shasum -a 256 -c SHA256SUMS` | All 17 original files OK. The original evidence is unchanged. |
| `shasum -a 256 -c SHA256SUMS` (this folder) | All files OK. |

### Input-change cases (reviewer workbook, desktop Excel)

| Case (edit) | Base operating profit | Base launch status | Notes |
| --- | ---: | --- | --- |
| Baseline | 702.81 | Opening cash covers reserve only; ramp unfunded | Ramp gap 1,416.011; Oct-2026 cash 400 |
| `01!B7` = 0 (zero paid conversion) | −908.99 | covers reserve only; ramp unfunded | Contribution −308.99, burn 908.99, reserve 572.0977, six-month 6,026.0377, ramp gap 6,826.0377; per-order and break-even n/a |
| `01!B5` = 0 (zero traffic) | −600 | covers reserve only; ramp unfunded | Reserve 500, six-month 4,100 |
| `01!B7` = 1% | −103.09 | covers reserve only; ramp unfunded | 100 orders (Finance's expected value) |
| `01!B5` = 20,000 | 2,005.62 | — | Visits driver propagates |
| `01!B6` = 20% | 393.82 | — | Start-rate driver propagates |
| `01!B10` = 8 | 664.65 | — | Chats driver propagates |
| `01!B32` = 600 | 402.81 | — | Marketing driver propagates; Oct cash 100 |
| `01!B34` = 10,000 | 702.81 | Reserve funded; ramp funded | All three scenarios funded |
| `01!B34` = 0 | 702.81 | UNFUNDED LAUNCH | All three scenarios; Oct cash −600; launch gap 616.011 |
| `01!B34` blank | 702.81 | Opening cash unknown | All three scenarios; gaps, runway and cash balances blank |
| `01!B34` = `""` | 702.81 | Opening cash unknown | All three scenarios |

No case produced a formula-error cell.

## Artifact provenance

| File | SHA-256 | Source |
| --- | --- | --- |
| `cfo-native-export.xlsx` | `43884eafc91bd84b6dd4970a893e084c09f4759ea566f4864f1b95268ba12a14` | CFO.ai chat attachment `TicketStub-Revision-2-Final-Native-Repaired.xlsx` |
| `cfo-native-export-generic.xlsx` | `969941bac6f07d9678bb04238f0d5167baab9956f5e320bb33b77841be809416` | CFO.ai page export `TicketStub — neatHack Business Plan — 2026-10-11.xlsx` |
| `cfo-canvas-narrative.md` | `e138a75f5d0e74a2b26c1c660787570f4b77632a52295826f5624f6219a045ff` | CFO.ai attachment `TicketStub-Revision-2-Narrative.md`, spot-checked against the live canvas text |

An intermediate CFO.ai export (`TicketStub-Revision-2-Native.xlsx`, SHA-256 `afd024eb…67daeb`), taken before the second correction round, was verified but superseded and is not retained. It passed all checks except blank cash in the Conservative and Growth columns.

## Component revisions

| Component | Revision |
| --- | --- |
| integration-evals PR #24 base of this revision | `e5f9604fdbf2fad24adf3681275e5eb10c873801` (original evidence) |
| integration-evals main at review | `95b0812d6b433a27698930ea5d4cb45af0b82b9d` |
| getticketstub.com main (behavior reconciled) | `8afdefd40c9faf912e4a50a6a532fff0b5e480b2` |
| cost-intelligence main | `d3c287596f84f825e5745639b166aa0686e750b0` |
| fulfillment-connectors main | `69755bad1a88778db92c7599fe7b3724a87e7d95` |
| creative-engine main (smoke test ran at `42444c99c59fcf4cd9b09b55a1b7ba52b1b77ea2`) | `a74430580de505bfbb727e54e6c1ee816885121d` |
| agent-harness main | `d91195096b0ad343cb04b20e7194c7eceef0a863` |
| CFO.ai page | `7ed03e7e-ca7d-441c-b6bb-7d4e5f7efc94` (same page as the original) |

## Not verified

- No Finance/reliability owner review of this revision has been received.
- No settled payment receipts or actual cash.
- Production usage has not been measured.
- No live CFO.ai input edit was performed by this reviewer. CFO.ai's assistant reports in-app tests; this record's tests are on the exported workbooks.
- The PDF narrative copy offered by CFO.ai was not retained or reviewed.
