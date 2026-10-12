#!/usr/bin/env bash
set -euo pipefail

repository="$(pwd -P)"
new_source="$(cd "$1" && pwd -P)"
old_source="$(cd "$2" && pwd -P)"
runtime_root="$3"
evidence="$4"
typescript="$5"
[[ "$runtime_root" = /* && "$evidence" = /* && "$typescript" = /* ]]
mkdir -p "$evidence" "$runtime_root"
test "$(node --version)" = v22.23.3
test "$(npm --version)" = 10.9.8
test "$(node "$typescript" --version)" = 'Version 5.9.3'
strict=(--strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax
  --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --skipLibCheck false
  --module NodeNext --moduleResolution NodeNext --target ES2022)

for lane in old new; do
  pin=contracts/producer-pin.json
  producer="$old_source"
  if [[ "$lane" = new ]]; then
    pin=contracts/producer-pin-v0101.json
    producer="$new_source"
  fi
  staging="$runtime_root/$lane-staging"
  runtime="$runtime_root/$lane-runtime"
  mkdir -p "$staging/contracts" "$evidence/$lane"
  cp "$pin" "$staging/contracts/producer-pin.json"
  (cd "$staging" && node "$repository/integration_tests/prepare-package.mjs" "$producer" "$runtime") > "$evidence/$lane/install.log" 2>&1
  cp integration_tests/installed-caller.mts integration_tests/installed-scenarios.mjs "$runtime/"
  node "$typescript" "${strict[@]}" "$runtime/installed-caller.mts" > "$evidence/$lane/caller-types.log" 2>&1
  printf 'PASS: strict installed caller types\n' >> "$evidence/$lane/caller-types.log"
  node "$runtime/installed-scenarios.mjs" > "$evidence/$lane/boundary-scenarios.json"
  for surface in source installed; do
    for scope in candidate full; do
      flags=()
      if [[ "$scope" = candidate ]]; then flags+=(--candidate-scope); fi
      .venv/bin/integration-evals contracts --pin "$pin" --producer "$producer" \
        --runtime "$runtime/$surface-runtime.json" --output "$evidence/$lane/$surface-$scope" \
        ${flags[@]+"${flags[@]}"} > "$evidence/$lane/$surface-$scope.log" 2>&1
    done
  done
done

cp candidate_tests/v0101/*.mts candidate_tests/v0101/installed-usage-scenarios.mjs "$runtime_root/new-runtime/"
node "$typescript" "${strict[@]}" --noEmit "$runtime_root/new-runtime/installed-usage-caller.mts" > "$evidence/new/usage-types.log" 2>&1
printf 'PASS: strict v1 callback and v2 namespace types\n' >> "$evidence/new/usage-types.log"
set +e
node "$typescript" "${strict[@]}" --noEmit "$runtime_root/new-runtime/legacy-v2-rejected.mts" > "$evidence/new/legacy-v2-rejected.log" 2>&1
legacy_status=$?
set -e
test "$legacy_status" -eq 2
grep -q TS2379 "$evidence/new/legacy-v2-rejected.log"
node "$runtime_root/new-runtime/installed-usage-scenarios.mjs" "$evidence/new/usage-scenarios.json" > "$evidence/new/usage-scenarios.log" 2>&1

IE_CONTRACT_SOURCE="$old_source" \
IE_CONTRACT_RUNTIME="$runtime_root/old-runtime/source-runtime.json" \
IE_CONTRACT_INSTALLED_RUNTIME="$runtime_root/old-runtime/installed-runtime.json" \
IE_CONTRACT_CALLER_ROOT="$runtime_root/old-runtime" \
IE_CONTRACT_TYPESCRIPT="$typescript" IE_CONTRACT_EVIDENCE="$evidence/old/negatives" \
  .venv/bin/python -m pytest integration_tests --junitxml="$evidence/old/junit.xml" > "$evidence/old/tests.log" 2>&1

IE_CONTRACT_SOURCE="$new_source" \
IE_CONTRACT_RUNTIME="$runtime_root/new-runtime/source-runtime.json" \
IE_CONTRACT_INSTALLED_RUNTIME="$runtime_root/new-runtime/installed-runtime.json" \
IE_CONTRACT_EVIDENCE="$evidence/new/receipts" \
  .venv/bin/python -m pytest candidate_tests/v0101/tests --import-mode=importlib \
  --junitxml="$evidence/new/junit.xml" > "$evidence/new/tests.log" 2>&1
node candidate_tests/v0101/compare-receipts.mjs "$evidence" > "$evidence/comparison.json"
IE_COMPARISON_EVIDENCE="$evidence" node --test candidate_tests/v0101/compare-receipts.test.mjs > "$evidence/comparison-tests.log" 2>&1
printf 'PASS: both exact pins, source/installed candidate/full receipts, boundary controls and candidate negatives\n'
