#!/usr/bin/env bash
set -euo pipefail
mkdir -p out/toolchain
curl --fail --silent --show-error --location https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz --output out/toolchain/node.tar.gz
printf '%s  %s\n' 6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff out/toolchain/node.tar.gz | sha256sum --check --strict
tar -xzf out/toolchain/node.tar.gz -C out/toolchain
export PATH="$PWD/out/toolchain/node-v24.21.0-linux-x64/bin:$PATH"
npm ci
