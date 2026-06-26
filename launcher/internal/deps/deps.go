// Package deps makes the build's system prerequisites a first-class, self-
// healing step instead of a cryptic `make` failure halfway through a first run.
//
// Building the stack needs more than the source checkout: a C toolchain and
// CMake for the core, Go for the daemon, Node/npm for the agent, git for the
// tree-sitter submodules, and the ONNX Runtime library for vector embeddings.
// When any are missing, `make` fails deep in a configure step with output that
// rarely names the actual missing package. Here we check each up front and,
// when a host package manager is available (Homebrew on macOS, apt on Linux),
// install the missing ones automatically. Required deps that still can't be
// satisfied produce one clear error listing exactly what to install; optional
// ones (the ONNX runtime) only warn, since the core still builds chunk-only.
//
// Set CODEBERG_SKIP_DEP_INSTALL=1 to check-and-report without installing.
package deps

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// requirement is one external dependency plus where to obtain it per platform.
type requirement struct {
	label    string      // name shown to the user, e.g. "cmake"
	check    func() bool // already satisfied?
	brewPkg  string      // Homebrew formula ("" = not installable via brew)
	aptPkg   string      // apt package ("" = not installable via apt)
	optional bool        // missing => warn and continue, don't fail the build
	note     string      // extra guidance when we can't auto-install it
}

// requirements lists everything `make build-daemon` + `make build-agent` need.
func requirements() []requirement {
	return []requirement{
		{label: "git", check: hasBin("git"), brewPkg: "git", aptPkg: "git",
			note: "needed to fetch the tree-sitter submodules"},
		// make/cc come from the Xcode Command Line Tools on macOS (not brew) and
		// from build-essential on Debian/Ubuntu.
		{label: "make", check: hasBin("make"), brewPkg: "", aptPkg: "build-essential",
			note: "C toolchain — on macOS run: xcode-select --install"},
		{label: "cmake", check: hasBin("cmake"), brewPkg: "cmake", aptPkg: "cmake"},
		{label: "go", check: hasBin("go"), brewPkg: "go", aptPkg: "golang-go",
			note: "Go >=1.22 — https://go.dev/dl/"},
		{label: "node", check: hasBin("node"), brewPkg: "node", aptPkg: "nodejs",
			note: "Node >=22 — https://nodejs.org/"},
		{label: "npm", check: hasBin("npm"), brewPkg: "node", aptPkg: "npm",
			note: "ships with Node"},
		{label: "onnxruntime", check: OnnxPresent, brewPkg: "onnxruntime", aptPkg: "",
			optional: true,
			note: "powers vector embeddings; without it the core builds chunk-only " +
				"(run with --no-vector). On Linux install a release from " +
				"https://github.com/microsoft/onnxruntime/releases or set ONNXRUNTIME_ROOT"},
	}
}

// Ensure verifies the build prerequisites and, unless CODEBERG_SKIP_DEP_INSTALL
// is set, installs the missing ones through the host package manager. It fails
// only when a *required* dependency is still absent afterward; optional ones
// (the ONNX runtime) merely warn.
func Ensure(w io.Writer) error {
	pm := detectPkgManager()
	autoInstall := pm != nil && !truthy(os.Getenv("CODEBERG_SKIP_DEP_INSTALL"))

	var blocking []requirement
	for _, r := range requirements() {
		if r.check() {
			continue
		}
		if pkg := r.pkgFor(pm); autoInstall && pkg != "" {
			fmt.Fprintf(w, "› installing %s (%s %s)\n", r.label, pm.name, pkg)
			if err := pm.installPkg(w, pkg); err != nil {
				fmt.Fprintf(w, "  %s install failed: %v\n", r.label, err)
			}
			if r.check() {
				fmt.Fprintf(w, "✓ %s installed\n", r.label)
				continue
			}
			fmt.Fprintf(w, "  %s still not detected after install\n", r.label)
		}
		// Still missing: couldn't or wouldn't install, or the install didn't
		// satisfy the check (e.g. a shell that hasn't refreshed PATH).
		if r.optional {
			warnMissing(w, r)
		} else {
			blocking = append(blocking, r)
		}
	}
	if len(blocking) > 0 {
		return blockingErr(pm, autoInstall, blocking)
	}
	return nil
}

// OnnxPresent reports whether the ONNX Runtime C headers are installed where
// core/CMakeLists.txt looks for them — i.e. whether a build will enable
// embedding. It mirrors that file's search paths so doctor and the build agree.
func OnnxPresent() bool {
	hints := []string{
		os.Getenv("ONNXRUNTIME_ROOT"),
		"/opt/homebrew/opt/onnxruntime",
		"/usr/local",
		"/opt/homebrew",
		"/usr",
	}
	for _, h := range hints {
		if h == "" {
			continue
		}
		for _, suffix := range []string{"include/onnxruntime", "include"} {
			if fileExists(filepath.Join(h, suffix, "onnxruntime_c_api.h")) {
				return true
			}
		}
	}
	return false
}

// --- package managers --------------------------------------------------------

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

// --- reporting ---------------------------------------------------------------

func warnMissing(w io.Writer, r requirement) {
	msg := "⚠ " + r.label + " not found"
	if r.note != "" {
		msg += " — " + r.note
	}
	fmt.Fprintln(w, msg)
}

func blockingErr(pm *pkgManager, autoInstall bool, missing []requirement) error {
	var b strings.Builder
	b.WriteString("missing build prerequisites:\n")
	for _, r := range missing {
		fmt.Fprintf(&b, "  • %s", r.label)
		if cmd := manualInstall(pm, r); cmd != "" {
			fmt.Fprintf(&b, " — install with: %s", cmd)
		} else if r.note != "" {
			fmt.Fprintf(&b, " — %s", r.note)
		}
		b.WriteByte('\n')
	}
	switch {
	case pm == nil:
		b.WriteString("no supported package manager (brew/apt-get) found to auto-install them")
	case !autoInstall:
		b.WriteString("auto-install is off (CODEBERG_SKIP_DEP_INSTALL); install the above and re-run")
	default:
		b.WriteString("auto-install could not satisfy them; install manually and re-run")
	}
	return errors.New(b.String())
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

// --- small helpers -----------------------------------------------------------

func hasBin(name string) func() bool {
	return func() bool { _, err := exec.LookPath(name); return err == nil }
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func truthy(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}
