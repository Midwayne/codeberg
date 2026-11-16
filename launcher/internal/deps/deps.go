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
	"fmt"
	"io"
	"os"
	"os/exec"
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
func requirements(onnx bool) []requirement {
	deps := []requirement{
		{label: "git", check: hasBin("git"), brewPkg: "git", aptPkg: "git",
			note: "needed to fetch the tree-sitter submodules"},
		// make/cc come from the Xcode Command Line Tools on macOS (not brew) and
		// from build-essential on Debian/Ubuntu.
		{label: "make", check: hasBin("make"), brewPkg: "", aptPkg: "build-essential",
			note: "C toolchain — on macOS run: xcode-select --install"},
		{label: "cmake", check: hasBin("cmake"), brewPkg: "cmake", aptPkg: "cmake"},
		{label: "go", check: hasBin("go"), brewPkg: "go", aptPkg: "golang-go",
			note: "Go >=1.22 — https://go.dev/dl/"},
		{label: "node", check: hasSupportedNode, brewPkg: "node", aptPkg: "nodejs",
			note: "Node.js 22 or newer with AbortSignal.any — https://nodejs.org/"},
		{label: "npm", check: hasBin("npm"), brewPkg: "node", aptPkg: "npm",
			note: "ships with Node"},
	}

	if onnx {
		deps = append(deps, requirement{label: "onnxruntime", check: OnnxPresent, brewPkg: "onnxruntime", aptPkg: "",
			optional: true,
			note: "powers vector embeddings; without it the core builds chunk-only " +
				"(run with --no-vector). On Linux install a release from " +
				"https://github.com/microsoft/onnxruntime/releases or set ONNXRUNTIME_ROOT"})
	}

	return deps
}

// Ensure verifies the build prerequisites and, unless CODEBERG_SKIP_DEP_INSTALL
// is set, installs the missing ones through the host package manager. It fails
// only when a *required* dependency is still absent afterward; optional ones
// (the ONNX runtime) merely warn.
func Ensure(w io.Writer, onnx bool) error {
	pm := detectPkgManager()
	autoInstall := pm != nil && !truthy(os.Getenv("CODEBERG_SKIP_DEP_INSTALL"))

	var blocking []requirement
	for _, r := range requirements(onnx) {
		if r.check() {
			continue
		}

		if satisfy(w, pm, autoInstall, r) {
			continue
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

// satisfy tries to install a missing requirement and reports whether its
// check passes afterward.
func satisfy(w io.Writer, pm *pkgManager, autoInstall bool, r requirement) bool {
	// An installed but unsupported Node often remains first on PATH even
	// after installing the distro package again. Report its version instead
	// of reinstalling the same (possibly still too old) package.
	if r.label == "node" {
		if _, err := exec.LookPath("node"); err == nil {
			return false
		}
	}

	pkg := r.pkgFor(pm)
	if !autoInstall || pkg == "" {
		return false
	}

	fmt.Fprintf(w, "› installing %s (%s %s)\n", r.label, pm.name, pkg)
	if err := pm.installPkg(w, pkg); err != nil {
		fmt.Fprintf(w, "  %s install failed: %v\n", r.label, err)
	}

	if r.check() {
		fmt.Fprintf(w, "✓ %s installed\n", r.label)
		return true
	}

	fmt.Fprintf(w, "  %s still not detected after install\n", r.label)
	return false
}
