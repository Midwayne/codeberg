package config

import (
	"os"
	"path/filepath"
)

// Artifacts are the on-disk products the launcher runs, under some root — a
// source checkout's build tree or an installed dist dir laid out the same way.
type Artifacts struct {
	DaemonBin      string // <root>/core/build/bin/codeberg-d
	IndexBin       string // <root>/core/build/bin/cberg-index (daemon finds it as a sibling)
	WebScript      string // <root>/agent/dist/web.js (browser-UI server)
	LearningScript string // <root>/agent/dist/learning-cli.js (offline learning inspection/export)
	DbmcpBin       string // <root>/build/dbmcp (built-in multi-db MCP server; optional)
}

// LocateArtifacts returns the expected artifact paths under root (no existence
// check). The dist layout deliberately mirrors these subpaths so an installed
// tree and a source checkout are interchangeable here.
func LocateArtifacts(root string) Artifacts {
	bin := filepath.Join(root, "core", "build", "bin")
	return Artifacts{
		DaemonBin:      filepath.Join(bin, "codeberg-d"),
		IndexBin:       filepath.Join(bin, "cberg-index"),
		WebScript:      filepath.Join(root, "agent", "dist", "web.js"),
		LearningScript: filepath.Join(root, "agent", "dist", "learning-cli.js"),
		DbmcpBin:       filepath.Join(root, "build", "dbmcp"),
	}
}

// autodetectDist finds a prebuilt payload installed alongside the launcher
// binary, so a relocatable package works wherever it lands without a baked-in
// path. The install layout is `<root>/bin/codeberg` next to
// `<root>/libexec/<payload>`, so from the resolved binary the payload is at
// `../libexec`. Returns "" unless that dir actually holds the artifacts — so a
// plain `go build` of the launcher (no sibling libexec) falls through to source.
func autodetectDist() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if r, err := filepath.EvalSymlinks(exe); err == nil {
		exe = r // installed as a symlink onto PATH -> resolve to the real binary
	}
	cand := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", "libexec"))
	a := LocateArtifacts(cand)
	if fileExists(a.DaemonBin) && fileExists(a.IndexBin) && fileExists(a.WebScript) {
		return cand
	}
	return ""
}

// ResolveRoot picks the directory the launcher locates binaries and the agent
// under, and reports whether it is a prebuilt install (so no build is needed).
// A populated Dist wins — its three artifacts must all exist — otherwise we fall
// back to the source checkout (Repo), which may itself be "" if none was found.
func (c *Config) ResolveRoot() (root string, prebuilt bool) {
	if c.Dist != "" {
		a := LocateArtifacts(c.Dist)
		if fileExists(a.DaemonBin) && fileExists(a.IndexBin) && fileExists(a.WebScript) {
			return c.Dist, true
		}
	}
	return c.Repo, false
}

// DbmcpBinary is the dbmcp executable: an explicit CODEBERG_DBMCP_BIN, otherwise
// <root>/build/dbmcp when a checkout or prebuilt root is known.
func (c *Config) DbmcpBinary() string {
	if c.DbmcpBin != "" {
		return c.DbmcpBin
	}
	if root, _ := c.ResolveRoot(); root != "" {
		return LocateArtifacts(root).DbmcpBin
	}
	return ""
}

// DbmcpSpecFile is the spec the built-in database server should load.
// found is false when the preferred path is not on disk yet.
func (c *Config) DbmcpSpecFile() (path string, found bool) {
	if c.DbmcpSpec != "" {
		return c.DbmcpSpec, fileExists(c.DbmcpSpec)
	}
	for _, name := range []string{"spec.yml", "spec.yaml"} {
		p := filepath.Join(c.Home, name)
		if fileExists(p) {
			return p, true
		}
	}
	return filepath.Join(c.Home, "spec.yml"), false
}
