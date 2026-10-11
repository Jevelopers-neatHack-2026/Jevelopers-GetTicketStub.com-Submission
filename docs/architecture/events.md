# Product events (`ticketstub.event/1`) and messages (GT-09)

## What an event is

A typed record of something that happened, with safe fields only: hashes of ids, codes, counts, flags and
timestamps. Never a URL or query string, a prompt, an email, a name, a note, a photo or a token. The taxonomy and the
sanitizer are in `src/server/events.ts`; an event can only be built through `sanitizeEvent`, which keeps the fields a
type names (`EVENT_SPEC`) and drops everything else.

Types: `intake_submitted`, `intake_rejected`, `research_started`, `fact_corrected`, `art_requested`, `art_ready`,
`art_failed`, `art_limit`, `version_selected`, `share_created`, `share_revoked`, `gift_created`, `order_placed`,
`order_blocked`, `signin_link_sent`, `signed_in`, `claim_redeemed`, `storage_unavailable`.

Every event carries `schema`, `type`, `at`, `requestId` (the correlation id), `actor` (`account | guest | anonymous`),
`actorRef`, `projectRef`, `mode` (`sandbox | live`) and `fields`. Ids are stored as `refOf(id)`: a 16-hex hash.

## Correlation

A request's `x-request-id` is kept when it matches `[A-Za-z0-9_.-]{8,64}`, otherwise a new `req_...` id is made. The
`route()` wrapper in `src/server/http.ts` sets it on the response, and every event the request records carries it.

## Storage and retention

SQLite table `events` (the last entry in `src/server/migrations.ts`), append-only: a trigger refuses `UPDATE`, and another refuses `DELETE` of any row
newer than 90 days. `prune` (run on each sign-in link) deletes rows past `EVENT_RETENTION_DAYS` (90). When storage is
unavailable, events go to a 200-entry in-memory ring (lost on restart); `storage_unavailable` is only ever recorded there.
Hashes remain after an account is deleted until they age out; they cannot be turned back into the id.

## Reading

- `GET /api/events?project=stub:<id>` (or `event:<id>`): the owner's (a stub's owner, an organizer event's captain)
  history of that project. Anyone else gets the same 404 as for a project that does not exist.
- `GET /api/events?scope=all`: all events, newest first, under the `admin.view` capability. Anyone else gets a 404.
- `POST /api/events`: the browser reports `version_selected` and `fact_corrected` (the server cannot see them). Use
  `reportEvent()` from `src/customer/feedback-messages/report.ts`.

## Harness hand-off (not built)

The agent-harness repo owns Neatlogs and durable workflow tracing. `exportToHarness()` in `src/server/events.ts` is a
no-op stub marked TODO where that hand-off plugs in. Product events are not sent to Neatlogs; only the content-free
operational events can be, when enabled (see docs/operations/observability.md#neatlogs-traces).

## Messages

`src/customer/feedback-messages/messages.ts` maps every error code to a brand-voice message and a recovery action:
`messageFor(code)`. Unknown codes get the generic message. `scripts/check-messages.mjs` (suite `messages` of
`verify:product`) fails when a code raised in `src` has no entry. `progress.tsx` holds `useProgress`, `ProgressNote`
and `FeedbackNote`: progress states are only the real ones (sending, "Still working…" at 6 s, unknown at 20 s, done, failed).
