// Package bootstrap makes sure the three components and the embedding model
// exist before a run. Today it builds from the source checkout (via the repo's
// Makefile) and downloads the model with the repo's fetch-model.sh; each step
// is a seam where a future "download a prebuilt release artifact" path can drop
// in for true zero-toolchain installs and cloud deploys.
package bootstrap

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
)

// Artifacts are the on-disk products the launcher runs.
type Artifacts struct {
	DaemonBin string // core/build/bin/codeberg-d
	IndexBin  string // core/build/bin/cberg-index
	TUIScript string // agent/dist/tui.js
}

// Locate returns the expected artifact paths for a repo (no existence check).
func Locate(repo string) Artifacts {
	bin := filepath.Join(repo, "core", "build", "bin")
	return Artifacts{
		DaemonBin: filepath.Join(bin, "codeberg-d"),
		IndexBin:  filepath.Join(bin, "cberg-index"),
		TUIScript: filepath.Join(repo, "agent", "dist", "tui.js"),
	}
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

// Ensure builds/downloads whatever is missing. With force, it rebuilds the code
// regardless (the model is only fetched when missing — it does not change).
func Ensure(c *config.Config, force bool) error {
	if c.Repo == "" {
		return fmt.Errorf("no source checkout to build from (set CODEBERG_REPO/--repo)")
	}
	a := Locate(c.Repo)

	// codeberg-d + cberg-index: `make build-daemon` builds the core first if
	// needed, then the Go daemon — so one target covers both binaries.
	if force || !exists(a.DaemonBin) || !exists(a.IndexBin) {
		if err := makeTarget(c.Repo, "build-daemon", "core + daemon"); err != nil {
			return err
		}
	} else {
		skip("core + daemon")
	}

	// agent/dist (the TUI bundle): `make build-agent` runs npm install + build.
	if force || !exists(a.TUIScript) {
		if err := makeTarget(c.Repo, "build-agent", "agent (TUI)"); err != nil {
			return err
		}
	} else {
		skip("agent (TUI)")
	}

	if c.Vector {
		if err := ensureModel(c); err != nil {
			return err
		}
	}
	return nil
}

func ensureModel(c *config.Config) error {
	if exists(c.EmbedModel) {
		skip("embedding model")
		return nil
	}
	step("downloading embedding model (jina-embeddings-v2-base-code, ~160MB)")
	script := filepath.Join(c.Repo, "scripts", "fetch-model.sh")
	// Download into the launcher-owned model dir (the parent of EmbedModel),
	// which lives under ~/.codeberg rather than the repo.
	dest := filepath.Dir(c.EmbedModel)
	cmd := exec.Command(script, dest)
	cmd.Dir = c.Repo
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

func step(msg string) { fmt.Fprintf(os.Stderr, "› %s\n", msg) }
func skip(label string) { fmt.Fprintf(os.Stderr, "✓ %s already present\n", label) }
