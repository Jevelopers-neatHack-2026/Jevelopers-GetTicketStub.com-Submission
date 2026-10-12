#!/usr/bin/env bash
# Experimental host evaluator; default invocation/legacy Bubblewrap remains unchanged.
set -Eeuo pipefail
: "${IE_PRINT_SOURCE:?}" "${IE_CONTRACT_SOURCE:?}" "${IE_PRINT_EVIDENCE:?}" "${IE_PRINT_LIFETIME_EVIDENCE:?}"
test "${IE_PRINT_CONTAINER_PROTOTYPE:-}" = guarded-development
# Genuinely rerun all nine original lifetime/death/daemon/tamper cases.
bash component_tests/container-prototype-ci.sh
mkdir -p "$IE_PRINT_EVIDENCE"
.venv/bin/python -c 'import os; from pathlib import Path; from integration_evals.contract_records import ContractRuntime; from integration_evals.contracts import runtime_digest; p=Path(os.environ["IE_PRINT_SOURCE"])/"out/toolchain/node-v24.21.0-linux-x64/bin/node"; print(ContractRuntime(path=str(p),sha256=runtime_digest(p)).model_dump_json())' > "$IE_PRINT_EVIDENCE/node-runtime.json"
sudo -n env IE_PRINT_CONTAINER_PROTOTYPE=guarded-development \
  IE_PRINT_SOURCE="$IE_PRINT_SOURCE" IE_CONTRACT_SOURCE="$IE_CONTRACT_SOURCE" \
  IE_PRINT_RUNTIME="$IE_PRINT_EVIDENCE/node-runtime.json" IE_PRINT_EVIDENCE="$IE_PRINT_EVIDENCE" \
  IE_PRINT_LIFETIME_EVIDENCE="$IE_PRINT_LIFETIME_EVIDENCE" \
  .venv/bin/python -m pytest component_tests/test_guarded_print.py \
  -o cache_dir="$IE_PRINT_EVIDENCE/pytest-cache" \
  --junitxml="$IE_PRINT_EVIDENCE/guarded-print-junit.xml"
