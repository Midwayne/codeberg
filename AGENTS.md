# Agent Guidelines for Codeberg

Codeberg indexes source trees into semantic chunks, tracks changes incrementally,
embeds vectors, and exposes search via a Go daemon and TypeScript agent.

## Repository layout

| Path | Role |
|------|------|
| `core/` | C library — chunking, watching, embedding, vector search |
| `daemon/` | Go `codeberg-d` — HTTP API, agent tools, supervises `cberg-index` |
| `agent/` | TypeScript agent (`codeberg-ask`, `codeberg-tui`) over the daemon API |

The public C ABI is in `core/include/codeberg/codeberg.h`. Never hardcode repository
paths — use `CODEBERG_ROOT` or `cberg_config_*` helpers.

## Common commands

| Command | Purpose |
|---------|---------|
| `make submodules` | Initialize git submodules (required before first build) |
| `make build` | Configure and compile `libcodeberg` + `cberg-index` |
| `make test` | Run all core tests (`ctest`) |
| `make test TEST=<name>` | Run one test binary (e.g. `test_chunker`) |
| `make check` | `build` + `test` — pre-PR gate (same as CI) |
| `make build-daemon` | Build Go `codeberg-d` (requires `cberg-index`) |
| `make daemon-test` | `go test ./...` in `daemon/` |
| `make build-agent` | `npm install` + build in `agent/` |
| `make agent-test` | Vitest in `agent/` |

CI (`.github/workflows/ci.yml`) runs `make submodules`, `make build`, and `make test`
on Ubuntu with CMake and Ninja. Match that for verification unless the task needs
daemon or agent coverage.

## Coding standards

- **Test-driven workflow.** Write a failing test for the behavior, implement, refactor.
- **C core:** keep `codeberg.h` stable; document memory ownership; use exhaustive
  `switch` with a `default:` `never` check for discriminated unions and enums.
- **Imports:** `#include` at the top of C files; TypeScript imports at module top.
- **Secrets:** never commit API keys, tokens, or model credentials.

## Cursor Cloud specific instructions

Cloud agents boot from `.cursor/environment.json`. The install hook runs
`make submodules`, `make build`, `make build-daemon`, and `make build-agent`.

### Environment variables

Set these when running the daemon or agent (use the repo root as `CODEBERG_ROOT`):

```bash
export CODEBERG_ROOT="$(git rev-parse --show-toplevel)"
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `CODEBERG_ROOT` | For daemon/agent runs | Repository tree to index |
| `CBERG_MODEL` | For vector search | Path to ONNX embedding model |
| `CBERG_INDEX_PATH` | For vector search | usearch index file path |
| `CODEBERG_HTTP_PORT` | No | Daemon HTTP port (default `8080`) |
| `CODEBERG_MODEL` (agent) | For `make run-agent` | Provider:model, e.g. `anthropic:claude-haiku-4-5` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | For agent LLM calls | Matching provider API key |

Add LLM API keys in the [Cursor Cloud Agents secrets dashboard](https://cursor.com/dashboard/cloud-agents)
— do not commit them to the repo.

### Verification by layer

**C core (default):**

```bash
make check
```

**Go daemon:**

```bash
make daemon-test
```

**TypeScript agent:**

```bash
make agent-test
```

**End-to-end agent (optional — needs LLM API key in secrets):**

```bash
export CODEBERG_ROOT="$(git rev-parse --show-toplevel)"
# Terminal 1: daemon (chunk-only mode works without ONNX)
make run-daemon

# Terminal 2: one-shot question (set CODEBERG_MODEL + API key via secrets or env)
make run-agent q="where is chunking implemented?"
```

### Embedding / ONNX (optional)

Core tests and the daemon work without ONNX (chunk-only mode). To enable local
embedding and vector search you need **two things**: the ONNX Runtime C library
and the **jina-embeddings-v2-base-code** model.

**1. Install ONNX Runtime (Linux cloud VM)**

There is no apt package; download a release tarball and unpack under `/opt`:

```bash
ORT_VERSION=1.20.1
sudo mkdir -p /opt/onnxruntime
curl -fSL "https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-x64-${ORT_VERSION}.tgz" \
  | sudo tar -xz -C /opt/onnxruntime --strip-components=1
export LD_LIBRARY_PATH="/opt/onnxruntime/lib:${LD_LIBRARY_PATH:-}"
```

CMake looks for headers/libs via `-DONNXRUNTIME_ROOT=/opt/onnxruntime` (not the
shell env var alone).

**2. Download the embedding model (~160 MB int8 quantized)**

```bash
scripts/fetch-model.sh
# => models/jina-embeddings-v2-base-code/model.onnx + tokenizer files
```

**3. Rebuild the C core with ONNX enabled**

```bash
CC=gcc CXX=g++ cmake -S core -B core/build -DCMAKE_BUILD_TYPE=Release \
  -DONNXRUNTIME_ROOT=/opt/onnxruntime
cmake --build core/build -j$(nproc)
make build-daemon   # picks up the new cberg-index
```

**4. Run embedding tests**

```bash
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export LD_LIBRARY_PATH="/opt/onnxruntime/lib:${LD_LIBRARY_PATH:-}"
./core/build/test/test_embed    # ok - embed
./core/build/test/test_search   # ok - search
```

**5. Run the daemon with vector search**

Set in `daemon/.env` or the shell before `make run-daemon`:

```bash
export CODEBERG_ROOT="$(git rev-parse --show-toplevel)"
export CBERG_MODEL=models/jina-embeddings-v2-base-code/model.onnx
export CBERG_INDEX_PATH=/tmp/codeberg.usearch
export LD_LIBRARY_PATH="/opt/onnxruntime/lib:${LD_LIBRARY_PATH:-}"
make run-daemon
```

First cold index with embeddings is slow (this repo ~12k chunks can take several
minutes on CPU). Poll `GET /health` until `"ready": true`, then:

```bash
curl -s "http://127.0.0.1:8080/search?q=chunking&k=3"
```

ONNX is optional in cloud: skip steps 1–5 unless the task touches
`core/src/embed/`, vector search, or embedding tests.

### What to skip in cloud

- Do not fetch the ONNX model or start long-running daemons unless the task
  requires search, embedding, or agent integration.
- Submodule grammars under `core/third_party/grammars/` are fetched by
  `make submodules` — do not vendor them manually.

### Toolchain gotchas (non-Dockerfile VMs)

Some cloud VMs ship **Clang as the default `cc`/`c++`**, which breaks CMake with
`cannot find -lstdc++` when it selects the GCC 14 toolchain without
`libstdc++-14-dev`. Force GCC for the C core:

```bash
CC=gcc CXX=g++ make build
```

The committed `.cursor/Dockerfile` uses plain Ubuntu 24.04 where defaults are GCC,
so this usually only affects ad-hoc VMs.

**Agent build:** `npm ci` / `npm install` in `agent/` can omit the Rollup native
optional dependency (`@rollup/rollup-linux-x64-gnu`). If `tsup` fails with that
module missing, install it after `npm ci`:

```bash
cd agent && npm ci && npm install @rollup/rollup-linux-x64-gnu --no-save && npm run build
```

`make agent-test` runs `npm install` first and may hit the same issue; run
`npm test` directly once `node_modules` is fixed.

### Running the daemon (chunk-only demo)

```bash
export CODEBERG_ROOT="$(git rev-parse --show-toplevel)"
make run-daemon   # background in tmux; indexes CODEBERG_ROOT
curl -s http://127.0.0.1:8080/health
curl -s -X POST http://127.0.0.1:8080/tools/call \
  -H 'Content-Type: application/json' \
  -d '{"name":"grep","args":{"pattern":"chunking","literal":true,"limit":3}}'
curl -s -X POST http://127.0.0.1:8080/tools/call \
  -H 'Content-Type: application/json' \
  -d '{"name":"find_symbol","args":{"name":"cberg_chunker_open"}}'
```

Daemon HTTP API and tool reference: `daemon/docs/http.md`. Indexer IPC:
`daemon/docs/ipc.md`.
