# CI-03 pricing source evidence

Live verification times: 2026-10-11T04:06:27Z, 2026-10-11T04:35:10Z, and 2026-10-11T05:13:39Z. The first set records the official Markdown responses used for fixture semantics. The later sets record fresh official HTML responses used to recheck usage fields and pricing dimensions for the review-fix loop. The complete latest responses are retained outside the tracked product at `artifacts/evidence/openai-doc-snapshots-2026-10-11/` with an HTTP status and SHA-256 manifest. The mutable pricing page was inspected for dimensions and scope only; no numeric provider rate was copied into the fixtures. The fixture tariff remains synthetic.

| Topic | Official source | SHA-256 | Implementation fact |
| --- | --- | --- | --- |
| API pricing | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) (pricing.md) | e0767b5009dcc929a2f9eeb9ce6096a57ff12e5d8c011de9d69ff145aef2fc28 | Prices vary across model and service dimensions; explicit model/product/tier matching is required. No current numeric tariff is imported. |
| Prompt caching | [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) (prompt-caching.md) | 74dc45350d5de0e7eef80b0b09d67b733a73170275f1bacb0760e066a4254480 | Cached input and cache-write input are portions of total input. Cache-write units use their own rate in place of ordinary input pricing, not as an additive fee. |
| Reasoning usage | [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) (reasoning.md) | a561487dd41db8828b5b9920d77275bdced3c3c07ba1fb9f3c3230c5aaeb925b | Reasoning tokens are included within output token totals. No second reasoning charge is added when the total output category is priced. |
| Responses usage fields | [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) | 9a9263ca93e192aa1c6496ad82bb5d2c8722efcc8a077d1fab1834383e681b16 | Usage may be unavailable; reported fields include input/output totals and nested cached, cache-write, and reasoning token details. Missing usage remains unknown. |

| Review-fix recheck | Official page | HTML SHA-256 | Implementation fact |
| --- | --- | --- | --- |
| Pricing dimensions | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) | 9fa36556daa3463d247142d237e97cb518577924621365217abf6d2cbeeb94cf | Prices vary by explicit model and service dimensions; fixtures remain synthetic. |
| Responses usage details | [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) | 9a9263ca93e192aa1c6496ad82bb5d2c8722efcc8a077d1fab1834383e681b16 | Nested cached-input and reasoning-token fields are separate from total input/output counters. |
| Reasoning details | [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) | 5117289787e0c8369e3fadc4acc43e2a009c7a1a6dc777e93c3905164918e4a7 | Reasoning usage is represented within output usage; the fixture does not add it a second time. |

Latest retained HTML responses, fetched directly from the official documentation host and hashed after HTTP 200 responses:

| Topic | HTML SHA-256 | Bytes | Implementation fact |
| --- | --- | ---: | --- |
| API pricing | 9fa36556daa3463d247142d237e97cb518577924621365217abf6d2cbeeb94cf | 595036 | Tariff applicability varies by model and service dimension; no live rates were imported. |
| Prompt caching | 6b4b130c5fe1169be16a21a62c692d9dba3abe9f56fdc92f2ecfbd8ffe163b41 | 768092 | Cached input and cache writes are parts of total input; cache-write rate replaces ordinary-input pricing for that partition. |
| Reasoning | 5117289787e0c8369e3fadc4acc43e2a009c7a1a6dc777e93c3905164918e4a7 | 1091239 | Reasoning tokens are reported within output usage and are not charged as a second output total. |
| Responses usage reference | 9a9263ca93e192aa1c6496ad82bb5d2c8722efcc8a077d1fab1834383e681b16 | 11951350 | The API exposes nested cached-input, cache-write, and reasoning counters beneath input/output totals; absent usage remains unknown. |

The web renderer could not open the large response reference, so it was fetched directly from the official host and retained in the local evidence directory. This file records short summaries and hashes rather than copying mutable documentation.

## Synthetic source and fixture hashes

- fixtures/pricing/synthetic-tariff-source.md: sha256:fead7c36b0fdc010a78b28db5ee9cc808100c40bf622f1a85be5bd7672279297
- fixtures/pricing/ci03-synthetic-acceptance.json: recorded in the implementation report after the final fixture revision.
- Synthetic rates and FX are scoped to tests, marked synthetic_fixture, and are not supported quotes, billing exports, forecasts, or authorization bounds.
