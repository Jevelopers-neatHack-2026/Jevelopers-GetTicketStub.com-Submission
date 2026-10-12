# Local reusable-workflow fixture

This fixture contains synthetic Markdown only. Its nested workflow file is a byte-for-byte copy of the illustrative reusable source. It is not installed as a root workflow and has no GitHub run evidence.

From the repository root (Python 3.10 or newer and Node on `PATH`), create an isolated virtual environment and install the pinned test dependencies once. Dependency installation may download packages; it is setup, not an offline check.

```sh
CHECKS_VENV="$(mktemp -d)"
python3 -m venv "$CHECKS_VENV"
"$CHECKS_VENV/bin/python" -m pip install -r automation-design/tests/requirements.txt
```

Then run the offline suite in the same shell:

```sh
"$CHECKS_VENV/bin/python" -m unittest discover -s automation-design/tests -v
```

The tests read the actual workflow YAML, extract the Node here-document from the called job, and execute it using the same scope environment variable and GITHUB_OUTPUT protocol. The reusable source, fixture copy, and workflow starter must contain the same checker. Tests cover successful docs and repository scopes, output values, missing links, traversal attempts, inside-checkout docs symlinks, outside-checkout docs symlinks, invalid scope, fork-safe trigger policy, and forbidden secrets/write permissions.

Passing these local tests validates only the checker and source-policy shape in this checkout. GitHub workflow resolution, host/caller visibility, Actions settings, platform token behavior, fork/secret isolation, logs, required checks, and any real run remain unverified.
