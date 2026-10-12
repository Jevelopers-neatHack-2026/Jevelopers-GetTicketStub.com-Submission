# Canonical SDK 0.10.1 development opt-in

`contracts/producer-pin-v0101.json` permits an explicit development comparison against
shared-contracts source `becd640a801fe7829fe643bd96711d7a69bf58d0`, tree
`6ea11ab07dfb1aaf9a4fefd532e630f008a1a5d1`. The default pin remains 0.9.7 at
`d432ad5c895a67155affeaa05cd8423c758d95c3`.

Use the existing CLI with `--pin contracts/producer-pin-v0101.json`. The additive
`canonical-v0101.yml` workflow and local runner execute source and installed-package
checks for both candidate and full scope for both pins. Expected coverage is
76 names / 86 versions / 1,641 cases for 0.9.7 and 77 / 88 / 1,673 for 0.10.1.
The comparison also requires identical observations across execution surfaces and
preserves all nine historical-finance rows with `operational_authority=false`.

From the repository root, after `uv sync --frozen`, with Node 22.23.3 and npm 10.9.8
on `PATH` and a TypeScript 5.9.3 installation:

```bash
bash candidate_tests/v0101/run.sh \
  /absolute/path/to/becd640-source /absolute/path/to/d432ad5-source \
  /absolute/path/to/fresh-runtime-directory /absolute/path/to/fresh-evidence-directory \
  /absolute/path/to/typescript/bin/tsc
```

Use fresh runtime and evidence directories for each attempt; failed attempts are
retained. Linux execution requires the same bubblewrap containment and privileged
test invocation as the existing verification workflow. macOS uses the existing
seatbelt containment. The runner stages each selected pin as
`contracts/producer-pin.json` in its own temporary working directory and invokes
the unchanged preparation script by absolute path. Both archives must reproduce
their exact hashes before offline installation with lifecycle scripts disabled.
No tracked pin is swapped. Candidate tests are collected explicitly, outside the
default unit and old integration suites. Their scoped Ruff configuration uses the
same test exemptions as the existing repository tests; production rules are inherited.

The new catalog profiles `immutable_v1_behavior` and
`provider_reported_unsettled_candidate` accept no historical-finance labels.
Unknown profiles and malformed catalogs produce a sanitized `execution=error`
receipt with no observation, no process exit code, and
`missing_contracts=["canonical-catalog-unavailable"]`. This marker means scope could
not be determined; it is not a contract name or evidence of zero missing coverage.
Pin/archive drift remains rejected before execution by the existing guards.

The installed tests exercise the explicit usage-reported-unsettled namespace,
known zero versus unknown/null, exact 18-digit money, identity, aggregate evidence,
corrections, and late observations. Strict TypeScript checks preserve the v1
metering callback and require an unsuppressed v2 call to fail compilation. Existing
production-boundary scenarios and package/version tamper controls also run.

All receipts remain `mock-only`, synthetic, with `product_acceptance=blocked` and
`owner_acknowledgement=null`. These checks authenticate local byte identities and
pure SDK behavior. They do not establish genuine provider authentication, billable
ID issuance, Finance decoding/adoption/settlement, host grants, live calls, or
release acceptance. Integration and a future default repin require the existing
owner lane, exact-head independent review, and hosted CI.
