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

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/deps"
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
		return ensurePrebuilt(c, root, force)
	}

	if c.Repo == "" {
		return fmt.Errorf("no source checkout to build from (set CODEBERG_REPO/--repo)")
	}

	if err := buildSource(c, force); err != nil {
		return err
	}

	if err := ensureEmbedding(c, c.Repo, force); err != nil {
		return err
	}

	ensureSearxng(c, force)
	return nil
}

// ensurePrebuilt checks a dist install: the binaries ship ready, so only the
// model and optional services need preparing.
func ensurePrebuilt(c *config.Config, root string, force bool) error {
	skip(c, "prebuilt components")

	if err := ensureEmbedding(c, root, force); err != nil {
		return err
	}

	if c.DbmcpUse {
		bin := c.DbmcpBinary()
		if bin == "" || !exists(bin) {
			fmt.Fprintf(os.Stderr, "⚠ dbmcp binary missing (%s); database MCP tools will be skipped\n", bin)
		}
	}

	ensureSearxng(c, force)
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

func exists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func step(msg string) { fmt.Fprintf(os.Stderr, "› %s\n", msg) }

// skip confirms an existing component. Normal runs stay quiet; --verbose and
// `codeberg build` list every check.
func skip(c *config.Config, label string) {
	if c.Verbose {
		fmt.Fprintf(os.Stderr, "✓ %s already present\n", label)
	}
}
