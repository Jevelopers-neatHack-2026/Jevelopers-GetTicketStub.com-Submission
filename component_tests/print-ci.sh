#!/usr/bin/env bash
# Host-side orchestration; actual owner execution remains integration_evals.runner.execute.
set -Eeuo pipefail
: "${IE_PRINT_SOURCE:?}" "${IE_CONTRACT_SOURCE:?}" "${IE_PRINT_EVIDENCE:?}"
: "${RUNNER_TEMP:?}" "${UV_PYTHON_INSTALL_DIR:?}"
repository="$PWD"
producer="$IE_PRINT_SOURCE"
node="$producer/out/toolchain/node-v24.21.0-linux-x64/bin/node"
mkdir -p "$IE_PRINT_EVIDENCE"
stage=profile
# Preserve fixed stage/exit facts without exporting commands, paths or private stderr.
trap 'failure_status=$?; printf "{\"stage\":\"%s\",\"exit_code\":%d,\"cause\":\"unclassified\"}\n" "$stage" "$failure_status" >> "$IE_PRINT_EVIDENCE/failures.jsonl"' ERR
# Read the exact reviewed image from the checked-in consumer source pin.
image="$(.venv/bin/python -c 'from integration_evals.artifacts import load_record; from integration_evals.print_setup import PrintProfile, PROFILE_PATH; from pathlib import Path; print(load_record(Path(PROFILE_PATH), PrintProfile).image)')"
mkdir -p "$IE_PRINT_EVIDENCE" "$RUNNER_TEMP/print-security" "$RUNNER_TEMP/print-tools"
stage=dependency-install
# Install build dependencies separately from the offline execution. No tokens enter Docker.
docker run --rm --platform linux/amd64 --user "$(id -u):$(id -g)" --cap-drop ALL --security-opt no-new-privileges --security-opt apparmor=docker-default -e HOME=/tmp -v "$producer:/work" -w /work "$image" bash scripts/ci-install.sh
stage=build
PATH="$(dirname "$node"):$PATH" TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 npm --prefix "$producer" run build
stage=isolation-tool-install
# Extract the Noble bwrap executable; do not install a privileged helper or alter host policy.
mkdir -p "$RUNNER_TEMP/print-tools/extracted/usr/bin"
docker run --rm --platform linux/amd64 --cap-drop ALL \
  --security-opt no-new-privileges --security-opt apparmor=docker-default \
  "$image" bash -euo pipefail -c '
    apt-get -o APT::Sandbox::User=root update >&2
    package_directory="$(mktemp -d)"
    cd "$package_directory"
    apt-get -o APT::Sandbox::User=root download bubblewrap >&2
    dpkg-deb -x ./*.deb extracted >&2
    cat extracted/usr/bin/bwrap
  ' > "$RUNNER_TEMP/print-tools/extracted/usr/bin/bwrap"
chmod 0755 "$RUNNER_TEMP/print-tools/extracted/usr/bin/bwrap"
stat -c 'uid=%u gid=%g mode=%a bytes=%s' \
  "$RUNNER_TEMP/print-tools/extracted/usr/bin/bwrap" \
  > "$IE_PRINT_EVIDENCE/bubblewrap-preparation.txt"
stage=runtime-receipts
.venv/bin/python -c 'import json,os; from pathlib import Path; p=Path(os.environ["RUNNER_TEMP"])/"print-security/host-namespaces.json"; p.write_text(json.dumps({k:os.readlink("/proc/self/ns/"+k) for k in ("ipc","net")}))'
.venv/bin/python -c 'import os; from pathlib import Path; from integration_evals.contract_records import ContractRuntime; from integration_evals.contracts import runtime_digest; p=Path(os.environ["IE_PRINT_SOURCE"])/"out/toolchain/node-v24.21.0-linux-x64/bin/node"; print(ContractRuntime(path=str(p),sha256=runtime_digest(p)).model_dump_json())' > "$IE_PRINT_EVIDENCE/node-runtime.json"
sha256sum "$RUNNER_TEMP/print-tools/extracted/usr/bin/bwrap" > "$IE_PRINT_EVIDENCE/bubblewrap.sha256"
policy="$producer/scripts/security/playwright-1.64.0.chromium-chroot.seccomp"
# The producer validator hashes and validates this exact reviewed policy, then inspects all controls.
stage=container-create
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
stage=container-inspection-before
inspect > "$IE_PRINT_EVIDENCE/container-before.json"
stage=container-workload
set +e
docker start --attach "$container" > "$IE_PRINT_EVIDENCE/component.log" 2>&1
status=$?
set -e
stage=container-inspection-after
inspect > "$IE_PRINT_EVIDENCE/container-after.json"
docker inspect --format '{{.State.ExitCode}}' "$container" > "$IE_PRINT_EVIDENCE/container-exit.txt"
stage=workload-exit
test "$status" -eq 0
test "$(cat "$IE_PRINT_EVIDENCE/container-exit.txt")" -eq 0
