# Publication safety and asset reuse

This policy is for source files and every derivative: screenshots, mockups, diagrams, slides, fonts, artwork, generated visuals, audio/video, captions, alt text, QR codes, and linked resources. The current policy/canary work is nonvisual. It does not inspect pixels or authorize publication of any asset.

## Provenance and permission

Record each asset and derivative in review/provenance.json with a stable ID, exact source repository/path or source URL, immutable revision or content digest, creation/capture date, creator and tool/model when applicable, evidence classification, consent, permission and attribution reference, allowed destinations and modifications, expiry/review trigger, redaction steps, reviewer/date, and publishability state.

Each derivative must point to its exact sanitized parent/source and checksum. Record crop, resize, flattening, format conversion, transcription, OCR, or other transformations in lineage. A source, rights, consent, redaction, content, crop, or destination change invalidates affected approval. Preserve old decisions and checksums as deprecated history without keeping or reusing unsafe content.

Permission must be explicit for the exact asset, use, modification, attribution, and destination. Repository visibility, possession, a source link, generated origin, or an upstream demo does not itself grant permission. Unknown, expired, limited, or revoked rights/consent means omit the asset or replace it with clearly labeled synthetic content. Never infer a license or sign away a source owner's rights. Record an attribution reference when required.

For a reuse request, verify permission at the source owner, permitted modification, intended destination, expiration, required attribution, and consent scope. If the record is missing or cannot be checked, keep publishability blocked. On revocation, mark the asset rejected/deprecated, stop new reuse, locate and withdraw controlled derivatives where possible, and retain only a non-disclosing decision record and checksum needed for audit.

## Redaction and review surfaces

Inspect the flattened export, not only the editable source. Check visible pixels at 100%; filenames and embedded metadata; document comments and speaker notes; alt text and reading order; audio/video frames and transcripts/captions; QR destinations; hyperlinks and linked resources; and extracted text from the exported file. Redaction must remove the underlying data from the exported artifact. Blur, a black rectangle over a layer, hidden content, crop, or changed filename is not sufficient.

Keep restricted originals and personal/customer/financial source material in access-controlled storage outside this public repository. In public evidence, use only sanitized, non-disclosing references. A real finding means stop publication, preserve only safe references, and follow the source owner's confirmed private reporting process. Never copy a real secret, personal record, financial account, or customer trace into the test fixture, issue, or public repository.

## Synthetic canary scope

review/fixtures/synthetic-canaries.json contains only invented marker strings and an expected sanitized text representation. The canary exercises text/JSON policy logic for visible-text fields, metadata, notes, alt text, transcript, QR target, linked resource, and extracted text. It does not produce an image, video, audio file, or flattened export and does not prove that any pixels, metadata, or notes were inspected or removed from a real artifact.

The automated validator rejects unknown or revoked permission on a release-bound record and reports missing destination approval. It only validates text/JSON records and the synthetic canary fields; it is not a media scanner or image redactor. For each actual visual/media export, a qualified reviewer must record the format-specific render/reopen command, pixel review at 100%, metadata/notes/text checks, checksum, exact derivative/source lineage, and destination-specific rights review. If those findings are absent, MM-05-B and release remain blocked.

## Current status

The nonvisual fixture is synthetic and for internal repository policy tests only. It has no external reuse permission. Actual asset permissions, creator attestations, source-owner rights, pixel review for rendered exports, notes/metadata review for final exports, and downstream destination approvals remain pending. No real customer, secret, or financial data was used in this policy fixture.
