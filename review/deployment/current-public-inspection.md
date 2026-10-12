# Preserved public HTTP identity inspection

Captured at `2026-10-12T14:20:06Z`; requests ran 2026-10-12 14:20:05–14:20:06 UTC. Exact local reference source: `329fc4f27e7b9792e60eabcf4f2401f4541254a5`, retrieved using `git show <revision>:site/index.html`. Expected static page: 197069 bytes, SHA-256 `a078774df18e59b884bdff968f2bec3e4a5b2a009458d30c8320242f595858f6`.

Tool: `curl 8.7.1 (x86_64-apple-darwin26.0) libcurl/8.7.1 (SecureTransport) LibreSSL/3.3.6 zlib/1.2.12 nghttp2/1.69.0`. Runtime: Python 3.14.4, Darwin/arm64. [current-public-inspection.json](current-public-inspection.json) records exact argv, timings, final URLs, HTTP versions, SSL verification outcomes, response body/header hashes and local evidence paths. curl configuration was disabled, requests were unauthenticated public GETs, no credentials/cookies were supplied, and redirects were restricted to HTTPS. Response cookie/authorization values, if present, are redacted in saved headers; raw-header digests are preserved. Exact body bytes remain in the original local capture and are not copied into this PR. Only sanitized headers and the digest/metadata receipt are archived in this evidence change.

| Requested URL | HTTP | Final URL | Redirect count | Response body SHA-256 |
|---|---|---|---|---|
| `https://getticketstub.com/` | 200 | `https://getticketstub.com/` | 0 | `a5156ad30056003e3f71b80fd4665e955041e56864a33cb60ee33f9be92f443d` |
| `https://getticketstub.com/api/health` | 200 | `https://getticketstub.com/api/health` | 0 | `df6384a0b06284348180ec87356b024dffcab18b6f9173dc70d68fd11e270559` |
| `https://getticketstub.com/health` | 404 | `https://getticketstub.com/health` | 0 | `afdee0d045b9b35a0f5e814fb9ad9615def73e3cb00dc76249fb0e57cd80c02f` |

Public root returned 24262 bytes, title `TicketStub`, and Next framework markers. Its raw HTTP HTML has neither the current static `maker` group nor the current native `demoLink` Open studio href. It is **not byte-identical** to the current 197069-byte standalone static page (title `getticketstub.com`). This does not identify an alternate source revision or establish transformed/client-rendered host behavior.

The known `/api/health` endpoint returned version `0.1.0`, mode `live` and storage `ok`; its scalar public status fields are recorded in JSON. Semantic version, status, timing and infrastructure headers do **not** attest a source SHA. The literal `/health` path was separately requested only as an alias/path check and returned 404; `/api/health` is the observed health endpoint.

No explicit source SHA/revision identifier was found in inspected relevant headers, health JSON fields or explicit source-commit HTML markers. Deployed source revision and artifact identity remain **UNKNOWN**. HTTP 200 is availability evidence only, **not** issue #17 / LP-10 #12 acceptance or proof that the a078 static artifact is deployed. Existing exact public Open studio navigation approval remains limited; this observation issues no new owner, privacy, publication, asset-rights or release approval.

No browser, account, credentials, provider, order, purchase, GoDaddy action, deployment or publication was performed. Shared browser inspection is reserved to the root agent. This evidence-only change archives the authorized report/receipt and sanitized headers. Original response bodies stay under `/tmp/lp-release-public-inspection`; public HTTP observations were not recaptured.

## Documentation import and lineage

This PR is based on `42dd531c65d3adb1bb31b1057dba2c808aaf07de`. The original HTTP capture inspected reference `329fc4f27e7b9792e60eabcf4f2401f4541254a5` at 14:20:05–14:20:06 UTC. The current base has the same static page SHA-256 `a078774df18e59b884bdff968f2bec3e4a5b2a009458d30c8320242f595858f6` and byte-for-byte source as that reference; this local Git comparison does **not** refresh public availability or identify deployment. Original receipt SHA-256: `1785966aa122491e2982b6502012ed23488c82b4b757a6d3ec54243424cdb065`; original report SHA-256: `2335e64f23defe56d1e8e358543e3a08c3c267394d767e358a1f970b5ae8710e`. Archived receipt SHA-256: `1e83bf68830e8f9245835f355d282d548fa40c24befa972864218d3fa97a7c73`.

No raw live Next markup is copied into the repository. Exact raw body digests, final URLs, statuses and header digests remain in the receipt. Original header digests and saved redacted-header digests are both recorded. Archived sanitized headers: [root](current-public-root.headers.txt), [API health](current-public-api-health.headers.txt), [literal health path](current-public-literal-health-path.headers.txt). The fixed request argv in the receipt records the original executed temporary paths, not a new run. Browser QA and any release decision remain owned by the root/acceptance owners. No source/config/suite or acceptance gate is changed.
