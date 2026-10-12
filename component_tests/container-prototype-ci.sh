#!/usr/bin/env bash
set -Eeuo pipefail
: "${IE_PRINT_SOURCE:?}" "${IE_PRINT_LIFETIME_EVIDENCE:?}"
test "${IE_PRINT_CONTAINER_PROTOTYPE:-}" = guarded-development
mkdir -p "$IE_PRINT_LIFETIME_EVIDENCE"
.venv/bin/python -c 'import os; from pathlib import Path; from integration_evals.print_setup import verify_source; print(verify_source(Path.cwd(), Path(os.environ["IE_PRINT_SOURCE"])).model_dump_json(indent=2))' > "$IE_PRINT_LIFETIME_EVIDENCE/source-pins.json"
image="$(.venv/bin/python -c 'from integration_evals.artifacts import load_record; from integration_evals.print_setup import PrintProfile, PROFILE_PATH; from pathlib import Path; print(load_record(Path(PROFILE_PATH), PrintProfile).image)')"
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" --cap-drop ALL \
  --security-opt no-new-privileges --security-opt apparmor=docker-default \
  -e HOME=/tmp -v "$IE_PRINT_SOURCE:/work" -w /work "$image" bash scripts/ci-install.sh
node="$IE_PRINT_SOURCE/out/toolchain/node-v24.21.0-linux-x64/bin/node"
PATH="$(dirname "$node"):$PATH" TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  npm --prefix "$IE_PRINT_SOURCE" run build
sudo -n env IE_PRINT_CONTAINER_PROTOTYPE=guarded-development \
  IE_PRINT_SOURCE="$IE_PRINT_SOURCE" IE_PRINT_LIFETIME_EVIDENCE="$IE_PRINT_LIFETIME_EVIDENCE" \
  .venv/bin/python -m pytest component_tests/test_container_prototype.py \
  -o cache_dir="$IE_PRINT_LIFETIME_EVIDENCE/pytest-cache" \
  --junitxml="$IE_PRINT_LIFETIME_EVIDENCE/lifetime-junit.xml"
