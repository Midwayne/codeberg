#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "${ROOT}/core/build/bin/cberg-index" ]]; then
  make -C "${ROOT}" build
fi

cd "${ROOT}/daemon"
CGO_ENABLED=0 go test ./...
