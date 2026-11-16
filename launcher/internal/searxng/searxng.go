// Package searxng manages a local, open-source SearXNG instance that backs the
// agent's web_search tool. There is deliberately no vendor and no API key: the
// launcher installs SearXNG into a managed Python venv under the launcher home
// and runs it as a child process whose lifetime is bound to codeberg.
//
// Lifecycle is the whole point of this package. The process is started in its
// own process group and Stop() signals that group, so when codeberg exits (or
// is told to stop) nothing is left running in the background — the same model
// the launcher already uses for the daemon.
//
// Everything here degrades gracefully: if python3 is missing, or the install or
// launch fails, web_search is simply unavailable and the agent's fetch_url tool
// (and the rest of codeberg) keeps working. Callers treat returned errors as
// advisory and continue.
package searxng

import (
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

const repoURL = "https://github.com/searxng/searxng.git"

// readyTimeout bounds how long Start waits for the instance to answer /healthz
// before giving up (and degrading to "web_search unavailable").
const readyTimeout = 30 * time.Second

// layout is the on-disk layout of the managed install under <home>/searxng.
type layout struct {
	base     string // <home>/searxng
	src      string // git checkout
	venv     string // python virtualenv
	settings string // generated settings.yml
	secret   string // persistent secret_key
	ready    string // marker written once deps are installed
}

func layoutFor(home string) layout {
	base := filepath.Join(home, "searxng")
	return layout{
		base:     base,
		src:      filepath.Join(base, "src"),
		venv:     filepath.Join(base, "venv"),
		settings: filepath.Join(base, "settings.yml"),
		secret:   filepath.Join(base, "secret"),
		ready:    filepath.Join(base, ".ready"),
	}
}

func (l layout) python() string { return filepath.Join(l.venv, "bin", "python") }

// hostPython finds a system python to build the venv from.
func hostPython() (string, bool) {
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// Available reports whether SearXNG could be installed here (a host python exists).
func Available() bool { _, ok := hostPython(); return ok }

// Installed reports whether the managed install is complete: the venv and source
// checkout exist AND the dependencies finished installing (the `.ready` marker).
// A half-finished install — e.g. the checkout cloned but `pip install` failed —
// reports false so the next run retries it.
func Installed(home string) bool {
	l := layoutFor(home)
	return fileExists(l.python()) && dirExists(l.src) && fileExists(l.ready)
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir()
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}
