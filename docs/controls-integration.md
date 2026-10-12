The bounded local composition consumer, source-reported post-merge checks, and remaining full original-scope dependencies are in [composition controls integration](controls/composition-integration.md). Full qualification still depends on the original typed composition/compound bridge and its owner-controlled integration and acceptance evidence.

Current actual Apply→CE09 consumer details and boundaries are in [actual saved-artwork inspection](controls/actual-inspection.md). Earlier checkpoint statements below retain their historical scope; they do not describe current inspection as unimplemented.

# Structured controls and actual local Apply integration

CE-05 (#17) now supplies an allowlisted schema, defensive browser consumer,
server validation, durable Apply identity and a local adapter to the actual public
creative API, brief planner, selected native image provider and decoding codec,
immutable version store and usage outbox. The
browser's default fixture uses **MOCK trusted host authority and intercepted
provider/Finance transport**. It authenticates no real membership and makes no
network provider calls. Local API execution and persisted bytes, hashes, jobs,
selection, replay and cancellation are real. A separately versioned local composition controls consumer and durable artwork-action recovery now exist; see [composition controls integration](controls/composition-integration.md) and [reviewed artwork action recovery](controls/artwork-recovery.md). These offline mock/local consumers do not supply the original CE-05 `creative.composition.consume/1` ControlOperation bridge, compound routing or factual-correction workflow, nor do they establish app-runtime integration or external acceptance. The original composition/compound bridge remains typed-unavailable below; research correction remains pending.

This contributes to CON-01/02/03 (Agent and research), ART-01 (Creative and
fulfillment), ART-02/EVAL-03 (Product and frontend), and EVAL-04 (Finance and
reliability). Original IDs, roles and required-v1 scope remain unchanged. These
fixtures establish neither canonical publication nor external consumer agreement,
actual provider/JEV/Neatlogs acceptance, production rendering, approval or purchase.

## Reproduce

The evaluated runtimes are Node **22.23.3** and **24.15.0**. SQLite is native and
experimental on Node 22; its warnings remain visible. The browser example keeps
its existing locked TypeScript 5.9.3, Playwright 1.58.2 and axe 4.11.1 dependencies.
The codec uses the existing isolated lock for sharp 0.35.5, libvips 8.18.7 and
libwebp 1.6.0. No dependency or lockfile changes are required.

```sh
npm ci --prefix examples/frontend-action-roundtrip
npm ci --ignore-scripts --offline --prefix src/models/codec-runtime
cd examples/frontend-action-roundtrip
npx playwright install chromium
cd ../..
make build
make check TARGET=controls MODE=mock
node fixtures/controls/check.mjs --browser --out examples/frontend-action-roundtrip/test-results/controls-evidence.json
```

The combined runner executes the original foundation tests, actual local API
integration tests, strict NodeNext consumer and two Chromium projects. The
foundation project retains the original mocked brief/version projection on
loopback port 4318. The actual API project runs on loopback port 4317; `npm start`
in the example opens that fixture. `/__fixture/*` routes declare test authority,
reset state and create deterministic wait barriers. They are not an application
issuer. Temporary databases are deleted only on orderly fixture shutdown.
Separate-process tests preserve their explicit database/object paths across exit.

The existing controls CI workflow defines the controls/browser checks on both
pinned runtimes. Codec setup, public controls export/build and the actual package
consumer require serialized root integration. A workflow definition is not a
passing remote run; the supervisor must attach current exact-head CI evidence.
CloudLinux/CageFS x86_64 host certification, exact host patch, SQLite/locking,
backup and power-loss checks remain pending. Local macOS arm64 execution does not
certify that host.

## Public boundaries and compatibility

`src/controls/index.mjs` and `index.d.mts` expose the producer, ApplyStore and
CreativeControlsAdapter. The adapter consumes the existing public
`creative-engine/api/v1`, `creative-engine/contracts`, `creative-engine/versions`
and `creative-engine/telemetry` contracts. The native fixture additionally uses
the public `creative-engine/models` provider and byte inspector. Controls package-subpath publication
and its strict package consumer remain a required serialized root integration;
the current strict consumer checks the owned public source entrypoint.

Supported pairs remain `creative-controls/1.0` + `creative-apply/1.0` and
`creative-controls/1.1` + `creative-apply/1.1`, with unchanged bounded action
meaning. Clients explicitly negotiate a supported pair. Unknown Apply and
rendered schema fields reject; optional `correlation_id` grants no authority and
is bound into the full action hash. A changed correlation under the same action
identity conflicts. IDs additionally admit bounded colon/dot/plus separators used
by the actual planner and API. URL separators, HTML, credential prefixes and
unbounded IDs are rejected. No generated HTML, handlers, scripts or URL fetching
is implemented. UI labels and result strings render using text nodes.

Own-data JSON snapshots precede validation/hashing/rendering. They reject
accessors, custom prototypes, sparse or overridden arrays, symbols, methods,
cycles and excessive depth/size without calling input getters, map, iterators or
species. Public API responses pass the existing CE11 privacy projection; any
redaction requirement fails the local result binding rather than exposing raw
credentials, personal data or signed URLs.

The existing C01 wrapper remains independently versioned: contract
`DesignControlSchema`, wrapper schema `1.0`, control family `creative-controls`,
inner control version, exact tenant/project/expected versions and canonical
schema hash. `controlContractReference` and `assertControlContractBinding` check
that crosswalk. Common producer/time/mode fields remain C01's responsibility.
Authoritative maintained revisions are shared-contracts
`c4caaccc2ea63b273eeac17ed89af8ac64f6bbde` and integration-evals
`ff1f6d2df816ebbff34742f51be728fcb5c28cb5`; their design documents are not an accepted
implementation or owner agreement.

## Current state, action and backend result

A trusted synchronous `readContext(principal)` reads the actual current brief,
selected DesignVersion, selection revision, brief invalidation usability, current
host actor and current operation/options/rights policy. The fixture reads these
through public version-store methods. The application remains responsible for
actual authentication/membership and policy. Brief preferences supply bounded
values; documented local defaults apply to absent preferences. Brief locks and
current asset grants determine disabled controls and eligible logo references.
Historical selected styles come from the exact durable backend action/result
binding for that immutable design hash. Restore never fabricates a new version.

Expected-version fields are opaque current identity tokens: the brief token binds
the exact canonical brief hash; the design token binds the full selected
ID/hash/revision; the composition token currently binds the explicit unavailable
composition context. It is not an invented completed composition revision. These
same tokens participate in the immutable schema/action hash. Any current-pointer
change, including restore to the same bytes under a new selection revision,
requires fresh review. The adapter's persisted API request carries the actual
brief ID/hash, parent design ID/hash and artifact ID.

Dropdown and follow-up changes stay in browser draft state and make zero POSTs,
image/JEV calls or reservations. Explicit Apply validates principal/scope,
versions, schema hash, action identity, options and locks, then atomically persists
one typed operation plus sanitized audit. SQLite uses WAL, FULL synchronization,
bounded busy timeout and BEGIN IMMEDIATE. Duplicate or concurrent identical
requests reuse one operation. Different bodies under that action identity
conflict. Stale/conflicting requests return authorized current-version tokens and
never silently rebase. One queued/ready operation per project prevents conflicting
pending drafts.

For an eligible artwork task, `CreativeControlsAdapter` stores the exact public
API request before invoking the actual edit route. The API creates and fences its
own durable job, reserves through the injected C03 authority, records CE11
attempt/transport/outcome evidence and publishes exact bytes plus immutable
version and selection through CE08. The adapter observes the public jobs port;
it does not implement another provider executor, job lease service or ledger.
The full request hash and backend's separately observed action-request hash are
retained. Completion is accepted only after the trusted jobs port reports a
completed matching action/request and the public storage port returns the same
immutable design record. The browser cannot submit a completion receipt.

Controls bind the original UI action to its control operation, deterministic
`controls:<operation>` API action, backend job/operation, billable attempt and
exact artifact/design hash. No provider-confirmed usage or real monetary cost is
claimed by the fixture. The bootstrap creates a real locally persisted initial
concept through intercepted transport; its one fixture image call is recorded
separately as `bootstrap_image_calls`. Draft/Apply counters start at zero.

The native fixture is pinned to merged base
`5ab7f0ede215e62f6ddb5ef3472a2dc8e55cbc74`. Both bootstrap generation and explicit
artwork Apply use the public native provider, selected for this offline fixture
as `gpt-image-2.5-sunburst-2026-09-08`. This does not select an owner-approved live
model. The provider builds its real JSON/multipart request; injected fetch
intercepts it without a network call. Edit sends the exact scoped stored parent
as `image[]`. Valid PNG/JPEG/still-WebP fixtures pass complete bounded native pixel
decoding. Distinct PNG output pixels, original encoded byte hashes and immutable
parent/action/job relationships are verified. The browser fetches saved bytes
through a loopback route that checks actual API read permission and exact history
membership, renders the PNG, and verifies its byte hash and decoded dimensions.

MOCK capability, grant, in-memory credential and Finance authorities are explicitly
synthetic and bound to the actual attempt, target and local reservation record.
They issue no real membership or provider access. A separately injected declared
MOCK usage profile maps only the exact pending-profile marker and known bounded
token subsets; runtime validates its raw/target/attempt hashes. Raw private native
attribution remains `unknown` with `usage.profile_mapping_pending`, while the
separate synthetic C03 observation may settle. No production usage agreement,
rate card or real charge is inferred. Unmapped, extended and malformed usage
retain an unresolved hold and prevent publication/replay dispatch. Post-ACK
revocation and cancellation recheck current authority before intercepted fetch;
the recorded ACK conservatively retains the hold even with zero fetch POSTs.
The adapter reports its already-persisted backend job identity on authorized
error responses, without inferring dispatch, completion or settlement.

## Replay, cancellation and history

A lost HTTP response replays the persisted exact request and same durable backend
result; it does not build a fresh plan. Separate-process restart preserves job,
parent, bytes and hashes and makes no new provider/reservation call for completed
work. A hard crash after a transport intent leaves the running backend outcome
explicitly `unavailable` / `status: unknown` with the same job reference. Restart
makes zero additional transport/reservation/release calls. It does not turn lease
expiry into permission to regenerate. Finance hold durability/reconciliation
remains the external authority's obligation.

Current permissions/locks/options/source fences are rechecked around the jobs
begin, dispatch authorization and final publication callback, including after
awaited downstream authorization. Cancellation is recorded in the controls row
and forwarded to the actual jobs cancellation port; cancellation during begin is
observed when the job ID becomes available. A UI cancel or lost response does not
release a financial hold. Fixture tests inspect the hold while transport remains
unresolved and verify no late version/selection publication. Already-completed
backend jobs cannot be retroactively cancelled.

The controls database rejects an existing host-owned BEGIN or SAVEPOINT before
reading authority or invoking a transaction callback. It only rolls back a BEGIN
that the current invocation successfully opened. Completed historical Apply
replay validates the original durable completion and backend result under current
scoped read authority; it preserves the original applied versions and does not
issue another edit request or alter today's selection.

The example lists immutable versions and compares actual artifact hashes through
the public API. Restore validates expected selection revision and selects the
exact saved record; it makes zero new image/JEV/reservation calls. The controls
are refreshed for review after selection. The UI has native labelled selects,
visible disabled locks, conditional required follow-ups, Tab/type-ahead/Enter
navigation, focused error alerts and polite status announcements. Axe checks
before/after Apply and historical restore supplement, without claiming,
screen-reader or full storefront acceptance.

Generic unavailable/failed outcomes do not prove that no attempt was dispatched
or that a reservation was released. The UI retains the returned operation ID
and directs the user to the existing operation and usage evidence. Only an
explicit predispatch composition/compound bridge result reports that this action
dispatched no image and reserved no funds. Post-dispatch connection loss and
artifact-hash failure tests run the actual local API/store with intercepted
transport; their held/settled counters are MOCK evidence, not real charges.
Typed Compare/Restore rejections use separate fixed history recovery text. A
stale old-tab Restore directs the user to refresh and review the current saved
selection; a revoked current read scope produces permission guidance. Real
browser tests capture caught handler exceptions and verify both paths leave
selection and attempt/reservation counters unchanged. Unknown history codes and
backend messages render only fixed local recovery text.
The trusted context policy declares optional `can_read`, with strict source
consumers constructing both denied and omitted policies. The package remains
private and unpublished to a registry; PR #57 adds a packed, installed local
consumer for composition and artwork recovery. Application imports and externally
accepted package consumers remain pending.

## Required backend bridges

This table tracks the original CE-05 typed `ControlOperation` bridge and related follow-up consumers. It is distinct from the separately versioned local `CompositionControlsAdapter` documented above; the typed-unavailable bridge outcome does not mean that the separate local mock composition consumer is absent. These remain required local integrations, not scope waivers or external blockers:

| Bridge | Required contract and result | Current outcome |
| --- | --- | --- |
| `creative.composition.consume/1` | Consume the exact ControlOperation composition task with trusted principal/current brief+selection+composition hashes; deduplicate the same action; atomically CAS immutable composition revision/hash, typed production handoff/hash and approval-staleness request; preserve artwork bytes and return durable receipt | Typed unavailable; task remains durable; zero image/JEV/reservations |
| `creative.compound.consume/1` | Consume separately ordered composition/artwork tasks with the same action identity and per-component durable outcomes, current rights, cancellation/lease/publication fences and bounded costs | Typed unavailable; no partial image dispatch |
| Research correction consumer | Accept typed factual correction against exact package/fact/brief identity; return durable research request and approval invalidation requirement, then consume a new source package; never mutate a verified fact as a preference | Pending; controls expose no fabricated correction success |
| Native image adapter | Wire the merged selected native provider/codec through actual API/store with valid encoded artifacts, exact parent/action/usage identity and route negatives | Executable offline through intercepted fetch and declared MOCK authorities at base `5ab7f0e`; live model/authority acceptance remains pending |
| Inspection adapter | Wire qualified merged inspection ports into the same actual API/store journey with current rights and native route negatives | Actual local saved Apply→inspect consumer implemented on qualified18b; see current details above. Live/acceptance remains pending |

A future composition port must minimally provide
`consume({ principal, operation, task, expected_brief_hash,
expected_selection, expected_composition_hash })` and
`getResult({ principal, logical_operation_id })`, returning a durable
`composition_revision_id`, `composition_hash`, `handoff_ref`, `handoff_hash`,
`approval_staleness_ref`, applied bounded values and backend operation identity.
It must provide cancellation/current-state CAS at final use rather than trusting a
caller-provided completed string. The backend owner must agree/publish this
signature; it is currently a requested bridge, not an implemented contract.

## Evidence and remaining gates

`fixtures/controls/check.mjs` emits measured test exits, source/dependency file
hashes, schema/action/full-request/backend-request hashes, actual local job,
artifact and trace references, draft/final counters and a sanitized backend
transcript. Browser JSON, screenshots and failure traces live under the example's
ignored `test-results` path. Generated evidence is excluded from the source
fingerprint. Preserve failed runs alongside final results. The original
`evidence-node22/24.json` records retain their historical foundation meaning;
new integrated evidence is separately named. Despite its misleading historical
filename, `evidence-initial-failed-node22.json` records a passing development run
(`passed: true`, all three exits zero); it does not substantiate a failed
hard-crash assertion or the current candidate. Its original bytes are retained.
`evidence-followup-setup-failed-node22.json` is the authentic retained failed
setup run (41 of 42 server tests passed). Review-fix evidence is separately
named `evidence-review-fixed-node22/24.json`; the earlier integrated evidence
retains its original source fingerprint. Current hard-crash assertions verify
unavailable/unknown, the same persisted job and zero redispatch/release.
`evidence-review-fix-browser-race-node22.json` retains the first review-fix run:
all 51 server cases passed, while one new browser case selected the old field
before the asynchronous refresh finished. The corrected case waits for the
refreshed current schema and the second backend response before asserting replay.
`evidence-outcomes-node22/24.json` records the later truthful-outcome/type
corrections; prior review-fixed records retain their historical fingerprints.
`evidence-history-node22/24.json` records the later typed history-error correction.
All prior evidence bytes remain historical; the genuine before-fix browser
failures and traces are retained separately in the correction receipt.
The separately named `evidence-history-window-node22/24.json` records bound the
debugger exception capture to the history handler before axe executes. The
prior history records retain their passing assertions and original bytes; their
live attachment arrays also contain subsequently caught axe constructor
exceptions, qualified separately in the interim evidence receipt.

All five issue cases remain mandatory. Local artwork Apply, negative validation,
older/optional compatibility, duplicate/lost/restart/stale and cancellation paths
are executable. Complete name-size/layout/logo/compound/correction journeys,
reviewed native image/inspection pins, actual package consumer/root integration,
fresh full Astra exact-head/base review and CI remain required before this
integration can be accepted. Actual application/harness/JEV/provider/Finance,
canonical owner agreements, Neatlogs ingestion/readback, production renderer,
host evidence and authorized live release evaluation remain separate gates.
Issue #17 and the release gate stay open.

Apply alerts select fixed local guidance only for recognized string codes.
Unknown, prototype-name and non-string error codes use fixed uncertainty and
recovery wording; neither an upstream code nor a backend message is rendered.
The fallback leaves dispatch and reservation status unconfirmed and directs the
user to check the existing operation before retrying. Helper regressions and
actual Chromium malformed-error interceptions cover synthetic credential-shaped
codes, prototype names and non-string JSON values, focused alerts, empty handler
exception windows, unchanged selection/counters and no canary in page text.
These interceptions replace only failed Apply responses and prove no successful
backend or live-provider outcome. Historical evidence remains unchanged.

The native port preserves every committed historical evidence JSON from the
source-reviewed `09335cd` candidate byte-for-byte; its source-only approval does
not transfer to this changed base. New native evidence is separately named.
Early native draft server runs observed 53/55 passes (frozen provider fault wrapper)
and 8/11 passes (the new probe incorrectly read an absent error action ID).
Their logs were placed under Playwright's disposable output directory and were
purged by its first browser invocation. Complete raw-log custody is unavailable;
these counts/errors are observed tool-output provenance, not reconstructed logs.
Later genuine draft failures and all current command logs are retained outside
that directory under ignored `playwright-report/native-evidence`. One later run
passed 63/66: unknown-usage responses omitted the already-persisted backend job
ID. Scoped current-read-authorized identity reporting corrected that behavior,
and the same exact replay/hold assertions remain required.

## UI consumer preparation after ccc9c74

The next bounded source checkpoint extends actual native browser Apply/history/Restore/Compare/replay and cancellation/unknown-hold behavior to PNG, JPEG and WebP. JPEG/WebP remain static codec samples, with no visual-edit quality claim. A separate versioned, accessible local inspection presentation fixture and pure request-fragment builder prepare future consumption without enabling unqualified CE09. See [inspection consumer preparation](controls/inspection-consumer-preparation.md) for exact evidence boundaries, current-selection versus schema-token semantics, commands, failing public-package prerequisites and required local/external gaps. No old evidence or source approval transfers to this new checkpoint.

## Defensive result references

The browser consumes Apply and saved-version references through `src/controls/public-result.mjs`, using the existing bounded own-data snapshot and privacy-screened ID grammar. Failed Apply references are checked before they replace recovery state or enter status text. An unsafe or malformed reference produces fixed local uncertainty guidance; a previously known safe operation remains available for the same action retry, refresh/lookup and cancellation. Unknown or malformed status values do not overwrite the known lifecycle. Raw backend prose is never projected.

The same presentation boundary checks saved version IDs, exact artifact hashes, backend job references, history selections/Compare/Restore results and numeric counters before display or artifact requests. Error formatters read only own data and never coerce unknown codes. Focused tests use explicitly synthetic failed Apply responses with real bootstrap/read APIs and exact unchanged backend counters; a separate recovery test starts from an actual intercepted-native connection-loss operation with an unresolved hold. Neither fixture fabricates a successful backend result or an inspection journey. Source-local declarations and strict consumers cover the projections; genuine controls package and actual downstream integration prerequisites remain required and unmet.

The public Apply presentation also validates outcome consistency before promoting a reference or lifecycle. Queued acceptance, typed ready handoff, replay, cancellation and artwork completion have explicit supported forms. Completion requires the saved design/hash and backend job references; a safe operation ID alone cannot establish saved artwork. Contradictory failure statuses and incomplete success envelopes use fixed uncertainty guidance while retaining an earlier safe recovery identity and lifecycle. Actual native unavailable results without a top-level status remain supported. These consumer checks confer no backend, inspection, composition or handoff authority. Browser regressions inject malformed responses separately from the actual native unknown-hold journey, then verify same-action retry, refresh and cancellation without added image calls, reservations or hold release.

A genuine metadata-only `replayed`/`ready` Apply result acknowledges an existing safe operation without supplying a fresh typed handoff. The public presentation marks this as acknowledgment only and offers Validate handoff for a current typed response; it never claims saved artwork. If an operation payload is supplied, it must still satisfy the typed handoff shape. Completion still requires saved design/hash/job evidence. The actual foundation browser Apply → Validate handoff → Retry Apply path verifies unchanged identity and zero image/JEV calls, then retains Refresh/cancellation recovery. This local foundation compatibility evidence does not complete the required actual CE06 consumer.
