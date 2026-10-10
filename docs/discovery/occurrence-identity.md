# Conservative entity and occurrence identity core

`src/discovery/entities/identity.mjs` and `src/discovery/occurrences/identity.mjs` compare two already collected, evidence-backed candidate records. They are private implementation shapes tagged `ei-entity-observation-internal/v1` and `ei-occurrence-observation-internal/v1`; they are not a canonical wire contract, provider port, public package export, or event registry.

The caller must first read and validate supported facts and evidence positions through the repository evidence boundary. It projects the evidence ID, SHA-256 content hash, exact text-range or JSON-pointer locator, original fact field, and exact value into each support reference. Identity comparison checks that projection's shape and consistency; it does not independently query the evidence store, re-open source bytes, validate URLs, or assess source authority. Treat all output values as untrusted research observations.

## Entity candidates

An entity observation has a stable candidate ID, a coarse entity kind, sourced or customer-supplied names, and optional namespaced identifiers. Two candidates can receive `same_entity_candidate` only when they have the same exact identifier namespace and value, the claim origins agree, and both claims point to the same evidence ID, content hash, locator, field, and value. This is a source-bound relationship candidate; it does not establish that the source is official or that separate pages corroborate it.

The implementation returns `review` for a similar name or an identifier repeated in different source positions. Different source-backed values for the same identifier namespace return `different_entity_candidate`. Conflicting identifiers within one candidate stay visible and return `review`. Names, URLs, host names, links, and branding cannot create an entity match. Kind mismatches also require review. Candidate IDs use locale-independent UTF-16 code-unit ordering in returned snapshots.

## Occurrence candidates

An occurrence observation stores lists of supported values for title, series, edition, city, venue, start, end, and status. Lists preserve competing facts. A source-bound `same_occurrence_candidate` requires an exact shared title claim plus an exact shared start-date or edition claim, including the same source position and origin. The comparison searches every compatible claim pair, so equivalent claims retain the same identity result regardless of input order. Matching values from separate pages alone are insufficient.

Explicitly different cities, editions, or date-only start days produce `different_occurrence_candidate` decisions, which keep both records separate. Changed venues and status claims, conflicting claims within a record, mismatched date precision, unknown date precision, and changed local times remain `review` decisions. The comparison retains every input claim and source reference, reports conflict fields and reason codes, and returns candidates in stable ID order.

Date values use only the declared `date`, `local_datetime`, `instant`, or `unknown` precision. Dates and clock components are validated without converting them. A date-only value is never promoted to a timestamp; an instant requires an explicit UTC marker or numeric offset; an unknown time zone is never filled in. Distinct timestamp spellings are not normalized into a match.

An equal SHA-256 hash on different evidence IDs is reported in `duplicateContentHashes`. It does not increase a corroboration count; no corroboration count is emitted. Entity and occurrence results also return `sourceAuthority: "not_evaluated"`.

## Cancellation and reschedule records

`createOccurrenceTransition` returns a frozen record with the predecessor ID, optional successor ID, transition kind, and source-backed status references. A cancellation requires a `canceled` status reference and has no successor. A reschedule requires a `rescheduled` status reference and a different successor ID. The record ID is a SHA-256 digest of its contents, so accidental edits are detectable; it is not a signature or proof of issuer authority.

When a validated reschedule link relates the compared IDs, the comparison returns `different_occurrence_candidate` and retains the predecessor/successor link. A cancellation link naming either compared predecessor routes the pair to review, retains the notice reference, and marks status as uncertain even if the cancellation status is not duplicated in candidate facts. These links describe reported history; they do not automatically merge records or determine that the source is authoritative. The caller remains responsible for validating the references against stored evidence before creating or loading a link.

## Bounds and limits

Inputs are copied from own enumerable data properties, getters and extra fields are rejected, values and arrays are bounded, nested evidence locators are allowlisted, and outputs are deeply frozen snapshots. This avoids invoking ordinary getters and prevents later caller mutation from changing a decision. JavaScript cannot prevent a Proxy trap from running during reflective inspection; exceptions from malformed reflective objects fail closed.

This core does not implement the EI-04 bounded discovery planner, search or fetch dispatch, concurrency/time/spend limits, cancellation of in-flight retrieval, restart-safe counters, JEV question routing, accepted research request/package contracts, evidence-store integration, or metering. It does not satisfy the full EI-04 issue or AGT-01, AGT-05, or FIN-01 acceptance criteria. Those integration and release checks remain open.
