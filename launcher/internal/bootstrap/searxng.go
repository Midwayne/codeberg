package bootstrap

import (
	"context"
	"fmt"
	"os"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

// ensureSearxng sets up the local SearXNG that backs web_search. On a normal run
// it does NOT block: a first-time install (git clone + pip, often minutes) would
// stall startup, so the run path installs it in the background instead and this
// only reports an already-present install. `codeberg build` (force) installs or
// upgrades synchronously — the explicit "set everything up" path, where blocking
// and interactive python install prompts are expected. Always best-effort:
// problems are warnings, never fatal. Skipped when web use is off or an external
// SearXNG is configured.
func ensureSearxng(c *config.Config, force bool) {
	if !c.WebUse || !c.WebSearchUse || c.SearxngURL != "" {
		return
	}

	installed := searxng.Installed(c.Home)
	if installed && !force {
		skip(c, "SearXNG (web search)")
		return
	}

	if !force {
		// Defer the (slow, first-time) install to the background run path.
		return
	}

	if err := deps.EnsurePython(os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "⚠ %v\n  web_search disabled; fetch_url and code search still work.\n", err)
		return
	}

	verb := "installing"
	if installed {
		verb = "updating"
	}

	step(verb + " SearXNG for web_search (managed Python venv)")
	if err := searxng.EnsureInstalled(context.Background(), c.Home, installed, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "⚠ SearXNG install failed: %v\n"+
			"  web_search disabled; fetch_url and code search still work. "+
			"Retry with `codeberg build`, or set CODEBERG_WEB_USE=false to silence this.\n", err)
	}
}
