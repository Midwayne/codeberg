#!/usr/bin/env bash
# Idempotent install for Cursor Cloud Agents. Runs from the repo root via
# environment.json after Cursor checks out the requested commit.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

make submodules
CC=gcc CXX=g++ make build
make build-daemon
cd agent && npm ci && npm install @rollup/rollup-linux-x64-gnu --no-save && npm run build
