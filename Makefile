# Codeberg — developer targets (core, daemon, agent).
#
#   make build              configure + compile libcodeberg + cberg-index
#   make test               run all core tests (ctest)
#   make run-core           run the C indexer (cberg-index)
#   make run-daemon         run the Go daemon (codeberg-d)
#   make run-agent q="…"    run the agent CLI against a running daemon
#   make help               list targets
#
# run-core / run-daemon load daemon/.env (copy daemon/.env.example); run-agent
# loads agent/.env (copy agent/.env.example). The daemon never sees the LLM API
# key — that belongs to the agent. Missing file ⇒ the current environment is used.

ROOT       := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
CORE       := $(ROOT)/core
DAEMON     := $(ROOT)/daemon
AGENT      := $(ROOT)/agent
BUILD      := $(CORE)/build
BIN        := $(BUILD)/bin
DAEMON_ENV ?= $(DAEMON)/.env
AGENT_ENV  ?= $(AGENT)/.env
CMAKE      ?= cmake
BUILD_TYPE ?= Release
JOBS       ?= $(shell sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

# $(call load_env,FILE): source FILE (if present) into the recipe shell. One
# logical line so the exported vars survive through to the exec/run that follows.
load_env = if [ -f "$(1)" ]; then set -a; . "$(1)"; set +a; echo "› loaded $(1)"; else echo "› no $(1); using current environment"; fi

.PHONY: build test clean rebuild submodules help check set-version \
        build-daemon daemon-test build-agent agent-test \
        run-core run-index run-daemon run-agent

help:
	@echo "Codeberg targets:"
	@echo "  Build"
	@echo "    make build                Configure and compile libcodeberg + cberg-index"
	@echo "    make build-daemon         Build Go codeberg-d (pure Go, no CGO)"
	@echo "    make build-agent          Install deps and build the agent (npm)"
	@echo "    make rebuild              clean + build"
	@echo "  Run"
	@echo "    make run-core             Run the C indexer (cberg-index)     [daemon/.env]"
	@echo "    make run-daemon           Run the Go daemon (codeberg-d) + HTTP [daemon/.env]"
	@echo "    make run-agent q=\"…\"      Ask the agent, e.g. q=\"how does chunking work\"  [agent/.env]"
	@echo "  Test"
	@echo "    make test                 Run all core tests (ctest)"
	@echo "    make test TEST=<name>     Run one test (test_smoke test_chunker …)"
	@echo "    make daemon-test          Run Go tests in daemon/"
	@echo "    make agent-test           Run agent tests (vitest)"
	@echo "    make check                build + test (pre-PR gate)"
	@echo "  Misc"
	@echo "    make set-version v=vX.Y.Z Bump VERSION (rebuild to propagate)"
	@echo "    make submodules           git submodule update --init --recursive"
	@echo "    make clean                Remove $(BUILD)"
	@echo ""
	@echo "Variables: BUILD_TYPE=$(BUILD_TYPE)  JOBS=$(JOBS)"

submodules:
	git -C $(ROOT) submodule update --init --recursive

build:
	@test -f $(CORE)/third_party/tree-sitter/lib/src/lib.c || $(MAKE) submodules
	$(CMAKE) -S $(CORE) -B $(BUILD) -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	$(CMAKE) --build $(BUILD) -j$(JOBS)

test: build
ifdef TEST
	@test -x $(BUILD)/$(TEST) || (echo "unknown test: $(TEST)" && exit 1)
	$(BUILD)/$(TEST)
else
	cd $(BUILD) && ctest --output-on-failure
endif

clean:
	rm -rf $(BUILD)

rebuild: clean build

check: build test

build-daemon: build
	./scripts/build-daemon.sh

daemon-test: build
	./scripts/test-daemon.sh

build-agent:
	cd $(AGENT) && npm install && npm run build

agent-test:
	cd $(AGENT) && npm install && npm test

# --- Run ---------------------------------------------------------------------

run-core run-index: build
	@$(call load_env,$(DAEMON_ENV)); \
	echo "› cberg-index  root=$${CODEBERG_ROOT:-<unset>}  socket=$${CBERG_SOCKET:-/tmp/codeberg-index.sock}"; \
	exec "$(BIN)/cberg-index"

run-daemon: build-daemon
	@$(call load_env,$(DAEMON_ENV)); \
	echo "› codeberg-d  http=:$${CODEBERG_HTTP_PORT:-8080}  root=$${CODEBERG_ROOT:-<unset>}"; \
	exec "$(BIN)/codeberg-d"

# Usage: make run-agent q="<question>"
#   Model/provider come from CODEBERG_MODEL in agent/.env (e.g. anthropic:claude-haiku-4-5),
#   with the matching API key (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY).
#   Talks to a running daemon at CODEBERG_DAEMON_URL (default http://127.0.0.1:8080).
run-agent:
	@test -f $(AGENT)/dist/cli.js || $(MAKE) build-agent
	@$(call load_env,$(AGENT_ENV)); \
	if [ -z "$${CODEBERG_MODEL:-}" ]; then echo "error: set CODEBERG_MODEL=provider:model in $(AGENT_ENV) (e.g. anthropic:claude-haiku-4-5) plus the matching API key"; exit 1; fi; \
	cd $(AGENT) && exec node dist/cli.js $(q)

set-version:
	./scripts/set-version.sh $(v)

.DEFAULT_GOAL := build
