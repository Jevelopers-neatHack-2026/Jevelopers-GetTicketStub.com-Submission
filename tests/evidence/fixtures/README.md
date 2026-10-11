# Synthetic private receipt fixtures

These fixtures use synthetic tenant and event data. They were captured with the repository-pinned Node 22.23.3 runtime from baseline commit `c887d88afb9665ea92129b89d685b2a75ae482ea`; no paid service or public retrieval was used.

`private-run-receipt-v1-legacy.json` is a complete schema-v1 `no_links` receipt written by the baseline evidence-store API. Its committed SHA-256 is `6e48ff85e930aa2046719d338e79018748279446d4191ed7948b71103ac66ec5`. The capture generator is `generate-private-run-receipt-v1-legacy.mjs` (SHA-256 `0573146ec52a1bcec7527176039ad5d57f95188b1d3b8a680e7d1cad58e9c05c`); it verifies the baseline commit and `src/evidence/store.mjs` SHA-256 `0d910b9dedd97f6130202a300ba171cbe6e4870fc898445ea6d7900454db9070`. The synthetic payload key ID is `payload-legacy-fixture-v1`, derived as SHA-256 of `${tenantId}:${purpose}:legacy-receipt-v1`.

The baseline writer was rerun with this command and returned exit code 0 with the same payload hash and byte count as the committed receipt:

```sh
mkdir -p /private/tmp/ei-v1-legacy-generator-r2
EI_BASELINE_CHECKOUT=/private/tmp/ei-fanout-legacy-receipt-fixture-base-r1 \
EI_FIXTURE_OUTPUT_DIR=/private/tmp/ei-v1-legacy-generator-r2 \
/Users/completetech/.cache/acv1-toolchains/node-v22.23.3-darwin-arm64/bin/node \
tests/evidence/fixtures/generate-private-run-receipt-v1-legacy.mjs
```

Observed output was `{"state":"complete","payloadHash":"23efbd0e5b4125f0f2f90bf350d047840f523c931caa66e671f3d090fe330277","payloadBytes":773,...}`. AES-GCM uses a random nonce, so a fresh capture has different sealed bytes; the committed fixture is pinned and its ciphertext is checked byte-for-byte through store read and idempotent finalize.

`private-run-receipt-v1-overcap/` contains a separate baseline private-retrieval capture. The generator is `generate-private-run-receipt-v1-overcap.mjs` (SHA-256 `4e2f4de9cde660ad1228b466a60c50c3b161c37c6a0824a8ca8e78aa16cec6fb`) and verifies the three baseline source hashes recorded in `fixture.json`. Its synthetic local HTML has two eligible canonical links under a persisted run cap of one. Baseline execution made one request through the in-process fixture server, returned `incomplete`, left the frontier candidate `leased`, and sealed the old receipt with both links and no omission metadata. This fixture demonstrates that bounded synthetic state; it does not establish the cause of any historical public run.

The committed descriptor SHA-256 is `2981e94690d5c041b364ac91f8ebc24d5d0bc0742d48c46c9574e951aaa35cae`; the evidence and frontier database hashes are also recorded in that descriptor and verified before tests copy either database. The capture command returned exit code 0 with `{"status":"incomplete","requestCount":1,"state":"leased",...}`. The test creates a temporary copy and refreshes only that copy's bounded deadline before replay; committed fixture bytes stay unchanged.
