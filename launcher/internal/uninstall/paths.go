package uninstall

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// commandDirs lists every directory a `codeberg` command could live in. The
// most important source is the live $PATH: if the user can run `codeberg`, it is
// by definition in one of those dirs, so scanning them is what makes uninstall
// actually find the command wherever it was installed (Homebrew's prefix, a
// custom bin dir, …) rather than only a hardcoded few. The extra known dirs
// cover install targets that may not be on the current PATH.
func commandDirs() []string {
	var dirs []string
	if path := os.Getenv("PATH"); path != "" {
		for _, d := range filepath.SplitList(path) {
			if d != "" {
				dirs = append(dirs, d)
			}
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".local", "bin"), filepath.Join(home, "bin"), filepath.Join(home, "go", "bin"))
	}
	// /opt/homebrew/bin is the Apple-Silicon brew prefix (Intel uses /usr/local).
	dirs = append(dirs, "/usr/local/bin", "/opt/homebrew/bin")
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
