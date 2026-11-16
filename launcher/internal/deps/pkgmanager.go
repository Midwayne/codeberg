package deps

import (
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// pkgManager is a host package manager the launcher can drive non-interactively.
type pkgManager struct {
	name    string   // "brew" | "apt-get"
	install []string // argv prefix that installs the packages named after it
}

// detectPkgManager picks the first supported package manager on PATH, or nil.
func detectPkgManager() *pkgManager {
	if p, err := exec.LookPath("brew"); err == nil {
		return &pkgManager{name: "brew", install: []string{p, "install"}}
	}
	if p, err := exec.LookPath("apt-get"); err == nil {
		// apt needs root; prepend sudo when we are not already root and it exists.
		argv := []string{p, "install", "-y"}
		if os.Geteuid() != 0 {
			if s, err := exec.LookPath("sudo"); err == nil {
				argv = append([]string{s}, argv...)
			}
		}
		return &pkgManager{name: "apt-get", install: argv}
	}
	return nil
}

func (pm *pkgManager) installPkg(w io.Writer, pkg string) error {
	argv := append(append([]string{}, pm.install...), pkg)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Stdout = w
	cmd.Stderr = w
	cmd.Stdin = os.Stdin // apt/sudo may prompt for confirmation or a password
	return cmd.Run()
}

// pkgFor returns the package name for r under pm, or "" if pm can't install it.
func (r requirement) pkgFor(pm *pkgManager) string {
	if pm == nil {
		return ""
	}
	switch pm.name {
	case "brew":
		return r.brewPkg
	case "apt-get":
		return r.aptPkg
	}
	return ""
}

// manualInstall returns the command a user could run by hand to get r, honoring
// platform quirks the package managers don't cover (the macOS C toolchain).
func manualInstall(pm *pkgManager, r requirement) string {
	if pkg := r.pkgFor(pm); pkg != "" {
		return strings.Join(append(append([]string{}, pm.install...), pkg), " ")
	}
	if runtime.GOOS == "darwin" && r.label == "make" {
		return "xcode-select --install"
	}
	return ""
}
