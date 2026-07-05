#!/usr/bin/env bash
# Integration tests for usearch, Qdrant, and pgvector index backends.
# Starts ephemeral Docker services when URLs are not already provided.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
QDRANT_NAME=cberg-test-qdrant
PG_NAME=cberg-test-pgvector
STARTED_QDRANT=0
STARTED_PG=0

QDRANT_BIN="${CBERG_TEST_QDRANT_BIN:-}"
PG_READY_CMD="${CBERG_TEST_PG_READY_CMD:-}"

cleanup() {
  if [[ -n "${QDRANT_PID:-}" ]]; then
    kill "$QDRANT_PID" 2>/dev/null || true
    wait "$QDRANT_PID" 2>/dev/null || true
  fi
  if [[ "$STARTED_QDRANT" == 1 ]]; then
    docker rm -f "$QDRANT_NAME" >/dev/null 2>&1 || true
  fi
  if [[ "$STARTED_PG" == 1 ]]; then
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_http() {
  local url=$1
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "timeout waiting for $url" >&2
  return 1
}

wait_pg() {
  local i
  for i in $(seq 1 60); do
    if docker exec "$PG_NAME" pg_isready -U postgres -d codeberg >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "timeout waiting for postgres" >&2
  return 1
}

if [[ -z "${CBERG_TEST_QDRANT_URL:-}" ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker rm -f "$QDRANT_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$QDRANT_NAME" -p 6333:6333 qdrant/qdrant:latest >/dev/null
    STARTED_QDRANT=1
    export CBERG_TEST_QDRANT_URL=http://127.0.0.1:6333
    wait_http "$CBERG_TEST_QDRANT_URL/readyz"
  elif [[ -n "$QDRANT_BIN" && -x "$QDRANT_BIN" ]]; then
    "$QDRANT_BIN" --uri http://127.0.0.1:6333 >/tmp/cberg-qdrant.log 2>&1 &
    QDRANT_PID=$!
    export CBERG_TEST_QDRANT_URL=http://127.0.0.1:6333
    wait_http "$CBERG_TEST_QDRANT_URL/readyz"
  else
    echo "docker not available; set CBERG_TEST_QDRANT_URL or CBERG_TEST_QDRANT_BIN" >&2
  fi
fi

if [[ -z "${CBERG_TEST_POSTGRES_URL:-}" ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
    docker run -d --name "$PG_NAME" \
      -e POSTGRES_PASSWORD=test \
      -e POSTGRES_DB=codeberg \
      -p 5432:5432 \
      pgvector/pgvector:pg16 >/dev/null
    STARTED_PG=1
    wait_pg
    export CBERG_TEST_POSTGRES_URL=postgresql://postgres:test@127.0.0.1:5432/codeberg
  else
    echo "docker not available; set CBERG_TEST_POSTGRES_URL to test pgvector" >&2
  fi
fi

CC=gcc CXX=g++ make -C "$ROOT" build-core

BIN="$ROOT/core/build/test/test_index_providers"
if [[ ! -x "$BIN" ]]; then
  echo "missing test binary: $BIN" >&2
  exit 1
fi

echo "CBERG_TEST_QDRANT_URL=${CBERG_TEST_QDRANT_URL:-<unset>}"
echo "CBERG_TEST_POSTGRES_URL=${CBERG_TEST_POSTGRES_URL:-<unset>}"
"$BIN"
