# Codeberg — developer targets (core, daemon, agent).
#
#   make build-core         configure + compile libcodeberg + cberg-index
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
LAUNCHER   := $(ROOT)/launcher
BUILD      := $(CORE)/build
BIN        := $(BUILD)/bin
DAEMON_ENV ?= $(DAEMON)/.env
AGENT_ENV  ?= $(AGENT)/.env
CMAKE      ?= cmake
BUILD_TYPE ?= Release
JOBS       ?= $(shell sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

# Packaging (see the `dist` target). DISTDIR is where the self-contained payload
# is assembled. DIST_PREFIX optionally bakes an absolute payload path into the
# launcher (for an in-place install at a known prefix); left empty the build is
# *relocatable* — the launcher finds its payload at ../libexec relative to its
# own binary, so an extracted tarball works wherever it lands.
DISTDIR     ?= $(ROOT)/dist
DIST_PREFIX ?=

# $(call load_env,FILE): source FILE (if present) into the recipe shell. One
# logical line so the exported vars survive through to the exec/run that follows.
load_env = if [ -f "$(1)" ]; then set -a; . "$(1)"; set +a; echo "› loaded $(1)"; else echo "› no $(1); using current environment"; fi

.PHONY: build-core build test bench clean rebuild submodules help check set-version \
        build-daemon daemon-test build-agent build-web-ui agent-test dist format \
        run-core run-index run-daemon run-agent run-agent-tui run-agent-web gen-walk-skip

help:
	@echo "Codeberg targets:"
	@echo "  Build"
	@echo "    make build-core           Configure and compile libcodeberg + cberg-index"
	@echo "    make build-daemon         Build Go codeberg-d (pure Go, no CGO)"
	@echo "    make build-agent          Install deps and build the agent (npm: TUI + web server)"
	@echo "    make build-web-ui         Build the browser chat SPA (web-ui/dist, served by --web)"
	@echo "    make dist [DISTDIR=...]   Assemble a self-contained install tree (packaging)"
	@echo "    make rebuild              clean + build-core"
	@echo "  Run"
	@echo "    make run-core             Run the C indexer (cberg-index)     [daemon/.env]"
	@echo "    make run-daemon           Run the Go daemon (codeberg-d) + HTTP [daemon/.env]"
	@echo "    make run-agent q=\"…\"      Ask the agent, e.g. q=\"how does chunking work\"  [agent/.env]"
	@echo "    make run-agent-tui          Interactive agent chat (follow-ups)  [agent/.env]"
	@echo "    make run-agent-web          Serve the browser chat UI (codeberg-web)  [agent/.env]"
	@echo "  Test"
	@echo "    make bench                Run core micro-benchmarks (strmap, u64map, chunk_table, fingerprint)"
	@echo "    make test                 Run all core tests (ctest)"
	@echo "    make test TEST=<name>     Run one test (test_smoke test_chunker …)"
	@echo "    make daemon-test          Run Go tests in daemon/"
	@echo "    make agent-test           Run agent tests (vitest)"
	@echo "    make check                build-core + test (pre-PR gate)"
	@echo "    make format               clang-format (C), gofmt (Go), prettier (TS)"
	@echo "  Misc"
	@echo "    make gen-walk-skip          Regenerate C/Go skip-dir tables from configs/walk_skip_dirs.txt"
	@echo "    make set-version v=vX.Y.Z Bump VERSION (rebuild to propagate)"
	@echo "    make submodules           git submodule update --init --recursive"
	@echo "    make clean                Remove $(BUILD)"
	@echo ""
	@echo "Variables: BUILD_TYPE=$(BUILD_TYPE)  JOBS=$(JOBS)"

submodules:
	# --force materializes working trees even from a half-initialized clone
	# (a local `git clone` can leave submodules with a gitdir but no checkout,
	# which a plain `update` would silently no-op).
	git -C $(ROOT) submodule update --init --recursive --force

build-core:
	@test -f $(CORE)/third_party/tree-sitter/lib/src/lib.c || $(MAKE) submodules
	$(CMAKE) -S $(CORE) -B $(BUILD) -DCMAKE_BUILD_TYPE=$(BUILD_TYPE)
	$(CMAKE) --build $(BUILD) -j$(JOBS)

# Back-compat alias for the conventional `make build` (and existing scripts/CI).
build: build-core

bench: build-core
	@for b in bench_strmap bench_u64map bench_chunk_table bench_fingerprint; do \
	  echo "=== $$b ==="; \
	  $(BUILD)/bench/$$b || exit 1; \
	done

test: build-core
ifdef TEST
	@test -x $(BUILD)/$(TEST) || (echo "unknown test: $(TEST)" && exit 1)
	$(BUILD)/$(TEST)
else
	cd $(BUILD) && ctest --output-on-failure
endif

.PHONY: test-index-providers
test-index-providers: build-core
	chmod +x scripts/test-index-providers.sh
	./scripts/test-index-providers.sh

clean:
	rm -rf $(BUILD)

rebuild: clean build-core

check: build-core test

format:
	chmod +x scripts/format.sh
	./scripts/format.sh

build-daemon: build-core
	./scripts/build-daemon.sh

daemon-test: build-core
	./scripts/test-daemon.sh

build-agent:
	cd $(AGENT) && npm install && npm run build

# The browser chat SPA served by `codeberg --web` / codeberg-web. The server
# resolves it at agent/web-ui/dist (a sibling of agent/dist/web.js), so building
# it here is all `--web` needs to serve the rich UI instead of the fallback page.
build-web-ui:
	cd $(AGENT)/web-ui && npm install && npm run build

agent-test:
	cd $(AGENT) && npm install && npm test

# --- Package -----------------------------------------------------------------

# `make dist` assembles a self-contained, relocatable tree the launcher runs
# from without a source checkout or build toolchain — the groundwork a future
# packaged installer (e.g. a Homebrew tap) builds on:
#
#   <DISTDIR>/bin/codeberg                                       the launcher
#   <DISTDIR>/libexec/core/build/bin/{cberg-index,codeberg-d}    siblings; daemon finds the indexer
#   <DISTDIR>/libexec/agent/dist/*.js + .../agent/node_modules   node resolves up from dist/
#   <DISTDIR>/libexec/agent/web-ui/dist                          browser SPA (--web; sibling of dist/web.js)
#   <DISTDIR>/libexec/scripts/fetch-model.sh                     runtime model download
#
# The launcher locates its payload at ../libexec relative to its own (symlink-
# resolved) binary, so the whole tree can be extracted anywhere — `bin/` and
# `libexec/` just have to stay siblings.
#
#   make dist DISTDIR=/assemble/here [DIST_PREFIX=/baked/runtime/path]
#
# Note: cberg-index keeps the ONNX Runtime rpath from build time, so it expects
# the runtime at the same prefix at runtime; a tarball for other machines would
# additionally bundle libonnxruntime + rewrite rpath.
dist: build-core build-daemon build-agent build-web-ui
	@echo "› assembling dist into $(DISTDIR)"
	rm -rf "$(DISTDIR)"
	mkdir -p "$(DISTDIR)/bin" "$(DISTDIR)/libexec/core/build/bin" "$(DISTDIR)/libexec/agent/web-ui" "$(DISTDIR)/libexec/scripts"
	cp "$(BIN)/cberg-index" "$(BIN)/codeberg-d" "$(DISTDIR)/libexec/core/build/bin/"
	cp -R "$(AGENT)/dist" "$(DISTDIR)/libexec/agent/dist"
	cp -R "$(AGENT)/web-ui/dist" "$(DISTDIR)/libexec/agent/web-ui/dist"
	cp "$(AGENT)/package.json" "$(AGENT)/package-lock.json" "$(DISTDIR)/libexec/agent/"
	cd "$(DISTDIR)/libexec/agent" && npm ci --omit=dev --no-audit --no-fund
	cp "$(ROOT)/scripts/fetch-model.sh" "$(DISTDIR)/libexec/scripts/"
	cd "$(LAUNCHER)" && go build \
	  -ldflags "-X codeberg.org/codeberg/launcher/internal/config.BuildDist=$(DIST_PREFIX)" \
	  -o "$(DISTDIR)/bin/codeberg" ./cmd/codeberg
	@echo "✓ dist ready — run: $(DISTDIR)/bin/codeberg"

# --- Run ---------------------------------------------------------------------

run-core run-index: build-core
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

run-agent-tui:
	@test -f $(AGENT)/dist/tui.js || $(MAKE) build-agent
	@$(call load_env,$(AGENT_ENV)); \
	if [ -z "$${CODEBERG_MODEL:-}" ]; then echo "error: set CODEBERG_MODEL=provider:model in $(AGENT_ENV) (e.g. anthropic:claude-haiku-4-5) plus the matching API key"; exit 1; fi; \
	cd $(AGENT) && exec node dist/tui.js $(q)

# Serve the browser chat UI. Builds the SPA too so the rich UI shows (without it
# the server still works, falling back to an embedded page). Port: CODEBERG_WEB_PORT.
run-agent-web:
	@test -f $(AGENT)/dist/web.js || $(MAKE) build-agent
	@test -f $(AGENT)/web-ui/dist/index.html || $(MAKE) build-web-ui
	@$(call load_env,$(AGENT_ENV)); \
	if [ -z "$${CODEBERG_MODEL:-}" ]; then echo "error: set CODEBERG_MODEL=provider:model in $(AGENT_ENV) (e.g. anthropic:claude-haiku-4-5) plus the matching API key"; exit 1; fi; \
	cd $(AGENT) && exec node dist/web.js

gen-walk-skip:
	./scripts/gen-walk-skip.sh

set-version:
	./scripts/set-version.sh $(v)

.DEFAULT_GOAL := build-core
