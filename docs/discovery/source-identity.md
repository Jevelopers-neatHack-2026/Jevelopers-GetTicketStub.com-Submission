# Private source-to-identity composition

`src/discovery/identity/from-extraction.mjs` is a private offline seam for completed retrieval results. It reruns the checked-in deterministic extractor against a private copy of the retrieved bytes, ingests selected exact byte ranges through the existing evidence store, verifies the store's full-source metadata and per-position digests, stores eligible facts, and passes conservative observations to the existing entity and occurrence comparators. It performs no search, fetch, redirect, provider call, classification, or authority decision. It is not a public API or a canonical research package.

The helper does not accept a caller-supplied extraction result. The extraction result it returns was computed from the copied source bytes inside the helper. It verifies that the extractor's source URL, content type, retrieval timestamp, and `sha256:` full-source hash match that snapshot before storage. Each candidate must be a non-suggestion JSON-LD string with a full-document UTF-8 byte range whose bytes exactly equal `rawValue`; JSON-parsing that token and applying the extractor's whitespace normalization must exactly reproduce the extractor's string `normalizedValue`. Numeric, boolean, and null candidates are never stringified into identity claims.

The evidence store's `AvailableEvidenceMetadata.contentHash` is the full-source SHA-256. Each stored position has a separate digest for only that position's bytes. Before appending any fact, the helper calls the store's bounded `materializeSelected` API for all evidence handles. It checks the actual stored source URL, canonical URL, redirect chain, content type, source kind, original retrieval time, full-source hash, metadata, and complete actual position set. It matches positions by exact locator and selected-position digest, independent of position order. A descriptor mismatch fails with `STORED_SOURCE_MISMATCH` before any sourced fact is appended.

Same-byte idempotent replay can return an older stored source record. The result therefore reports `storedSource.retrievedAt` and `evidence.retrievedAt` from the immutable record, plus `observedRetrievedAt` from the current completed retrieval. It does not relabel old evidence as freshly retrieved. This seam accepts only inputs with zero redirects because `RetrievedDocument` provides a redirect count but no verified redirect URL chain to bind to stored provenance.

After writing facts, one terminal `materializeSelected` call rechecks all selected sources and facts together. The existing store performs asynchronous key/decryption work, then its required synchronous current-tenant/current-ACL authorization and store-clock retention checks before releasing an immutable batch. The helper performs only synchronous bounded mapping, comparisons, and freezing after that release; it does not call the host or store again. This verifies the store's configured current-authorization callback but does not establish that any production composition root has supplied a correct adapter.

The terminal batch returns facts in the same order as the explicitly selected fact handles. The helper validates each returned fact against the corresponding append input, including raw value, normalized value, precision, full-source hash, duplicate group, and `independence: "unknown"`. It passes the full-source digest to `appendFact` and identity references. The store checks support membership against stored positions; this helper separately binds candidate raw and normalized values to the copied retrieved bytes.

The stored fact retains the exact JSON token in `rawValue` and the extractor-normalized string in `normalizedValue`; occurrence observations use that normalized value. The small supported mapping covers event name, series/edition labels, city, venue, start/end, and exact schema.org event status values. Blank labels and over-bound values remain visible in extraction output but are excluded from comparator claims. It does not use names, URLs, host names, or branding to establish identity. Suggestion-only identifiers and URL fields are excluded. Entity-name comparisons remain review or unknown unless the existing comparator has a shared exact source-bound identifier; this seam does not invent one.

Conflicting mapped values remain separate claims. The original extraction result remains attached to each source so its other candidates, visible status mentions, conflicts, ambiguities, and diagnostics stay inspectable. Date strings keep their stated precision; unrecognized temporal strings use `unknown` precision. Every comparator result preserves `sourceAuthority: "not_evaluated"`, and duplicate bytes at different evidence IDs remain duplicate evidence with `independence: "unknown"`.

Recognized scheduled, canceled, postponed, and rescheduled event statuses remain source-backed status claims. The current extraction shape does not identify a predecessor/successor relationship, so the helper emits no transition link and lists cancellation or reschedule statuses under `unresolvedTransitions`. It does not infer a link from names, dates, URLs, or status alone. Explicit predecessor-linked history remains required for full EI-04.

The input is bounded to 8 completed sources, 512 KiB per source, 2 MiB total bytes, 23 identity candidates, 128 stored facts and positions, 256 pair comparisons, and a 12-second composition deadline. Extraction uses lower node, candidate, and parser-time ceilings. Evidence access, tenant scope, keys, and retention remain controlled by the existing evidence-store host callbacks. The fixture callbacks used in tests are local test authorities and establish no production issuer, tenant, key, or retention contract.

The store applies additional fixed aggregate byte ceilings, which can reject a composition before these composer counts are reached. Its selected API also parses a tenant manifest capped at 16 MiB; that remains a known scaling cost. These code bounds are not a server-memory or latency certification.

Cancellation and deadlines prevent identity results from being returned after a guarded await. The terminal aggregate accepts the helper's abort signal, but the evidence-store API cannot force-stop a host callback that is already in progress. Storage may contain evidence or facts written before a later failure; multi-source writes are not atomic. No partial identity result is returned.

This is partial progress for issue [#14](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/14), whose original required leaf mappings are AGT-01, AGT-05, and FIN-01. It does not verify the global Finance/reliability role or implement bounded traversal, dispatch, metering, persistent run limits, cancellation of network requests, accepted research or DecisionPort contracts, source authority, or the full research journey. Issue #14 and the release gate remain open.

On Node 22.23.3, run the focused source-identity suite, the existing extraction, evidence, and identity checks, project declarations, and the strict new consumer:

```sh
node --test tests/discovery/source-identity/*.test.mjs
node --test tests/extraction/*.test.mjs tests/evidence/*.test.mjs tests/discovery/identity/*.test.mjs
npm run typecheck
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --types node --typeRoots node_modules/@types --skipLibCheck false tests/discovery/source-identity/types-consumer.mts
make verify CASE=deterministic-extraction MODE=mock
make verify CASE=evidence-facts MODE=mock
```

`CASE=bounded-discovery` remains unregistered and is not an executable acceptance command.
