# CI-03 pricing source evidence

Live verification time: 2026-10-11T04:06:27Z. These hashes are of the official responses retrieved during implementation. The mutable pricing page was inspected for dimensions and scope only; no numeric provider rate was copied into the fixtures. The fixture tariff remains synthetic.

| Topic | Official source | SHA-256 | Implementation fact |
| --- | --- | --- | --- |
| API pricing | [OpenAI API pricing](https://developers.openai.com/api/docs/pricing) (pricing.md) | e0767b5009dcc929a2f9eeb9ce6096a57ff12e5d8c011de9d69ff145aef2fc28 | Prices vary across model and service dimensions; explicit model/product/tier matching is required. No current numeric tariff is imported. |
| Prompt caching | [Prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) (prompt-caching.md) | 74dc45350d5de0e7eef80b0b09d67b733a73170275f1bacb0760e066a4254480 | Cached input and cache-write input are portions of total input. Cache-write units use their own rate in place of ordinary input pricing, not as an additive fee. |
| Reasoning usage | [Reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) (reasoning.md) | a561487dd41db8828b5b9920d77275bdced3c3c07ba1fb9f3c3230c5aaeb925b | Reasoning tokens are included within output token totals. No second reasoning charge is added when the total output category is priced. |
| Responses usage fields | [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) | 9a9263ca93e192aa1c6496ad82bb5d2c8722efcc8a077d1fab1834383e681b16 | Usage may be unavailable; reported fields include input/output totals and nested cached, cache-write, and reasoning token details. Missing usage remains unknown. |

The response usage reference exceeded the web renderer's 4 MiB page limit, so its complete raw response is not embedded here. The response bytes were streamed from the official page and hashed without storing or reproducing the document. Official prompt-caching and reasoning markdown responses were likewise hashed from their .md URLs. This file records a short implementation summary and the source hashes rather than copying mutable documentation.

## Synthetic source and fixture hashes

- fixtures/pricing/synthetic-tariff-source.md: sha256:6eae5eaa3c2a417cccd9faf5219f67489b3f7957ae31cf9f2378d5f2651f7401
- fixtures/pricing/ci03-synthetic-acceptance.json: recorded in the implementation report after the final fixture revision.
- Synthetic rates and FX are scoped to tests, marked synthetic_fixture, and are not supported quotes, billing exports, forecasts, or authorization bounds.
