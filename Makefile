# Codeberg — core (libcodeberg) developer targets.
#
#   make build              configure + compile
#   make test               run all tests (ctest)
#   make test TEST=<name>   run one test binary
#   make clean              remove core/build
#   make help               list targets

ROOT       := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
CORE       := $(ROOT)/core
BUILD      := $(CORE)/build
CMAKE      ?= cmake
BUILD_TYPE ?= Release
JOBS       ?= $(shell sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

.PHONY: build test clean rebuild submodules help check set-version build-daemon daemon-test

help:
	@echo "Codeberg core targets:"
	@echo "  make build                Configure and compile libcodeberg"
	@echo "  make build-daemon         Build Go codeberg-d (pure Go, no CGO)"
	@echo "  make daemon-test          Run Go tests in daemon/"
	@echo "  make test                 Run all core tests (ctest)"
	@echo "  make test TEST=<name>     Run one test (test_smoke test_chunker …)"
	@echo "  make check                build + test (pre-PR gate)"
	@echo "  make set-version v=vX.Y.Z Bump VERSION (rebuild to propagate)"
	@echo "  make submodules           git submodule update --init --recursive"
	@echo "  make clean                Remove $(BUILD)"
	@echo "  make rebuild              clean + build"
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

set-version:
	./scripts/set-version.sh $(v)

.DEFAULT_GOAL := build
