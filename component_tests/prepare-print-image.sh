#!/usr/bin/env bash
# Setup-only bounded retries. The image/profile is unchanged; no owner tests run here.
set -Eeuo pipefail
: "${IE_PRINT_LIFETIME_EVIDENCE:?}"
mkdir -p "$IE_PRINT_LIFETIME_EVIDENCE/image-preparation"
image="$(.venv/bin/python -c 'from integration_evals.artifacts import load_record; from integration_evals.print_setup import PrintProfile, PROFILE_PATH; from pathlib import Path; print(load_record(Path(PROFILE_PATH), PrintProfile).image)')"
for attempt in 1 2 3; do
  if timeout --signal=TERM --kill-after=5s 180s docker pull --platform linux/amd64 "$image" > "$IE_PRINT_LIFETIME_EVIDENCE/image-preparation/pull-$attempt.log" 2>&1; then
    docker image inspect "$image" --format '{{json .RepoDigests}}' > "$IE_PRINT_LIFETIME_EVIDENCE/image-preparation/repo-digests.json"
    .venv/bin/python - "$image" "$IE_PRINT_LIFETIME_EVIDENCE/image-preparation/repo-digests.json" <<'PYTHON'
import json
import sys
from pathlib import Path

repository, digest = sys.argv[1].split("@")
expected = repository.rsplit(":", 1)[0] + "@" + digest
if expected not in json.loads(Path(sys.argv[2]).read_bytes()):
    raise SystemExit("Pulled image does not bind the exact approved repository digest")
PYTHON
    exit 0
  else
    status=$?
    printf '%s\n' "$status" > "$IE_PRINT_LIFETIME_EVIDENCE/image-preparation/pull-$attempt.exit"
  fi
done
echo 'Exact-digest image preparation failed within three bounded attempts' >&2
exit 1
