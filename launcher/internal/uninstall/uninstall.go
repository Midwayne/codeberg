// Package uninstall reverses what the launcher put on the machine: the
// `codeberg` command on PATH and the assets under ~/.codeberg. It is
// interactive — destructive steps (the ~160MB embedding model, launcher data,
// the shared system ONNX runtime) are confirmed individually and default to No.
package uninstall

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/launcher/internal/config"
)

// Options controls prompting.
type Options struct {
	AssumeYes bool // skip prompts, answer yes for the launcher's OWN assets
	// RemoveSystemONNX opts in to removing the shared system ONNX runtime.
	// AssumeYes deliberately does NOT cover it — a scripted data cleanup must
	// not silently uninstall a system package other tools may depend on.
	RemoveSystemONNX bool
}

// Run performs the uninstall against the resolved config.
func Run(c *config.Config, o Options) error {
	p := &prompter{r: bufio.NewReader(os.Stdin), assumeYes: o.AssumeYes}

	// 1. Always: remove the `codeberg` command we put on PATH.
	removeCommand()

	// 2. The embedding model + ONNX weights the launcher downloaded.
	modelDir := filepath.Dir(c.EmbedModel)
	if under(modelDir, c.Home) && dirExists(modelDir) {
		if p.confirm(fmt.Sprintf("Remove the embedding model and ONNX weights at %s (~160MB)?", modelDir)) {
			removePath(modelDir, "embedding model")
			_ = os.Remove(filepath.Dir(modelDir)) // drop now-empty models/ parent
		} else {
			fmt.Printf("  kept %s\n", modelDir)
		}
	} else if dirExists(modelDir) {
		// A user-pointed model outside the managed home — don't touch it.
		fmt.Printf("  note: embedding model is outside %s (%s); left untouched\n", c.Home, modelDir)
	}

	// 3. The rest of the launcher's managed data.
	leftovers := existing(
		c.ConfigPath,
		filepath.Join(c.Home, "index"),
		filepath.Join(c.Home, "logs"),
	)
	if len(leftovers) > 0 {
		if p.confirm(fmt.Sprintf("Remove launcher data (config, index, logs) under %s?", c.Home)) {
			for _, path := range leftovers {
				removePath(path, filepath.Base(path))
			}
		} else {
			fmt.Printf("  kept launcher data under %s\n", c.Home)
		}
	}
	// Tidy up the home dir if it ended up empty.
	if isEmptyDir(c.Home) {
		_ = os.Remove(c.Home)
	}

	// 4. The system ONNX runtime — shared, not installed by us. Ask, default No,
	//    and remove via brew rather than deleting a system library by hand.
	offerSystemONNX(p, o.RemoveSystemONNX)

	fmt.Println("\nDone. The source checkout and its build artifacts (core/build, agent/dist)\nwere left intact — remove them with `make clean` if you want.")
	return nil
}

// removeCommand deletes the `codeberg` symlink/binary we installed onto PATH,
// only when it actually points at (or is) this executable.
func removeCommand() {
	self := resolve(selfPath())
	found := false
	for _, dir := range commandDirs() {
		link := filepath.Join(dir, "codeberg")
		fi, err := os.Lstat(link)
		if err != nil {
			continue
		}
		// A symlink we created -> resolves to our binary; or the binary itself
		// installed as a regular file (go build -o .../bin/codeberg).
		mine := false
		if fi.Mode()&os.ModeSymlink != 0 {
			mine = resolve(link) == self
		} else if abs(link) == self {
			mine = true
		}
		if mine {
			if err := os.Remove(link); err == nil {
				fmt.Printf("✓ removed command %s\n", link)
				found = true
			} else {
				fmt.Printf("  could not remove %s: %v\n", link, err)
			}
		}
	}
	if !found {
		fmt.Println("  no `codeberg` command found on PATH to remove (binary left in place)")
	}
}

func offerSystemONNX(p *prompter, force bool) {
	brew, err := exec.LookPath("brew")
	if err != nil {
		return // not a Homebrew machine; the runtime is system-managed elsewhere
	}
	if exec.Command(brew, "list", "onnxruntime").Run() != nil {
		return // not installed via brew
	}
	fmt.Println("\nThe ONNX runtime is a shared system package (Homebrew 'onnxruntime') that the")
	fmt.Println("launcher did not install; the core needs it to rebuild and other tools may use it.")

	remove := force
	if !force {
		// This decision is independent of --yes: removing a shared system
		// package requires either an interactive yes or the explicit flag.
		if !stdinIsTTY() {
			fmt.Println("  kept system ONNX runtime (pass --remove-system-onnx to remove it)")
			return
		}
		fmt.Print("Uninstall the system ONNX runtime (brew uninstall onnxruntime)? [y/N] ")
		line, _ := p.r.ReadString('\n')
		remove = isYes(line)
	}
	if !remove {
		fmt.Println("  kept system ONNX runtime")
		return
	}
	cmd := exec.Command(brew, "uninstall", "onnxruntime")
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Printf("  brew uninstall failed: %v\n", err)
	}
}

// --- prompting --------------------------------------------------------------

type prompter struct {
	r         *bufio.Reader
	assumeYes bool
}

func (p *prompter) confirm(question string) bool {
	if p.assumeYes {
		fmt.Printf("%s [y/N] y (--yes)\n", question)
		return true
	}
	if !stdinIsTTY() {
		fmt.Printf("%s [y/N] n (non-interactive)\n", question)
		return false
	}
	fmt.Printf("%s [y/N] ", question)
	line, _ := p.r.ReadString('\n')
	return isYes(line)
}

func isYes(line string) bool {
	switch strings.ToLower(strings.TrimSpace(line)) {
	case "y", "yes":
		return true
	}
	return false
}

func stdinIsTTY() bool {
	fi, err := os.Stdin.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// --- path helpers -----------------------------------------------------------

func commandDirs() []string {
	var dirs []string
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".local", "bin"), filepath.Join(home, "bin"), filepath.Join(home, "go", "bin"))
	}
	dirs = append(dirs, "/usr/local/bin")
	if gobin := goEnv("GOBIN"); gobin != "" {
		dirs = append(dirs, gobin)
	}
	if gopath := goEnv("GOPATH"); gopath != "" {
		dirs = append(dirs, filepath.Join(gopath, "bin"))
	}
	return dedup(dirs)
}

func goEnv(key string) string {
	out, err := exec.Command("go", "env", key).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func selfPath() string {
	if exe, err := os.Executable(); err == nil {
		return exe
	}
	return ""
}

func resolve(p string) string {
	if p == "" {
		return ""
	}
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return abs(p)
}

func abs(p string) string {
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

// under reports whether path is inside dir.
func under(path, dir string) bool {
	rel, err := filepath.Rel(abs(dir), abs(path))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func removePath(path, label string) {
	if err := os.RemoveAll(path); err != nil {
		fmt.Printf("  could not remove %s (%s): %v\n", label, path, err)
		return
	}
	fmt.Printf("✓ removed %s (%s)\n", label, path)
}

func existing(paths ...string) []string {
	var out []string
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}

func dirExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}

func isEmptyDir(p string) bool {
	f, err := os.Open(p)
	if err != nil {
		return false
	}
	defer f.Close()
	_, err = f.Readdirnames(1)
	return err == io.EOF
}

func dedup(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
