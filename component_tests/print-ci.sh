#!/usr/bin/env bash
# Host-side orchestration; actual owner execution remains integration_evals.runner.execute.
set -euo pipefail
: "${IE_PRINT_SOURCE:?}" "${IE_CONTRACT_SOURCE:?}" "${IE_PRINT_EVIDENCE:?}"
: "${RUNNER_TEMP:?}" "${UV_PYTHON_INSTALL_DIR:?}"
repository="$PWD"
producer="$IE_PRINT_SOURCE"
node="$producer/out/toolchain/node-v24.21.0-linux-x64/bin/node"
# Read the exact reviewed image from the checked-in consumer source pin.
image="$(.venv/bin/python -c 'from integration_evals.artifacts import load_record; from integration_evals.print_setup import PrintProfile, PROFILE_PATH; from pathlib import Path; print(load_record(Path(PROFILE_PATH), PrintProfile).image)')"
mkdir -p "$IE_PRINT_EVIDENCE" "$RUNNER_TEMP/print-security" "$RUNNER_TEMP/print-tools"
# Install build dependencies separately from the offline execution. No tokens enter Docker.
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=docker-default -e HOME=/tmp -v "$producer:/work" -w /work "$image" bash scripts/ci-install.sh
PATH="$(dirname "$node"):$PATH" TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm --prefix "$producer" run build
# Extract the Noble bwrap executable; do not install a privileged helper or alter host policy.
docker run --rm --platform linux/amd64 --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=docker-default -v "$RUNNER_TEMP/print-tools:/tools" "$image" bash -c 'apt-get -o APT::Sandbox::User=root update >/dev/null && cd /tools && apt-get -o APT::Sandbox::User=root download bubblewrap && dpkg-deb -x ./*.deb extracted'
.venv/bin/python -c 'import json,os; from pathlib import Path; p=Path(os.environ["RUNNER_TEMP"])/"print-security/host-namespaces.json"; p.write_text(json.dumps({k:os.readlink("/proc/self/ns/"+k) for k in ("ipc","net")}))'
.venv/bin/python -c 'import os; from pathlib import Path; from integration_evals.contract_records import ContractRuntime; from integration_evals.contracts import runtime_digest; p=Path(os.environ["IE_PRINT_SOURCE"])/"out/toolchain/node-v24.21.0-linux-x64/bin/node"; print(ContractRuntime(path=str(p),sha256=runtime_digest(p)).model_dump_json())' > "$IE_PRINT_EVIDENCE/node-runtime.json"
sha256sum "$RUNNER_TEMP/print-tools/extracted/usr/bin/bwrap" > "$IE_PRINT_EVIDENCE/bubblewrap.sha256"
policy="$producer/scripts/security/playwright-1.64.0.chromium-chroot.seccomp"
# The producer validator hashes and validates this exact reviewed policy, then inspects all controls.
container="$(docker create --platform linux/amd64 --init \
  --user "$(id -u):$(id -g)" --network none --ipc private --shm-size 1g \
  --cap-drop ALL --security-opt no-new-privileges \
  --security-opt apparmor=docker-default --security-opt "seccomp=$policy" \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=2g,mode=1777 \
  --mount "type=bind,source=$repository,target=$repository,readonly" \
  --mount "type=bind,source=$producer,target=$producer,readonly" \
  --mount "type=bind,source=$IE_CONTRACT_SOURCE,target=$IE_CONTRACT_SOURCE,readonly" \
  --mount "type=bind,source=$UV_PYTHON_INSTALL_DIR,target=$UV_PYTHON_INSTALL_DIR,readonly" \
  --mount "type=bind,source=$RUNNER_TEMP/print-tools,target=$RUNNER_TEMP/print-tools,readonly" \
  --mount "type=bind,source=$IE_PRINT_EVIDENCE,target=$IE_PRINT_EVIDENCE" \
  --mount "type=bind,source=$RUNNER_TEMP/print-security,target=/run/pp-security,readonly" \
  --env HOME=/tmp \
  --env "PATH=$(dirname "$node"):$RUNNER_TEMP/print-tools/extracted/usr/bin:/usr/bin:/bin" \
  --env "IE_PRINT_SOURCE=$producer" --env "IE_CONTRACT_SOURCE=$IE_CONTRACT_SOURCE" \
  --env "IE_PRINT_RUNTIME=$IE_PRINT_EVIDENCE/node-runtime.json" \
  --env IE_PRINT_BROWSER_ROOT=/ms-playwright --env "IE_PRINT_EVIDENCE=$IE_PRINT_EVIDENCE" \
  --workdir "$repository" "$image" "$repository/.venv/bin/python" \
  -m pytest component_tests/test_print.py -o cache_dir=/tmp/print-cache \
  --junitxml="$IE_PRINT_EVIDENCE/component-junit.xml")"
trap 'docker rm --force "$container" >/dev/null' EXIT
inspect() {
  docker inspect "$container" | .venv/bin/python -c 'import json,sys,os; print(json.dumps({"inspection":json.load(sys.stdin)[0],"user":str(os.getuid())+":"+str(os.getgid())}))' | "$node" "$producer/scripts/security/run-offline.mjs" --check-inspection
}
inspect > "$IE_PRINT_EVIDENCE/container-before.json"
set +e
docker start --attach "$container" > "$IE_PRINT_EVIDENCE/component.log" 2>&1
status=$?
set -e
inspect > "$IE_PRINT_EVIDENCE/container-after.json"
docker inspect --format '{{.State.ExitCode}}' "$container" > "$IE_PRINT_EVIDENCE/container-exit.txt"
test "$status" -eq 0
test "$(cat "$IE_PRINT_EVIDENCE/container-exit.txt")" -eq 0
