# Evaluator evidence index and local reviews

Owning criteria: IE-09A.AC1–AC5, IE-08.AC1–AC5, IE-09B.AC1/AC3 and the
offline evidence portion of IE-07.AC1/AC2/AC5. This is evaluator packaging;
producer adapters, actual sponsor use and product acceptance remain owner work.

`integration-evals run` and `replay-evaluation` write `evidence-index.json` with
their immutable JSON/JUnit/coverage/history/register receipts. Normal release
audit exports consume this index and retain missing artifact reviews and GPT
Image qualifications as blockers. Existing Run/Evidence schemas retain their
meanings; no original fixture, frozen scenario or acceptance state is updated.

The index joins all 47 master criteria and 99 frozen issue leaves (146 rows, 142
in-scope after the four original P1/Production exclusions) to implementation
issues/dependencies, every case attempt, original source run, fingerprints and
artifact metadata/hash. Full run receipts retain exact integration/component
SHAs, manifest, provider/model/config, timestamps, duration, unknown costs and
limitations. Missing cases/artifacts remain explicit blockers. Canonical state
is independent: the three historical sponsor verifications and 44 planned states
are preserved. Mocked artifacts stay mocked, and comparison replay retains its
`recorded-evaluation-replay` execution kind and original source identity.

`case_history` reuses the existing measured history/quarantine register. Its
denominator comes from every retained receipt with unchanged input fingerprints.
Handwritten flake counts, different-input passes, fixed bugs and dependency
blockers cannot manufacture a current flake. Failures and mandatory quarantines
remain blocked. For actual flakes, retain real original/authorized diagnostic
receipts using the [history procedure](execution-protocol.md); source authenticity
still requires owner review. The synthetic sample below is not a product flake.

## Packaging command and schemas

From this repository after `uv sync --frozen`:

```sh
uv run integration-evals evidence-index reports/runs/<original-or-latest-run-id> \
  --suite scenarios/suite.json \
  --reviews /approved/safe-derivatives/reviews.json \
  --output reports/runs/reviewed-index.json
```

Omit `--reviews` for a missing-attestation blocker register. The command follows
complete retained history, even from the original archive, and rechecks ancestor
receipt equality, original bytes, hashes and leakage. It executes no archive
command, provider call or remote fetch and reads no credentials. Output is
exclusive: use a new filename per review. Exit 1 rejects malformed/stale/missing/
tampered/unsafe inputs before export; exit 2 writes an index with in-scope blockers.
The printed SHA256 identifies the exact exported bytes.

[EvidenceIndex](../schemas/EvidenceIndex.schema.json) and
[Reviews](../schemas/Reviews.schema.json) are versioned `1.0` evaluator-owned
schemas, with no product/domain schema authority. Regenerate with
`uv run integration-evals schemas schemas`; existing schemas are unchanged.

## Local permission, redaction and access attestations

Each `Reviews.evidence` row binds original run/evidence IDs, artifact hash,
mode/origin, producer revision and original timestamps. It records reviewer and
intended reviewer IDs, check time, expiry and limitations. Permission, redaction
and access each contain a `reference` matching the original Evidence label, a
confined relative `path` and `sha256`. These sanitized review derivatives must
be readable regular local files. Stale/future checks, source relabels, missing
files, orphan/duplicate reviews, wrong hashes, leaks and signed URLs are rejected.

The serialized scope is explicitly `local-attestation`. Reading a file does not
authenticate the named owner, establish legal rights, test another reviewer's
account or grant budget/dispatch authority. Valid local attestations therefore
retain `producer-authenticity-and-permission-authority-unverified`; absent
original provider receipts for claimed real images remain blocked too. An owner
response's live origin is a claim, not authenticated provider proof. Trusted owner
grants, actual producer receipts and reviewer account access are external
prerequisites, not manufactured by this command.

Keep restricted originals in approved private storage under owner retention/access
policy. Package only safe reviewed derivatives; references must not disclose
private original locations or signed URLs. Existing IE-11B leakage checks apply
to sidecars, review derivatives, metadata and artifacts before export, alongside
manual content/metadata review. Neatlogs traces, Entire checkpoints, JEV decision
receipts and CFO.ai forecasts remain distinct Evidence kinds from actual pinned
producers. The index cannot supply missing sponsor use, comparable improvement,
FinancialSummary or an actual CFO.ai plan. Finance/marketing handoff and
publication remain owner work; a generic editable forecast is not an actual plan.

## GPT Image qualification

`Reviews.images` binds the creative-engine image's original run/evidence/hash to
recorded GPT Image model/endpoint/provider, configuration digest, request time,
generate/edit operation, DesignVersion and edit parent, input digests and a
hash-checked input-permission derivative. Usage is `unknown` without invented
usage data or `reported` with a sanitized hash-checked record. A provider receipt
may be absent only with an explicit reason; real-source absence stays blocked.
No fictional provider IDs or usage amounts are required.

The validator checks actual PNG signature/IHDR dimensions, producer/model/config
joins, permission bytes, usage labels, self-parent errors and uncertainty. PNG is
currently the only qualified media type. This is a header/property check, not a
full decode, creative quality rubric or provider authenticity check. Other formats
need their corresponding evaluator media checks. Sandbox requires an explicit
owner capability declaration (default: no sandbox); this local declaration cannot
authenticate provider capabilities or authorize dispatch.

IE-07.AC5 also requires a generation plus edit with the exact generation
DesignVersion as parent. Missing qualification/chain blocks index and release
audit coverage. Mock examples never become live proof. Actual approved handoff,
quality, failure/moderation/timeout/late-output behavior and credential/budget
preflight remain external producer work.

## Reproducible offline sample and verification

The focused test retains synthetic generation/edit PNGs, immutable archive,
sidecar, review derivative and index. The sample's local attestation uses current
time and expires after one day; original synthetic source dates stay unchanged.

```sh
mkdir -p reports/runs
uv run pytest tests/test_evidence_index.py::test_qualified_mock_generation_edit_remains_only_mocked \
  --basetemp reports/runs/evidence-index-sample -q
uv run integration-evals evidence-index \
  reports/runs/evidence-index-sample/test_qualified_mock_generation0/reports/synthetic-original \
  --suite reports/runs/evidence-index-sample/test_qualified_mock_generation0/reports/synthetic-original/suite.json \
  --reviews reports/runs/evidence-index-sample/test_qualified_mock_generation0/reviews.json \
  --output reports/runs/evidence-index-sample/local-reviewed-index.json
```

Packaging exits 2: the successful mock retains planned criteria, authority/
authenticity blockers and absent sponsor/product boundaries. Pytest removes this
specified sample basetemp when regenerating it; choose another temporary directory
if earlier sample outputs need preserving.

```sh
uv run pytest tests/test_evidence_index.py tests/test_evidence_index_execution.py tests/test_reporting.py tests/test_history_archive.py tests/test_release.py -q
uv run pytest -q
uv run basedpyright
uv run ruff check
uv run ruff format --check
```

Tests exercise source-label/hash tampering, stale/inaccessible/leaking reviews,
orphan references, fingerprint drift, missing GPT qualification and model/config/
media/usage/receipt/parent errors, release blockers and changed ancestors before
export. Actual contained synthetic execution plus pure comparison replay proves
source joins without inventing an infrastructure flake. These tests verify
evaluator rules only; integrated acceptance requires authentic owner evidence.

`tests/test_evidence_index_execution.py` executes the real contained synthetic
owner and comparison replay. Linux CI always runs this module in the existing
privileged Bubblewrap job and keeps its JUnit receipt, alongside the other real
owner/isolation tests. The ordinary unprivileged job runs the metadata/integrity
unit tests; it excludes this module because namespace privileges are required.
No test is skipped or converted to a fabricated owner receipt. The original
unprivileged PR51 CI failure remains preserved; fresh Linux execution is required
to validate this routing change. Local macOS tests cannot replace that Linux result.
