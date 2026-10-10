# Bounded safe-asset byte inspection

`src/security/assets/inspect.mjs` is an internal byte-only inspection and SVG transformation primitive. It snapshots a plain `Uint8Array` or `Buffer`, hashes that source snapshot, and accepts only an exact `image/svg+xml` media type. Successful SVG input is parsed as strict XML with the repository-pinned SAX parser and reserialized into a deterministic, closed static geometry subset: `svg`, `g`, `rect`, `circle`, `ellipse`, `line`, `polyline`, and `polygon` with bounded finite geometry and a closed set of paint attributes.

The parser rejects entity references, declarations, comments, processing instructions, active elements, event attributes, CSS, font and text features, images, animation, links, foreign namespaces, malformed XML, non-UTF-8 input, and oversized work. Unsupported but non-active SVG features produce `review`; they never return source bytes as transformed output. Raster formats are not decoded or dimension-checked and remain in `review`. A type that claims another media type while beginning with markup is rejected as a content-type mismatch.

`action: 'transformed'` means only that the returned copy is the deterministic serialization produced by this static geometry policy. It does not establish identity, source provenance, role, usage rights, issuer authority, tenant scope, approval, or permission to reproduce an asset. `sourceHash` and `transformedHash` are distinct content identities. An approval bound to original bytes does not automatically apply to transformed bytes. Each call to `copyTransformedBytes()` returns a fresh caller-owned copy; `matchesTransformedBytes()` checks a candidate against the retained transformed snapshot after taking its own bounded copy.

This core does not fetch, persist, render, decode raster data, invoke providers, classify candidates, validate external approvals, build a permitted-asset set, or guarantee process-wide network egress. Those are separate producer, consumer, and authorization responsibilities. It is not a browser renderer or an end-to-end safe-image claim.

Run focused tests with Node 22.23.3:

```sh
node --test tests/assets/safety/*.test.mjs
```

Check the module's consumer declarations with the repository's pinned TypeScript 7 and Node types:

```sh
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --types node --skipLibCheck false tests/assets/safety/types-consumer.mts
```

This core is a partial EI-08 implementation. Candidate discovery, structured observation and role classification, permission verification and revocation, original-artwork fallback, and creative handoff remain outstanding. EI-08 (#18), the release gate (#22), and the repository epic (#1) remain open until their complete acceptance gates have evidence.
