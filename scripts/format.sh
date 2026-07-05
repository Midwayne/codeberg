#!/usr/bin/env bash
# Format first-party sources (core C, daemon/launcher Go, agent TypeScript).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v clang-format >/dev/null 2>&1; then
  echo "error: clang-format not found (install clang-format)" >&2
  exit 1
fi

mapfile -t c_files < <(git ls-files \
  'core/src/**/*.c' 'core/src/**/*.h' \
  'core/cmd/**/*.c' 'core/cmd/**/*.h' \
  'core/test/**/*.c' 'core/test/**/*.h' \
  'core/include/**/*.h')
if ((${#c_files[@]} > 0)); then
  clang-format -i "${c_files[@]}"
fi

mapfile -t go_files < <(git ls-files 'daemon/**/*.go' 'launcher/**/*.go')
if ((${#go_files[@]} > 0)); then
  gofmt -w "${go_files[@]}"
fi

if command -v npx >/dev/null 2>&1; then
  (cd agent && npx --yes prettier@3.5.3 --write "src/**/*.{ts,tsx}" "*.{ts,json}")
  (cd agent/web-ui && npx --yes prettier@3.5.3 --write "src/**/*.{ts,tsx}" "*.{ts,json}")
else
  echo "warn: npx not found; skipping TypeScript formatting" >&2
fi

echo "format complete"
