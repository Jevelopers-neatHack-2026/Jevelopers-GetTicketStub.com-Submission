# CI-03 synthetic tariff input

This file is a test-only source note. Every rate used by the CI-03 fixtures, including the USD-to-EUR conversion, is invented for deterministic acceptance testing. It is not a provider quote, current price, forecast, or authorization amount.

Synthetic unit rates are stated in ci03-synthetic-acceptance.json. The input token total includes the cached and cache-write subsets; the ordinary input quantity is the total less those disjoint subsets. Output tokens include reasoning tokens, which the fixture prices once through the output total. An explicit zero rate for the fixture-only zero-tariff category is different from a missing category.
