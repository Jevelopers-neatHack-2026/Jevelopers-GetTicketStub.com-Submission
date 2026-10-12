# App recovery component DEVELOPMENT

This additive command qualifier runs `npm run verify:creative-host` at app commit
`b46ab0487e15a928d524e6ce14b684941cfd2076` unchanged, on a disposable GitHub-hosted
Linux runner. It requires Node 22.23.3, npm 11.16.0, the pinned PostgreSQL image,
a clean exact owner checkout and a nonexistent absolute output directory:

```sh
node app_recovery_component_tests/run.mjs /absolute/owner-checkout /absolute/new-output
```

The workflow installs npm and pulls the image before execution. The driver uses a
fresh private HOME, cache and TMPDIR, an explicit PATH, and no inherited provider,
Finance or authority configuration. `npm ci` is a separately recorded bootstrap
phase; the full owner command then runs without test filters or evaluator hooks.
Source revision/tree, Git archive, all tracked bytes, lock/vendor archives,
executable bytes and all installed files are captured and checked. Source and
installed bytes are checked again after the command. No existing formal runner,
suite, scenario, acceptance or producer pin is changed.

The mode is `synthetic-owner-fixtures`: the owner fixtures intercept provider
transport and seed external authority. Internal live-shaped labels confer no
paid permission. `paid_execution_enabled` and `adoption_accepted` stay false.
Fixed seed and clock are unsupported. This does not certify OS egress isolation.

The receipt requires five exact TAP identities, all passing with no skip, todo,
failure or cancellation, plus the SQL fixture diagnostic. Output is byte-bounded
and execution has a 180-second limit; timeout/overflow terminates the process
group with a bounded TERM/KILL escalation. Only allowlisted TAP lines are
published. Unstructured stdout/stderr are represented by hashes and byte counts,
not uploaded diagnostics that could contain fixture credentials.

After owner exit, read-only SQLite queries project only the attempts table from
the two named databases under the private TMPDIR. IDs, observations, requests,
commands and receipts are hashed; hold reasons, observation counts/uniqueness,
replay revision and retry/pending statuses are captured. The four-observation
concurrency row and two-observation replay row must retain their specified holds.
The known synthetic concurrency request bytes are checked directly. Other
before/after byte-preservation claims remain owner assertions: a retained final
snapshot cannot independently establish the initial bytes.

PostgreSQL evidence has `observation_basis: owner_assertion`. Independent SQL rows,
balances, roles, migrations, server identity, postings and role cleanup are
`unavailable`, because the owner deletes its database container. No scalar SQL
counts are invented from TAP. This receipt is neither OwnerResponse nor Assembly,
and does not accept positive paid execution, publication or the whole application.

Before execution, the driver requires the GitHub-hosted disposable-runner markers
and an empty local Docker inventory. The workflow is the trust boundary for those
markers; they are not remote attestation. A bounded read-only event subscription
starts before the owner, with an explicit `--since` boundary. A final bounded
history query covers the subscription startup race. Only new IDs matching the
owner's exact name format and pinned image are eligible for recovery deletion;
they are re-inspected immediately before deletion. Any unknown container,
observer failure, uncertain process termination or failed final absence check
fails qualification. Zero captured containers cannot pass. Normal completion
records create/start/destroy events. Failure cleanup can remove captured owned
IDs and preserves a failed receipt. Unconfirmed cleanup quarantines private files
on the disposable runner, outside the upload allowlist. No prune operation exists.

Artifacts include `receipt.json`, source/evaluator/installed custody, runtime,
bootstrap, command, sanitized TAP, stderr metadata, SQLite projections, lifecycle,
cleanup and SHA256 manifest. The upload step always preserves sanitized failures;
it never uploads raw SQLite, registry, credentials, private HOME/cache or source.

Local controls (no Docker or product execution):

```sh
node --test app_recovery_component_tests/receipt.test.mjs
```

Set `APP_RECOVERY_TEST_EVIDENCE` to retain explicitly synthetic control receipts;
set `APP_RECOVERY_PIN_SOURCE` to an exact owner checkout to test full source custody.
Controls cover false/missing TAP, pin drift, missing SQLite, projected invariants,
unknown/changed resource ownership, invented independent SQL claims and inert
child timeout/overflow. The actual five-test component qualification must still
run in the dedicated workflow; local controls are not a substitute for it.
