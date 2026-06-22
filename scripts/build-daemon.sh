#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_BUILD="${ROOT}/core/build"
OUT="${CORE_BUILD}/bin"
mkdir -p "${OUT}"

if [[ ! -f "${CORE_BUILD}/libcodeberg.a" ]]; then
  make -C "${ROOT}" build
fi

export CGO_CFLAGS="-I${ROOT}/core/include"
export CGO_LDFLAGS="-L${CORE_BUILD} -lcodeberg -lpthread -lm -Wl,-rpath,${CORE_BUILD}"

if [[ "$(uname)" == "Darwin" ]]; then
  export CGO_LDFLAGS="${CGO_LDFLAGS} -lc++ -framework CoreServices"
  if [[ -d /opt/homebrew/opt/onnxruntime/lib ]]; then
    export CGO_LDFLAGS="${CGO_LDFLAGS} -L/opt/homebrew/opt/onnxruntime/lib -lonnxruntime -Wl,-rpath,/opt/homebrew/opt/onnxruntime/lib"
  fi
else
  export CGO_LDFLAGS="${CGO_LDFLAGS} -lstdc++"
  for d in /usr/local /usr /opt/onnxruntime; do
    if [[ -f "${d}/lib/libonnxruntime.so" ]]; then
      export CGO_LDFLAGS="${CGO_LDFLAGS} -L${d}/lib -lonnxruntime -Wl,-rpath,${d}/lib"
      break
    fi
  done
fi

cd "${ROOT}/daemon"
go build -o "${OUT}/cberg-index" ./cmd/cberg-index
go build -o "${OUT}/codeberg-d" ./cmd/codeberg-d
echo "built ${OUT}/cberg-index ${OUT}/codeberg-d"
