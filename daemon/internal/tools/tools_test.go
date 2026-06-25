package tools

import (
	"slices"
	"testing"

	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestDefaultRegistry(t *testing.T) {
	reg := Default(workspace.New(t.TempDir()))
	names := make([]string, len(reg.List()))
	for i, sp := range reg.List() {
		names[i] = sp.Name
	}
	want := []string{"grep", "glob", "read_file", "list_dir", "tree", "head", "tail", "wc", "sed", "pipe", "git_log", "git_blame"}
	for _, name := range want {
		if !slices.Contains(names, name) {
			t.Fatalf("missing tool %q in %v", name, names)
		}
	}
}
