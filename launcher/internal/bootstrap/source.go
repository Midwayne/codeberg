package bootstrap

import (
	"fmt"
	"os"
	"path/filepath"

	"codeberg.org/codeberg/launcher/internal/config"
)

// component is one Makefile target of a source checkout.
type component struct {
	label   string
	target  string
	enabled bool // false when the feature is off: neither built nor reported
	needed  bool
	after   func() error // runs after a successful build
}

// sourceComponents lists what a source checkout builds, in build order.
func sourceComponents(c *config.Config, force bool) []component {
	a := config.LocateArtifacts(c.Repo)

	// The React SPA served by codeberg-web.
	webUIIndex := filepath.Join(c.Repo, "agent", "web-ui", "dist", "index.html")

	// The built-in database MCP binary is only built when the user turned it on
	// and did not point CODEBERG_DBMCP_BIN at their own executable.
	builtInDbmcp := c.DbmcpUse && c.DbmcpBin == ""

	return []component{
		{
			// `make build-daemon` builds the core first if needed, then the Go
			// daemon — so one target covers codeberg-d and cberg-index.
			label:   "core + daemon",
			target:  "build-daemon",
			enabled: true,
			needed:  force || !exists(a.DaemonBin) || !exists(a.IndexBin) || needsONNXBuild(c, a.IndexBin),
			after:   func() error { return ensureONNX(c, a.IndexBin, force) },
		},
		{label: "agent", target: "build-agent", enabled: true, needed: force || !exists(a.WebScript)},
		{label: "agent (web UI)", target: "build-web-ui", enabled: true, needed: force || !exists(webUIIndex)},
		{label: "database MCP (dbmcp)", target: "build-dbmcp", enabled: builtInDbmcp, needed: builtInDbmcp && (force || !exists(a.DbmcpBin))},
	}
}

// buildSource builds every missing component of the source checkout.
func buildSource(c *config.Config, force bool) error {
	components := sourceComponents(c, force)

	// Make sure the toolchains/libraries the Makefile shells out to exist (and
	// auto-install the missing ones) before we invoke it — a missing cmake, Go,
	// Node, or ONNX runtime otherwise surfaces as an opaque mid-build failure.
	// Skip the check when nothing needs (re)building: an up-to-date tree already
	// proved the toolchain works, so don't gate a plain run on it.
	if anyNeeded(components) {
		if err := ensureBuildDeps(os.Stderr, c.Vector && c.EmbedBackend == "onnx"); err != nil {
			return err
		}
	}

	for _, comp := range components {
		if err := buildIfNeeded(c, comp); err != nil {
			return err
		}
	}

	if c.DbmcpUse && c.DbmcpBin != "" && !exists(c.DbmcpBin) {
		fmt.Fprintf(os.Stderr, "⚠ CODEBERG_DBMCP_BIN not found (%s); database MCP tools will be skipped\n", c.DbmcpBin)
	}

	return nil
}

func buildIfNeeded(c *config.Config, comp component) error {
	if !comp.enabled {
		return nil
	}

	if !comp.needed {
		skip(c, comp.label)
		return nil
	}

	if err := buildComponent(c.Repo, comp.target, comp.label); err != nil {
		return err
	}

	if comp.after != nil {
		return comp.after()
	}

	return nil
}

func anyNeeded(components []component) bool {
	for _, comp := range components {
		if comp.needed {
			return true
		}
	}

	return false
}
