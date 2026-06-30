#!/usr/bin/env bash
# Rebuild codeberg in place after a code change — no uninstall/reinstall cycle.
#
# It rebuilds the components from this source checkout (core + daemon, the agent
# bundle, and the browser SPA) and then rebuilds and relinks the `codeberg`
# launcher itself (via install.sh). Because the installed `codeberg` is a symlink
# into this checkout's launcher/bin and runs the checkout's freshly built
# artifacts, the next `codeberg` (or `codeberg --web`) run uses the new build.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)" # launcher/ sits inside the source checkout

if [ ! -f "$repo/Makefile" ]; then
  echo "update.sh: expected a codeberg checkout at $repo (no Makefile found)" >&2
  exit 1
fi

echo "› rebuilding components (core + daemon, agent, web UI)…"
make -C "$repo" build-daemon build-agent build-web-ui

# Refresh the managed SearXNG (web_search backend) when it has been installed.
# It lives in a Python venv under the launcher home; pull the checkout and
# reinstall its pinned requirements. We install requirements (not `pip install
# -e .`): SearXNG's setup.py imports the package under PEP 517 build isolation,
# which fails before its deps exist. Best effort — never block the update on it.
home="${CODEBERG_HOME:-$HOME/.codeberg}"
if [ -x "$home/searxng/venv/bin/python" ] && [ -d "$home/searxng/src" ]; then
  echo "› updating SearXNG (web search)…"
  ( cd "$home/searxng/src" && git pull --ff-only ) || true
  "$home/searxng/venv/bin/python" -m pip install -r "$home/searxng/src/requirements.txt" \
    || echo "  (SearXNG update skipped — re-run 'codeberg build' to retry)"
fi

echo "› rebuilding and relinking the launcher…"
"$here/install.sh"

echo "✓ update complete — run: codeberg   (or: codeberg --web)"
