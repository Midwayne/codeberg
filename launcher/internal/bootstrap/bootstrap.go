// Package bootstrap makes sure the components and the embedding model exist
// before a run. It works two ways: a prebuilt *dist* install (Homebrew / a
// release tarball) ships the binaries and agent ready to run, so bootstrap just
// fetches the model; otherwise it builds from the source checkout via the repo's
// Makefile and downloads the model with the repo's fetch-model.sh.
package bootstrap

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// Ensure builds/downloads whatever is missing. With force, it rebuilds the code
// regardless (the model is only fetched when missing — it does not change). When
// running from a prebuilt dist there is nothing to build, so it only ensures the
// model; force is ignored (reinstall the package to update a prebuilt install).
func Ensure(c *config.Config, force bool) error {
	root, prebuilt := c.ResolveRoot()
	if prebuilt {
		skip("prebuilt components")
		if c.Vector {
			if err := ensureModel(c, root); err != nil {
				return err
			}
		}
		ensureSearxng(c, force)
		return nil
	}

	if c.Repo == "" {
		return fmt.Errorf("no source checkout to build from (set CODEBERG_REPO/--repo)")
	}

	// Make sure the toolchains/libraries the Makefile shells out to exist (and
	// auto-install the missing ones) before we invoke it — a missing cmake, Go,
	// Node, or ONNX runtime otherwise surfaces as an opaque mid-build failure.
	// Skip the check when nothing needs (re)building: an up-to-date tree already
	// proved the toolchain works, so don't gate a plain run on it.
	a := config.LocateArtifacts(c.Repo)
	// The React SPA codeberg-web serves; only built for --web. Its absence is not
	// fatal (the server falls back to an embedded page), but with --web we build
	// it so the rich UI shows.
	webUIIndex := filepath.Join(c.Repo, "agent", "web-ui", "dist", "index.html")

	needDaemon := force || !exists(a.DaemonBin) || !exists(a.IndexBin)
	// The agent bundle ships both tui.js and web.js from one build, so a missing
	// web.js (only needed for --web) also triggers an agent rebuild.
	needAgent := force || !exists(a.TUIScript) || (c.Web && !exists(a.WebScript))
	needWebUI := c.Web && (force || !exists(webUIIndex))

	// Make sure the toolchains/libraries the Makefile shells out to exist (and
	// auto-install the missing ones) before we invoke it — a missing cmake, Go,
	// Node, or ONNX runtime otherwise surfaces as an opaque mid-build failure.
	// Skip the check when nothing needs (re)building: an up-to-date tree already
	// proved the toolchain works, so don't gate a plain run on it.
	if needDaemon || needAgent || needWebUI {
		if err := deps.Ensure(os.Stderr); err != nil {
			return err
		}
	}

	// codeberg-d + cberg-index: `make build-daemon` builds the core first if
	// needed, then the Go daemon — so one target covers both binaries.
	if needDaemon {
		if err := makeTarget(c.Repo, "build-daemon", "core + daemon"); err != nil {
			return err
		}
	} else {
		skip("core + daemon")
	}

	// agent/dist (the TUI + web bundles): `make build-agent` runs npm install + build.
	if needAgent {
		if err := makeTarget(c.Repo, "build-agent", "agent (TUI + web)"); err != nil {
			return err
		}
	} else {
		skip("agent (TUI + web)")
	}

	// web-ui/dist (the browser SPA): `make build-web-ui` runs npm install + vite build.
	if needWebUI {
		if err := makeTarget(c.Repo, "build-web-ui", "agent (web UI)"); err != nil {
			return err
		}
	} else if c.Web {
		skip("agent (web UI)")
	}

	if c.Vector {
		if err := ensureModel(c, c.Repo); err != nil {
			return err
		}
	}
	ensureSearxng(c, force)
	return nil
}

// ensureSearxng installs (or, with force, upgrades) the local SearXNG that backs
// web_search. It is entirely best-effort: any problem is reported as a warning
// and never fails the run, so the agent still starts with fetch_url and the
// codebase tools. Skipped when web use is off or an external SearXNG is set.
func ensureSearxng(c *config.Config, force bool) {
	if !c.WebUse || c.SearxngURL != "" {
		return
	}
	if searxng.Installed(c.Home) && !force {
		skip("SearXNG (web search)")
		return
	}
	if err := deps.EnsurePython(os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "⚠ %v\n  web_search disabled; fetch_url and code search still work.\n", err)
		return
	}
	step("installing SearXNG for web_search (managed Python venv — first run only)")
	if err := searxng.EnsureInstalled(c.Home, force, os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "⚠ SearXNG install failed: %v\n"+
			"  web_search disabled; fetch_url and code search still work. "+
			"Retry with `codeberg build`, or set CODEBERG_WEB_USE=false to silence this.\n", err)
	}
}

// ensureModel downloads the embedding model if absent, using the fetch-model.sh
// that ships under root (the source checkout or the dist dir).
func ensureModel(c *config.Config, root string) error {
	if exists(c.EmbedModel) {
		skip("embedding model")
		return nil
	}
	step("downloading embedding model (jina-embeddings-v2-base-code, ~160MB)")
	script := filepath.Join(root, "scripts", "fetch-model.sh")
	// Download into the launcher-owned model dir (the parent of EmbedModel),
	// which lives under ~/.codeberg rather than the repo.
	dest := filepath.Dir(c.EmbedModel)
	cmd := exec.Command(script, dest)
	cmd.Dir = root
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("fetch-model.sh failed: %w", err)
	}
	if !exists(c.EmbedModel) {
		return fmt.Errorf("model download finished but %s is missing", c.EmbedModel)
	}
	return nil
}

func makeTarget(repo, target, label string) error {
	step("building " + label + " (make " + target + ")")
	cmd := exec.Command("make", "-C", repo, target)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("make %s failed: %w", target, err)
	}
	return nil
}

func step(msg string)   { fmt.Fprintf(os.Stderr, "› %s\n", msg) }
func skip(label string) { fmt.Fprintf(os.Stderr, "✓ %s already present\n", label) }
