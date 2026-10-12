# GT-10B assembly-evidence manifest (snapshot tooling)

`scripts/assembly-evidence.mjs` writes an offline **snapshot** of what this checkout actually contains. It is
tooling for GT-10B.1/GT-10B.6 inputs. It is **not** an executed build, integration run, journey result, release
certification, or acceptance of any criterion. It makes no network or provider calls and reads no `.env` or data files.

```sh
node scripts/assembly-evidence.mjs build  [--out <file>] [--allow-dirty]
node scripts/assembly-evidence.mjs verify [<manifest>] [--allow-dirty]
```

Default output is `out/assembly-evidence/manifest.json` (git-ignored). `--out` accepts an explicit path outside the
repo, or inside it only if git ignores it and it is not tracked, so the app SHA is never committed into the app
(no recursive self-pin). There is deliberately no `package.json` script entry; run the file directly.

## What is recorded (all from actual files)

| Field | Source |
| --- | --- |
| `app` | `git rev-parse HEAD`, branch, dirty paths (names only) |
| `lockfile` | SHA-256 of `package-lock.json` |
| `toolchain.declared` / `.runtime` | `package.json` engines and `packageManager` vs the running Node and `npm --version`, kept separate |
| `vendored` | each `src/server/vendor/*/MANIFEST.json`: repository, commit, per-file SHA-256 (build fails if a file drifts from its MANIFEST) |
| `components.required` | dependencies of the composition root in `integration/repository-map.json`: `installed-vendored` only if a vendored module exists, otherwise `pending` with no commit or hash |
| `fixtures` | git-tracked files under `fixtures/approval`, `fixtures/context`, `fixtures/order-authorization` with SHA-256 and a per-suite digest |
| `executed` | always `[]`; this tool records no command results |
| `acceptance` | always `not_accepted` |

`integration/repository-map.json` is hashed only as planning inventory; it never counts as a pin. Specialist, schema,
brand, landing and dashboard components absent from the checkout remain `pending` (GT-10B.1 is unmet until they have
real revisions).

## Dirty-tree policy

`build` refuses a dirty tree (untracked files included). `--allow-dirty` records `dirty: true`,
`reproducible: false` and the dirty path names; `verify` rejects such manifests unless `--allow-dirty` is passed.

## Safety

Vendored and fixture paths must be plain relative paths with no `..`, backslash, absolute or NUL; every path component
is checked for symlinks and the file must be regular. Fixtures are enumerated with `git ls-files` under a fixed
allowlist, so untracked or ignored files are never hashed.

## Verify

`verify` fails on: a tampered manifest (digest), a non-`not_accepted` status, executed results, a wrong mode label,
a pending component carrying a pin, an unknown status, a different HEAD, lockfile/vendor/fixture drift, and
added/removed fixtures. A pass means "consistent with this checkout", nothing more.

Tests: `node --test tests/assembly-evidence.test.mjs` (synthetic temp git repos plus one check against this checkout).
