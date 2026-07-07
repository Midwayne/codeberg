package workspace

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSkipDirMatchesCanonicalList(t *testing.T) {
	root := findRepoRoot(t)
	listPath := filepath.Join(root, "configs", "walk_skip_dirs.txt")
	f, err := os.Open(listPath)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	var expected []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		expected = append(expected, line)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if len(expected) == 0 {
		t.Fatal("expected at least one skip dir in canonical list")
	}

	for _, name := range expected {
		if !SkipDir(name) {
			t.Fatalf("SkipDir(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"src", "lib", "README.md", ""} {
		if SkipDir(name) {
			t.Fatalf("SkipDir(%q) = true, want false", name)
		}
	}
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "configs", "walk_skip_dirs.txt")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not find repo root (configs/walk_skip_dirs.txt)")
		}
		dir = parent
	}
}
