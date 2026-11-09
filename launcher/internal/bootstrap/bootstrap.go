// Package bootstrap makes sure the components and the embedding model exist
// before a run. It works two ways: a prebuilt *dist* install (Homebrew / a
// release tarball) ships the binaries and agent ready to run, so bootstrap just
// fetches the model; otherwise it builds from the source checkout via the repo's
// Makefile and downloads the model with the repo's fetch-model.sh.
package bootstrap

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
	"codeberg.org/codeberg/launcher/internal/embedding"
	"codeberg.org/codeberg/launcher/internal/paths"
	"codeberg.org/codeberg/launcher/internal/searxng"
)

// Replace build operations in tests without installing host dependencies.
var ensureBuildDeps = deps.Ensure
var buildComponent = makeTarget

// Ensure builds/downloads whatever is missing. With force, it rebuilds the code
// regardless (the model is only fetched when missing — it does not change). When
// running from a prebuilt dist there is nothing to build, so it only ensures the
// model; force is ignored (reinstall the package to update a prebuilt install).
func Ensure(c *config.Config, force bool) error {
	root, prebuilt := c.ResolveRoot()
	if prebuilt {
		skip(c, "prebuilt components")
		if err := ensureEmbedding(c, root, force); err != nil {
			return err
		}
		if c.DbmcpUse {
			bin := c.DbmcpBinary()
			if bin == "" || !paths.Exists(bin) {
				fmt.Fprintf(os.Stderr, "⚠ dbmcp binary missing (%s); database MCP tools will be skipped\n", bin)
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
	// The React SPA served by codeberg-web.
	webUIIndex := filepath.Join(c.Repo, "agent", "web-ui", "dist", "index.html")

	needDaemon := force || !paths.Exists(a.DaemonBin) || !paths.Exists(a.IndexBin) || needsONNXBuild(c, a.IndexBin)
	needAgent := force || !paths.Exists(a.WebScript)
	needWebUI := force || !paths.Exists(webUIIndex)
	// The built-in database MCP binary is only built when the user turned it on
	// and did not point CODEBERG_DBMCP_BIN at their own executable.
	needDbmcp := c.DbmcpUse && c.DbmcpBin == "" && (force || !paths.Exists(a.DbmcpBin))

	if needDaemon || needAgent || needWebUI || needDbmcp {
		if err := ensureBuildDeps(os.Stderr, c.Vector && c.EmbedBackend == "onnx"); err != nil {
			return err
		}
	}

	// codeberg-d + cberg-index: `make build-daemon` builds the core first if
	// needed, then the Go daemon — so one target covers both binaries.
	if needDaemon {
		if err := buildComponent(c.Repo, "build-daemon", "core + daemon"); err != nil {
			return err
		}

		if err := ensureONNX(c, a.IndexBin, force); err != nil {
			return err
		}
	} else {
		skip(c, "core + daemon")
	}

	// agent/dist: `make build-agent` runs npm install + build.
	if needAgent {
		if err := buildComponent(c.Repo, "build-agent", "agent"); err != nil {
			return err
		}
	} else {
		skip(c, "agent")
	}

	// web-ui/dist (the browser SPA): `make build-web-ui` runs npm install + vite build.
	if needWebUI {
		if err := buildComponent(c.Repo, "build-web-ui", "agent (web UI)"); err != nil {
			return err
		}
	} else {
		skip(c, "agent (web UI)")
	}

	if needDbmcp {
		if err := buildComponent(c.Repo, "build-dbmcp", "database MCP (dbmcp)"); err != nil {
			return err
		}
	} else if c.DbmcpUse && c.DbmcpBin == "" {
		skip(c, "database MCP (dbmcp)")
	}
	if c.DbmcpUse && c.DbmcpBin != "" && !paths.Exists(c.DbmcpBin) {
		fmt.Fprintf(os.Stderr, "⚠ CODEBERG_DBMCP_BIN not found (%s); database MCP tools will be skipped\n", c.DbmcpBin)
	}

	if err := ensureEmbedding(c, c.Repo, force); err != nil {
		return err
	}
	ensureSearxng(c, force)
	return nil
}

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

// prepareModel is replaced in tests.
var prepareModel = ensureModel

// ensureEmbedding prepares the embedding model when semantic search is on. A
// normal run that cannot prepare it (offline, mirror down, Python too old)
// starts without semantic search instead of failing; existing indexes are left
// untouched. An explicit `codeberg build` still reports the failure.
func ensureEmbedding(c *config.Config, root string, force bool) error {
	if !c.Vector {
		return nil
	}

	return embeddingSetupResult(c, force, prepareModel(c, root))
}

func embeddingSetupResult(c *config.Config, force bool, err error) error {
	if err == nil || force {
		return err
	}

	fmt.Fprintf(os.Stderr, "⚠ Semantic search is off for this run: the embedding runtime or model could not be prepared.\n"+
		"  %v\n  Chat and exact-text search still work. Retry with `codeberg build`.\n", err)
	c.Vector = false

	return nil
}

// ensureModel downloads the embedding model if absent, using the fetch-model.sh
// that ships under root (the source checkout or the dist dir).
func ensureModel(c *config.Config, root string) error {
	ready := paths.Exists(c.EmbedModel)
	if model, err := embedding.Lookup(c.Embedding); err == nil && model.UsesVenv() {
		ready = ready && paths.Exists(filepath.Join(filepath.Dir(c.EmbedModel), model.ReadyMark())) &&
			paths.Exists(filepath.Join(model.VenvPath(c.Home), "bin", "python"))
	}
	if ready {
		label := c.Embedding
		if label == "" {
			label = c.EmbedModel
		}
		skip(c, "embedding model "+label+" ("+c.EmbedBackend+")")
		return nil
	}
	if c.EmbedBackend != "onnx" {
		model, err := embedding.Lookup(c.Embedding)
		if err != nil {
			return err
		}
		step("preparing embedding model " + c.Embedding)
		cmd := exec.Command("python3", filepath.Join(root, "scripts", "embedding_setup.py"),
			c.Embedding, model.HuggingFace, c.EmbedModel, model.VenvPath(c.Home))
		cmd.Stdout, cmd.Stderr = os.Stderr, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("embedding setup: %w", err)
		}
		if !paths.Exists(c.EmbedModel) {
			return fmt.Errorf("embedding setup finished but %s is missing", c.EmbedModel)
		}
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
	if !paths.Exists(c.EmbedModel) {
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

func step(msg string) { fmt.Fprintf(os.Stderr, "› %s\n", msg) }

// skip confirms an existing component. Normal runs stay quiet; --verbose and
// `codeberg build` list every check.
func skip(c *config.Config, label string) {
	if c.Verbose {
		fmt.Fprintf(os.Stderr, "✓ %s already present\n", label)
	}
}
