# Source retrieval component

This adapter exercises the pinned event-intelligence `SafeFetcher` through its
public source export and owner-owned local fixture hooks. It is partial mock-only
component evidence, not installed-package adoption, accepted research API behavior,
provider behavior, authoritative external egress capture, or composed acceptance.
The original 42 cases, modes, requirements and 142 obligations remain unchanged.

## Run on Linux

Use three clean, physically separate checkouts named `integration-evals`,
`event-intelligence` and `shared-contracts` under one workspace directory. Pin
event-intelligence to `d91e08d666abc243ae456a7f9f1bc9c745ca4f8d`, and shared-contracts
to the exact `contracts/producer-pin.json` revision. The evaluator checkout must
include this adapter and be clean/committed. No producer files are edited by setup.

Stage and review the actual Linux Node 22.23.3 binary identity, then create the
component manifest outside the checkouts:

```sh
cd /workspace/integration-evals
uv sync --frozen
uv run integration-evals contract-runtime --node /approved/node --output /workspace/node-runtime.json
uv run python -m integration_evals.retrieval_setup /workspace /workspace/node-runtime.json /workspace/retrieval-assembly.json
uv run integration-evals run --workspace /workspace --manifest /workspace/retrieval-assembly.json --mode mock-only --output /workspace/reports
```

Execution needs the repository's existing Linux Bubblewrap environment. CI uses
its existing privileged test invocation. The process layer retains `--unshare-net`,
`--unshare-pid`, read-only root, an isolated writable directory, and bounded cleanup.
No host-network exception, firewall change, new capability or private infrastructure
probe is part of this adapter. A missing or unusable namespace fails closed.
All fixture servers are created inside the same task-local network namespace as the
fetcher. An allowed request must reach its fixture server and return known bytes.

The manifest fixes Git commit/tree/lock bytes, the original fixture catalog,
canonical schema artifact, Python runtime and adapter profile. Its command fixes
the Node executable and SHA256; the adapter checks its own binary bytes and version
before importing owner hooks. The owner profile is a reviewed source-only test
configuration, not an approval or provider authorization.

`Component.supported_modes` is optional for archive compatibility. This component
declares only mock-only. Dispatcher, direct owner calls and passed-archive validation
enforce that declaration; the Node entrypoint also rejects other modes and non-Linux
execution before importing fixture hooks. Omitted declarations retain the old
component behavior. The global case modes are not narrowed.

## Observations and their limits

The sanitized artifact records per-scenario typed result codes and incoming TCP
connection/HTTP request counts from the fixture servers. These are independent
of fetcher onDial callbacks. It stores no raw URLs, headers, private payloads,
credentials or approvals. It records the child network namespace so the integration
test can compare it with its parent namespace.

`private_targets_reached` means connections to the protected task-local loopback
fixture only. It does not assert visibility of every possible destination or
production/external traffic. Private, metadata, encoded IPv4, IPv6-loopback and
unsupported-scheme cases are calls to the real SafeFetcher; their pre-transport
rejections are distinguished from the allowed transport and redirect observations.
Separate `parser_rows` are direct URL-parser unit observations and cannot establish
transport containment.

`redirects_checked` requires a successful positive transport control, rejected
negative calls, no protected fixture connection, a received redirect response that
is rejected before the protected endpoint, and the actual redirect-limit error.
`resource_limits_enforced` is limited to declared wire length, chunked identity
body bytes, actual gzip decoded bytes, and per-instance request count, each with
the required typed error and fixture counters. It is not a claim about all resource
limits.

`chunked_wire` uses two dedicated owner fixture servers and a fresh SafeFetcher
per request. Each sends identity-encoded, chunked HTTP with no Content-Length.
Exactly 10 MiB must return the known bytes and SHA256; 10 MiB plus one byte must
return `RESOURCE_LIMIT`. Both sizes remain below the separate decoded-text and
aggregate caps. Incoming connections, requests, response closure and socket closure
are observed before forced fixture cleanup. These counts cover only those fixture
servers. The wire cap counts encoded body bytes, excluding HTTP framing; it does
not establish packet-level byte counts, wire DNS/TLS behavior or external egress.

Uncovered obligations remain explicit in every artifact: DNS wire/rebinding/CNAME
and mixed answers; deadlines, concurrency, gzip encoded-body and aggregate byte caps;
TLS/production networking; image/PDF and downstream parser limits; real rejection
handoff into research, JEV or creative; and authoritative external egress capture.
IE-11A.AC3 content-authority containment is a separate unchanged case. A passing
mock component execution leaves criterion status in progress and product acceptance
blocked. All unselected original cases remain planned, not implicitly passed.

## Regression and Linux evidence

The separately invoked `component_tests` suite uses actual `execute` and `save_run`
with clean owned snapshots and all 42 original cases. It compares a real baseline
with three deliberately weakened owned copies: an always-reject fetcher, unchecked
loopback fetching, and removal of only the identity-body streaming wire counter.
The positive control detects always-reject behavior; incoming protected server
counters detect unchecked loopback fetching. The wire-counter mutation must accept
the oversized body with its exact bytes/hash and fail the resource observation.
The Content-Length, gzip, decoded and aggregate guards remain intact in that copy.
Original producer checkouts stay unchanged.

```sh
sudo -n env IE_EVENT_SOURCE=/pinned/event-intelligence \
  IE_CONTRACT_SOURCE=/pinned/shared-contracts \
  IE_CONTRACT_RUNTIME=/reviewed/node-runtime.json \
  IE_COMPONENT_EVIDENCE=/approved/reports/retrieval-component \
  .venv/bin/python -m pytest component_tests \
  -o cache_dir=/isolated/component-cache --junitxml=/approved/reports/component-junit.xml
```

The workflow checks out the exact owner sources and runs this suite after canonical
runtime staging. Only revalidated sanitized archives are exported to the upload
directory. Raw owned source copies remain in pytest temporary storage. Non-Linux
invocation retains platform-blocked runs and fails the mandatory suite instead of
skipping it. Local macOS checks cannot establish this Linux boundary; actual Linux
CI artifacts are required before claiming it verified.
