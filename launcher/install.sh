#!/usr/bin/env bash
# Build the launcher and put a `codeberg` command on PATH.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/bin/codeberg"

echo "› building codeberg…"
( cd "$here" && go build -o "$out" ./cmd/codeberg )

# Pick the first writable directory already on PATH.
for dir in "$HOME/.local/bin" "$HOME/bin" "/usr/local/bin"; do
  case ":$PATH:" in *":$dir:"*) ;; *) continue ;; esac
  if mkdir -p "$dir" 2>/dev/null && [ -w "$dir" ]; then
    ln -sf "$out" "$dir/codeberg"
    echo "✓ linked $dir/codeberg -> $out"
    echo "  run: codeberg"
    exit 0
  fi
done

echo "✓ built $out"
echo "  No writable PATH dir found. Add it yourself, e.g.:"
echo "    ln -sf \"$out\" /usr/local/bin/codeberg   # may need sudo"
