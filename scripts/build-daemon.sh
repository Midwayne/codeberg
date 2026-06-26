#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_BUILD="${ROOT}/core/build"
OUT="${CORE_BUILD}/bin"
mkdir -p "${OUT}"

if [[ ! -f "${CORE_BUILD}/bin/cberg-index" ]]; then
  make -C "${ROOT}" build-core
fi

cd "${ROOT}/daemon"
CGO_ENABLED=0 go build -o "${OUT}/codeberg-d" ./cmd/codeberg-d
echo "built ${OUT}/codeberg-d (pure Go; cberg-index from CMake)"
