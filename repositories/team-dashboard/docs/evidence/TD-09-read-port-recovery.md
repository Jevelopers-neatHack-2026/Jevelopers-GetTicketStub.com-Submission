# TD-09: contain unreadable Finance read ports

Scope: partial TD-09.D/E, TD-01B.C/E and TD-11 regression contribution. This is not actual host, Finance-owner, or release acceptance.

## Behavior and source

Base for this extension: `775ecc881f1bd608d6711d78acb2f4c590970548`, which incorporates main `d65a1540296cf44bc88bf4910b8a8bb07abd248d` without replacing other writers' work. Existing malformed-fault and cancellation regressions remain unchanged.

The read-port resolver could throw from `kind` or `read` getters, including a throwing or revoked Proxy, during React rendering. It now returns the existing `port-kind-mismatch` unavailable outcome. `INTEGRATED` remains unavailable before metadata inspection; missing ports retain `no-port`. Readable accessor ports retain their identity and method receiver.

The hook also settles an unavailable setup recheck. A port that was readable during render but became unreadable before effect setup must not leave loading with no request or timeout. Replacement by a valid host port starts a fresh read. Neither branch substitutes fixtures, invokes an authorization token for an unusable port, or exposes previous financial amounts.

| File | Git blob |
| --- | --- |
| Previous complete async source | `742f4d414560ab441f111f864a12a4e2cc06be9e` |
| Repaired complete async source | `a621b7031b3ae353804d1e443deed13ca04d4121` |
| New 22-case React suite | `6a4ed3844a8248a1b9e5dae1f79c1db87635424c` |
| Unchanged earlier 52-case suite | `1a5de20da3f4070087bfb786b027ae5742ddc00e` |

## Executed focused diagnostics

Runtime: Node `v22.16.0`. These are TEST_BUILT direct-source diagnostics, not React, browser, complete-hook or integrated acceptance. Before extraction the harness checks the full source Git blob against `EXPECTED_SOURCE_BLOB`.

Run each diagnostic with:

```sh
FAULT_SOURCE=<source-path> EXPECTED_SOURCE_BLOB=<full-blob-sha> node --test resolver-regression.test.mjs
FAULT_SOURCE=<source-path> EXPECTED_SOURCE_BLOB=<full-blob-sha> node --test setup-regression.test.mjs
```

The resolver harness strips TypeScript from the actual exported resolver. The setup harness additionally executes only the actual resolver recheck branch before controller creation with a synthetic state setter. It cannot prove React lifecycle behavior; the committed component suite is required for that.

| Source / diagnostic | Exit | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: | ---: |
| Previous `742f4d4`, resolver | 1 | 8 | 4 | 0 |
| Repaired `a621b70`, resolver | 0 | 12 | 0 | 0 |
| Previous `742f4d4`, setup | 1 | 0 | 2 | 0 |
| Intermediate resolver-only `7dacd35`, setup | 1 | 0 | 2 | 0 |
| Repaired `a621b70`, setup | 0 | 2 | 0 | 0 |

Four resolver failures cover kind/read getters and throwing/revoked proxies. The two setup failures cover each metadata field becoming unreadable between the two resolution calls. The intermediate failure is retained, not relabelled as success. Original PR38 classifier failures and review-induced failures remain in its earlier evidence record.

TypeScript `5.8.3` transpileModule produced zero syntax diagnostics for the repaired source and new TSX suite. A first attempt used an incorrect global TypeScript path and failed MODULE_NOT_FOUND; resolving the actual npm global root corrected the diagnostic invocation. Syntax-only transpilation is not project typechecking.

Local full checkout/install/React/browser execution was unavailable after the GitHub DNS failure; the Entire executable was also unavailable. The repository's Node24.15.0/npm11.12.1 hosted workflow must independently qualify the new commit. At authoring, the new 22 React cases are authored, not yet claimed executed; current-candidate CI results belong on PR38 at their exact head/test-merge/tree. Prior green runs do not qualify this extension.

## Native evidence archive identities

The authoring task retains the following original probe programs and raw TAP outputs in its downloadable evidence archive. Hashes alone are not evidence that an independent reviewer executed them. The committed React suite is the repository-native reproduction.

| Retained file | SHA-256 |
| --- | --- |
| `resolver-regression.test.mjs` | `fc895ad5bd7a1eedeca8c6a890254480b6cee85220660dadb9cbfb772b6504e1` |
| `setup-regression.test.mjs` | `257987e8ec2dbe5e47f4bf28e067dbfc4b627f5a21842031edecaebfeec4739d` |
| `resolver-before.tap` | `4902e3cc188944eb4c66788d04c3b6412279713263d3b0019005fe459678044a` |
| `resolver-final.tap` | `4586edd787237a08a6482d04c1019c525a1ecffdf2c3f511c1c5c8d35e049453` |
| `setup-before.tap` | `6a2648cc3570d136a81d5ac27db735fa81132b124c262dd931b564a628260bb5` |
| `setup-resolver-only.tap` | `52e9a3b3f866bd24d01a2db80d9786b3329369f63eef35bee63caf3c3bba7436` |
| `setup-after.tap` | `1681fd03f12bb64131b4b710550d351ad78222f8b36618c8fd974d83e3eac26e` |

## Validation and acceptance boundary

The new suite covers safe unavailable rendering before token retrieval, replacement recovery, immediate withdrawal of settled amounts, cancellation and late-answer suppression, readable-port compatibility, and setup-race recovery. Together with the unchanged 52 earlier cases, PR38 adds 74 synthetic tests. No producer packet, contract pin, financial definition, grant mapping, export port or workflow is modified by this extension.

Actual host/Finance adoption, current-authority/export disclosure tests and master FIN-10/DASH-01..04 remain open. The exact jointly accepted Product/runtime–Finance handoff requested in cost-intelligence#3 comment6127027435 is still needed. No approval, merge, postmerge result, provider call, deployment or issue closure is asserted by this receipt.
