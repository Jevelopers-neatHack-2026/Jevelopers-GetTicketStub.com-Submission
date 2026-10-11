# Dated source observations

Checked 2026-10-11 UTC during the CFO.ai task.

## Official submission requirement

https://neatlogs.com/hackathon was read live. Its Requirements and Evidence sections require using CFO.ai to plan the agent's pricing, costs, revenue and runway and including the resulting plan in the submission. Supporting evidence belongs in the public repository; the demo video must cover CFO.ai. A login/account screenshot alone is insufficient. The final submission cutoff is announced on Discord; this task does not submit the hackathon entry or address other sponsor/setup requirements.

## Rate provenance

- `vendor-text-rates.json`: selected public model catalog entries retrieved from https://openrouter.ai/api/v1/models, unauthenticated. Prompt/completion prices are per token in USD; token quantities are modeled separately.
- `vendor-image-models.json`: selected dedicated image-model catalog entry from https://openrouter.ai/api/v1/images/models, unauthenticated.
- `vendor-image-rates.json`: public endpoint response from https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints, unauthenticated. Input-text, input-image and output-image rates have different dimensions. No generation request was made.
- https://stripe.com/us/pricing was verified as US domestic-card standard 2.9% + $0.30. The generic pricing URL initially localized to India; the US benchmark was checked separately. This is a benchmark only, not evidence of project payment setup or merchant eligibility.
- https://openrouter.ai/docs/faq confirms fees on credit purchases; numeric fee was initially absent from the text rendering. CFO.ai identified the published 5.5%/$0.80 minimum; an independent curl of official HTML confirmed the embedded fee string. vendor-credit-fee.json retains the dated observation and source-response hash. The model's 6% allowance remains a separate conservative estimate.
- https://www.prodigi.com/print-api/docs/reference/ was inspected for the quote mechanism. No product price, project SKU, authenticated quote, order or account access is claimed.

The initial guessed `/api/v1/image/models` URL returned HTTP 404. It was corrected from the repository's implemented public metadata URL, `/api/v1/images/models`; successful catalog results, not the failed request, support the model. No keys were requested or used.

## CFO.ai workflow observations

Existing Welcome chat was preserved. A separate TicketStub chat and canvas were created through the existing signed-in browser session. CFO.ai reported usable existing trial capacity. Its assistant also made a billing-renewal statement conflicting with the user's confirmed cancellation; that statement is not treated as verified billing evidence, and the assistant was corrected. No billing settings were changed.

CFO.ai reported that page-level private-audience controls are disabled in the workspace. No public share link was enabled. Only sanitized public project facts, vendor prices and hypothetical financial inputs were entered; the artifact can be visible to existing workspace members.

File upload was attempted through the supported attachment UI but the browser extension disallowed file access. No extension permission was changed. The same sanitized plan inputs were pasted into the CFO.ai composer instead. The retained `cfo-plan-input.txt` is the complete local reference input; the actual submitted chat contains equivalent assumptions and calculated checkpoints in a compact form.

The final artifact/export verification is recorded in README.md after completion. Source inspection and local inputs alone are not proof that CFO.ai saved the completed plan.

## Completed delivery

CFO.ai completed its three-step plan and exposed the native workbook and additional sanitized XLSX/PDF/ZIP attachments. This repository retains the unchanged native workbook that was independently verified, together with the actual saved narrative and canvas screenshot. Additional assistant-packaged attachments are not needed for this record and are not claimed as independently reviewed. CFO.ai reported its own export recalculation checks; the independent local check is limited to XML/formula inspection and cached-value recomputation as stated in export-verification.json.
