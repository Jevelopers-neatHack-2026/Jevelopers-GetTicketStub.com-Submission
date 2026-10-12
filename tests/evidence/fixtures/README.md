# Synthetic private receipt fixtures

These fixtures use synthetic tenant and event data. They were captured with the repository-pinned Node 22.23.3 runtime from baseline commit `c887d88afb9665ea92129b89d685b2a75ae482ea`; no paid service or public retrieval was used.

## Reproduction setup

Use Node 22.23.3 and set `EI_BASELINE_CHECKOUT` to a checkout of that pinned baseline. Before running either capture command below, install the baseline checkout's own locked dependencies:

```sh
: "${EI_BASELINE_CHECKOUT:?Set this to the pinned baseline checkout}"
npm --prefix "$EI_BASELINE_CHECKOUT" ci
```

The generators import modules from the baseline checkout, including its HTML/XHTML parser dependencies. Installing dependencies only in the current repository does not prepare the separate baseline. Use its own lockfile; do not substitute the current repository's `node_modules`.

## Legacy schema-v1 receipt

`private-run-receipt-v1-legacy.json` is a complete schema-v1 `no_links` receipt written by the baseline evidence-store API. Its committed SHA-256 is `6e48ff85e930aa2046719d338e79018748279446d4191ed7948b71103ac66ec5`. The capture generator is `generate-private-run-receipt-v1-legacy.mjs` (SHA-256 `0573146ec52a1bcec7527176039ad5d57f95188b1d3b8a680e7d1cad58e9c05c`); it verifies the baseline commit and `src/evidence/store.mjs` SHA-256 `0d910b9dedd97f6130202a300ba171cbe6e4870fc898445ea6d7900454db9070`. The synthetic payload key ID is `payload-legacy-fixture-v1`, derived as SHA-256 of `${tenantId}:${purpose}:legacy-receipt-v1`.

The historical baseline rerun returned exit code 0 with the same payload hash and byte count as the committed receipt. After completing the reproduction setup above, run from the current repository root. The portable commands below replace the original operator-specific toolchain and temporary-directory paths; they are not a new execution receipt.

```sh
: "${EI_BASELINE_CHECKOUT:?Set this to the pinned baseline checkout}"
EI_BASELINE_CHECKOUT="$EI_BASELINE_CHECKOUT" \
EI_FIXTURE_OUTPUT_DIR="$(mktemp -d)" \
node \
tests/evidence/fixtures/generate-private-run-receipt-v1-legacy.mjs
```

Observed output was `{"state":"complete","payloadHash":"23efbd0e5b4125f0f2f90bf350d047840f523c931caa66e671f3d090fe330277","payloadBytes":773,...}`. AES-GCM uses a random nonce, so a fresh capture has different sealed bytes; the committed fixture is pinned and its ciphertext is checked byte-for-byte through store read and idempotent finalize.

## Fanout over-cap receipt

`private-run-receipt-v1-overcap/` contains a separate baseline private-retrieval capture. The generator is `generate-private-run-receipt-v1-overcap.mjs` (SHA-256 `4e2f4de9cde660ad1228b466a60c50c3b161c37c6a0824a8ca8e78aa16cec6fb`) and verifies the three baseline source hashes recorded in `fixture.json`. Its synthetic local HTML has two eligible canonical links under a persisted run cap of one. Baseline execution made one request through the in-process fixture server, returned `incomplete`, left the frontier candidate `leased`, and sealed the old receipt with both links and no omission metadata. This fixture demonstrates that bounded synthetic state; it does not establish the cause of any historical public run.

The committed descriptor SHA-256 is `2981e94690d5c041b364ac91f8ebc24d5d0bc0742d48c46c9574e951aaa35cae`; the evidence and frontier database hashes are also recorded in that descriptor and verified before tests copy either database. The capture command returned exit code 0 with `{"status":"incomplete","requestCount":1,"state":"leased",...}`. The test creates a temporary copy and refreshes only that copy's bounded deadline before replay; committed fixture bytes stay unchanged.

## Policy-omission receipt

`private-run-receipt-v1-policy-omission/` captures a baseline `runPrivateRetrieval` receipt for a canonical URL rejected because it contains a credential-like query. The generator `generate-private-run-receipt-v1-policy-omission.mjs` (SHA-256 `71a49302ffcd5b0b5b88471bc7b2357d4084e0011d60b0fecad28025d150a98a`) verifies baseline commit `c887d88afb9665ea92129b89d685b2a75ae482ea` and the same three source hashes as the overcap capture. It uses an in-process local HTTP server and the pinned `SafeFetcher` test seam; after the first real baseline completion it injects an interruption before the second queued seed, leaving an active run with one completed old-format receipt and one queued seed. The old receipt carries `some_link_candidates_omitted_by_policy_or_parser_limit` but no exact count and retains no rejected URL. No public retrieval or paid service is used.

The committed descriptor SHA-256 is `f57113de37a9d8d65eb4c86191364d14ac052d41b279666dc9933b55fafe2b3f`; its evidence and frontier database hashes are `0c8728d0b14e8db0c901915a4c89b22003c7d6359dddb6d25881e0915167e976` and `edce65bb2859096e235d98e5d026826f614b6aa372468c8b9917c579e4677250`. A portable reproduction command, after the same baseline dependency setup and with Node 22.23.3, is:

```sh
: "${EI_BASELINE_CHECKOUT:?Set this to the pinned baseline checkout}"
EI_BASELINE_CHECKOUT="$EI_BASELINE_CHECKOUT" \
EI_FIXTURE_OUTPUT_DIR="$(mktemp -d)" \
node tests/evidence/fixtures/generate-private-run-receipt-v1-policy-omission.mjs
```

The historical command returned exit code 0. Its recorded result fields were `status: "incomplete"`, `requestCount: 1`, `completedSeed: "cbab74ce0a8e8f9f16f30487223a4c7fe0911ed64c56125a23816924a11276c0"` and `queuedSeeds: ["32d67e6627c73e68ddd01bac7c377852e24fab696966fdfcc1d63f7b61cc86af"]`. The original raw stdout capture, including its local output-directory field, has SHA-256 `fec148253d9e3a9e7ef61576134cabc102f8b0984b0513d033d11ca0441dbe44`; a reproduction using a new directory will have a different stdout hash.
