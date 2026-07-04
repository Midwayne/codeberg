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

### Embedding / ONNX tests (optional)

Core tests run without ONNX. Embedding tests (`test_embed`) skip when
`CBERG_TEST_MODEL` is unset. To run them in cloud:

```bash
scripts/fetch-model.sh
export CBERG_TEST_MODEL=models/jina-embeddings-v2-base-code/model.onnx
make test TEST=test_embed
```

ONNX Runtime is not preinstalled in the cloud image. Install it only when the
task touches `core/src/embed/` or embedding tests; otherwise rely on chunk-only
tests and skip vector indexing.

### What to skip in cloud

- Do not fetch the ONNX model or start long-running daemons unless the task
  requires search, embedding, or agent integration.
- Submodule grammars under `core/third_party/grammars/` are fetched by
  `make submodules` — do not vendor them manually.
