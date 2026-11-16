// Package uninstall reverses what the launcher put on the machine: the
// `codeberg` command on PATH and the assets under ~/.codeberg. It is
// interactive — destructive steps (the ~160MB embedding model, launcher data,
// the shared system ONNX runtime) are confirmed individually and default to No.
package uninstall

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

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

	// 1. Always: remove the `codeberg` command(s) we put on PATH.
	removeCommand(p)

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
		filepath.Join(c.Home, "searxng"),
	)
	if len(leftovers) > 0 {
		if p.confirm(fmt.Sprintf("Remove launcher data (config, index, logs, web search) under %s?", c.Home)) {
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
func removeCommand(p *prompter) {
	self := resolve(selfPath())
	removedAny, foundAny := false, false
	for _, dir := range commandDirs() {
		link := filepath.Join(dir, "codeberg")
		fi, err := os.Lstat(link)
		if err != nil {
			continue
		}
		foundAny = true
		// "Ours": the symlink we installed resolves to this running binary, or the
		// binary itself was installed as a regular file (go build -o .../codeberg).
		mine := false
		if fi.Mode()&os.ModeSymlink != 0 {
			mine = resolve(link) == self
		} else if abs(link) == self {
			mine = true
		}
		// A codeberg that isn't the one we're running from is likely a second or
		// stale install — another checkout's build, or a Homebrew one (prefer
		// `brew uninstall codeberg` for that). Confirm before deleting it; under
		// --yes the confirmation is auto-granted, so `uninstall --yes` clears
		// every codeberg on PATH.
		if !mine && !p.confirm(fmt.Sprintf("Also remove the codeberg command at %s?", link)) {
			fmt.Printf("  left %s in place\n", link)
			continue
		}
		if err := os.Remove(link); err == nil {
			fmt.Printf("✓ removed command %s\n", link)
			removedAny = true
		} else {
			fmt.Printf("  could not remove %s: %v\n", link, err)
		}
	}
	if !removedAny {
		if !foundAny {
			fmt.Println("  no `codeberg` command found on PATH to remove")
		}
		return
	}
	// A just-removed command can linger in the shell's command-location cache, so
	// it may still appear to run until that table is refreshed.
	fmt.Println("  if `codeberg` still runs in this shell, run `hash -r` (bash) / `rehash` (zsh) or open a new shell")
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
