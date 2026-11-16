package deps

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
)

// EnsurePython makes sure a python3 **with a working pip** is available for the
// SearXNG web-search backend, auto-installing what's missing via the host
// package manager when possible. It is intentionally separate from Ensure (the
// build prerequisites): web search is an optional runtime feature, so callers
// treat a returned error as advisory and degrade gracefully (web_search off,
// everything else on).
func EnsurePython(w io.Writer) error {
	pm := detectPkgManager()
	skipInstall := pm == nil || truthy(os.Getenv("CODEBERG_SKIP_DEP_INSTALL"))

	py, err := ensurePythonBin(w, pm, skipInstall)
	if err != nil {
		return err
	}

	return ensurePip(w, pm, skipInstall, py)
}

// ensurePythonBin returns the python interpreter, installing one if needed.
func ensurePythonBin(w io.Writer, pm *pkgManager, skipInstall bool) (string, error) {
	if py, ok := pythonBin(); ok {
		return py, nil
	}

	if skipInstall {
		return "", errors.New("python3 not found — install Python 3 (with venv and pip) to enable web_search")
	}

	pkg := "python3"
	switch pm.name {
	case "brew":
		pkg = "python"
	case "apt-get":
		pkg = "python3-venv" // pulls python3 and the venv module Debian splits out
	}

	fmt.Fprintf(w, "› installing python3 (%s %s) for web_search\n", pm.name, pkg)
	if err := pm.installPkg(w, pkg); err != nil {
		return "", fmt.Errorf("python3 install failed: %w", err)
	}

	py, ok := pythonBin()
	if !ok {
		return "", errors.New("python3 still not detected after install")
	}

	return py, nil
}

// ensurePip makes sure py can run pip.
//
// SearXNG's managed install runs `python3 -m venv` then `pip install` inside
// it (launcher/internal/searxng). Debian/Ubuntu strip pip's bundled wheels
// from the base python3 package, so `ensurepip` — and therefore every venv
// it creates — has no pip until `python3-pip` is installed system-wide too;
// `python3-venv` alone is not sufficient. Homebrew's python formula bundles
// pip, so this path is apt-only in practice.
func ensurePip(w io.Writer, pm *pkgManager, skipInstall bool, py string) error {
	if hasPip(py) {
		return nil
	}

	if skipInstall || pm.name != "apt-get" {
		return fmt.Errorf("pip not available for %s — install python3-pip to enable web_search", py)
	}

	fmt.Fprintf(w, "› installing python3-pip (%s) for web_search\n", pm.name)
	if err := pm.installPkg(w, "python3-pip"); err != nil {
		return fmt.Errorf("python3-pip install failed: %w", err)
	}

	if !hasPip(py) {
		return errors.New("pip still not available after installing python3-pip")
	}

	return nil
}

// pythonBin locates a system python3 (preferred) or python interpreter.
func pythonBin() (string, bool) {
	for _, name := range []string{"python3", "python"} {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
	}
	return "", false
}

// hasPip reports whether py's pip module is usable — the actual thing a venv
// created from it needs, which a bare `python3` binary check doesn't confirm.
func hasPip(py string) bool {
	return exec.Command(py, "-m", "pip", "--version").Run() == nil
}
