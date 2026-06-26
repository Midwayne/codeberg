// Package paths locates the two directories the launcher needs: the source
// checkout it builds and runs (the "repo"), and the managed home directory
// (~/.codeberg) where it keeps config, the embedding model, the index, and logs.
//
// The launcher is deliberately decoupled from core/daemon/agent: it never
// imports their code, it only finds their files on disk and runs them.
package paths

import (
	"os"
	"path/filepath"
)

// repoMarkers are the files/dirs that, together, identify a codeberg source
// checkout. We require all of them so a random parent directory cannot be
// mistaken for the repo.
var repoMarkers = []string{
	"Makefile",
	"core",
	"daemon",
	"agent",
	filepath.Join("scripts", "fetch-model.sh"),
}

// IsRepo reports whether dir looks like a codeberg source checkout.
func IsRepo(dir string) bool {
	for _, m := range repoMarkers {
		if _, err := os.Stat(filepath.Join(dir, m)); err != nil {
			return false
		}
	}
	return true
}

// FindRepo walks up from each start directory looking for a codeberg checkout.
// It searches the current working directory and the launcher binary's own
// directory, so `codeberg` works both from inside the tree and when installed
// on PATH next to (or above) the checkout. Returns "" if none is found.
func FindRepo(override string) string {
	if override != "" {
		if IsRepo(override) {
			return override
		}
		return ""
	}
	var starts []string
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	if exe, err := os.Executable(); err == nil {
		starts = append(starts, filepath.Dir(exe))
	}
	for _, start := range starts {
		if r := walkUp(start); r != "" {
			return r
		}
	}
	return ""
}

func walkUp(dir string) string {
	for {
		if IsRepo(dir) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// Home is the managed directory for launcher-owned state. Override with
// CODEBERG_HOME; defaults to ~/.codeberg (mirrors ~/.claude).
func Home(override string) string {
	if override != "" {
		return override
	}
	if v := os.Getenv("CODEBERG_HOME"); v != "" {
		return v
	}
	if h, err := os.UserHomeDir(); err == nil {
		return filepath.Join(h, ".codeberg")
	}
	return ".codeberg"
}

// ConfigFile is the KEY=VALUE config file inside Home.
func ConfigFile(home string) string {
	return filepath.Join(home, "config")
}
