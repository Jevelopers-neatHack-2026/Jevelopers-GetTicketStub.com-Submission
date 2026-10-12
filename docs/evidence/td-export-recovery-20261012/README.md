# TD-09 / TD-08 export recovery: focused evidence

Refs #14, #12 and #16. Partial exception-containment work only; no issue, gate, epic, Finance authority or master criterion is accepted here.

## Scope and source identity

Base: `e7e9aece87eac258369ed551cb9800282575cc45`, tree `c64c1bffa48458e300c9cb262cdeccf5eebbc301`. The exact original `src/views/finance-v2/export-port.ts` was reconstructed from bounded GitHub reads and verified at 22,947 bytes / Git blob `c81ac3c22cef427ab14417a08bdecdf5f54d94d1` before editing. Repaired source blob: `9da55f8ebfc984690cf808042250d656ac42ca78`; authored React suite blob: `8bd774715ed1a001cd05aad0517964f23d860bd6`.

This is an isolated source snapshot, not a full local checkout. Native GitHub access failed DNS; `entire graph search --repo . --profile full --query 'Find Finance export error classification and recovery after a rejected prepared-export request'` exited 127 because `entire` was absent. Existing PR37 contrast, PR38 read-classifier and PR39 README sources were not changed. Publishing uses an isolated branch with the real main commit as its parent and preserves the remaining main tree.

Two export-specific gaps were observed: unreadable `kind`/`prepare` metadata escapes port resolution; and `instanceof` on an unknown rejected value can invoke a throwing/revoked Proxy before the shared classifier is reached. Private per-run symbols now identify internal cancellation/veto without inspecting an external prototype. A narrow classifier containment boundary releases the run into existing fixed failure copy even on the pre-PR38 classifier. Ordinary readable classifications, scope/grants, byte checking and integrated-mode refusal remain unchanged.

## Actually executed locally

Date: 2026-10-12 UTC. Runtime: Node v22.16.0 / npm 10.9.2; installed TypeScript 5.8.3 performs syntax transpilation. These are NOT the mandated Node24.15.0/npm11.12.1 toolchain and NOT project typechecking.

The retained `probe-export.cjs.txt` is the actual probe program, saved as text so it is evidence rather than a new repository script. Locally it was named `probe-export.cjs`. It transpiles the complete source module and injects TEST_BUILT hooks, permissions, a classifier and export checker. It exercises real exported resolver/callback code, but does not run React scheduling, a browser, real financial validation or a Finance provider. The protected synthetic classifier specifically isolates the prototype-inspection defect; an intentionally throwing classifier is a separate containment control.

| Exact local command | Outcome |
| --- | --- |
| `node probe-export.cjs base/src/views/finance-v2/export-port.ts` | exit 1; 4 pass, 6 fail, 0 skipped; retained `export-red.json` |
| `node probe-export.cjs candidate/src/views/finance-v2/export-port.ts` | exit 0; 10 pass, 0 fail, 0 skipped; retained `export-green.json` |
| TypeScript `transpileModule` followed by `node --check` on the generated source and test `.mjs` files | exit 0; syntax only, not project lint/typecheck/test execution |

The local base/candidate directories contained the above exact source blobs. The failing baseline is retained, not relabelled as a pass. No test result from another PR is transferred to this candidate.

| Retained artifact | SHA-256 |
| --- | --- |
| probe-export.cjs.txt | `6105bce3a79af954040193c89fcd674ddf65a6657b13005e0a6d85b621ab1d01` |
| export-red.json | `1e5b1681178cb63d01259a8d06bd7ffb9e5016772fc8c8dca7c9f189ea309ce8` |
| export-green.json | `71d831bbf97cd65faacc4a3c48c7ee0a8c9f29d4f5cb6413e29d4f08e34ec855` |

## Repository-native checks and remaining qualification

The new Vitest suite authors 22 React/hook/panel cases, using the unchanged captured receipt only as a synthetic recovery control. It covers unreadable ports, revoked/prototype/metadata errors, unchanged readable accessors and HTTP faults, token rejection, noninspection of private fields, immediate fixed failure followed by successful preparation, late-rejection isolation and current-access veto. It does not generate or repin Finance packets.

These 22 cases were NOT executed locally. Required current-candidate CI must run the existing locked install, lint, typecheck, all Vitest cases, build/package checks, contrast, browser journeys, packed fixture-host integration and report gate. Record its actual checkout/head/tree, counts and failures separately in the PR. After an independently approved qualifying merge, verify actual main separately. This pre-CI receipt does not predict either result.

The genuine selected-host test remains blocked on the owner-accepted Product/runtime and Finance composition: current verifier and grants, finite field/purpose policy, exact five-field scope/mapping, query/read port and coherent final export-release boundary. No synthetic result enables integrated reads/exports or satisfies FIN-10/DASH-01..04. Review roles: independent dashboard maintainer, Product/frontend and Finance/reliability. No review approval is asserted.

Provider mode: mock/offline TEST_BUILT inputs; no external provider request. No paid/live operation, credential provisioning, public demo, CFO import/delivery, package publication or foreign-repository mutation occurred. Provider authorization/budget/cost: N/A for this slice.
