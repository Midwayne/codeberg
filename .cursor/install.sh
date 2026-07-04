#!/usr/bin/env bash
# Idempotent install for Cursor Cloud Agents. Runs from the repo root via
# environment.json after Cursor checks out the requested commit.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

make submodules
make build
make build-daemon
make build-agent
