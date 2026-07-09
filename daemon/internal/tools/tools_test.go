package tools

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"codeberg.org/codeberg/daemon/internal/testutil"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestDefaultRegistry(t *testing.T) {
	reg := Default(testutil.WsSingle(t.TempDir()), testutil.StubIndexer{})
	names := make([]string, len(reg.List()))
	for i, sp := range reg.List() {
		names[i] = sp.Name
	}
	want := []string{
		"repos", "search", "get_chunk", "find_symbol", "file_outline", "hybrid_search",
		"search_graph", "trace_path", "detect_changes", "get_architecture", "find_references",
		"grep", "glob", "read_file", "list_dir", "tree", "head", "tail", "wc", "sed", "pipe", "git_log", "git_blame",
	}
	for _, name := range want {
		if !slices.Contains(names, name) {
			t.Fatalf("missing tool %q in %v", name, names)
		}
	}
}

func TestReposTool(t *testing.T) {
	rootA, rootB := t.TempDir(), t.TempDir()
	ws := workspace.New([]workspace.RepoInfo{
		{Key: "alpha", Root: rootA},
		{Key: "beta", Root: rootB},
	}, "")
	reg := Default(ws, testutil.StubIndexer{})

	out, err := reg.Call(context.Background(), "repos", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	repos, ok := out.([]workspace.RepoInfo)
	if !ok || len(repos) != 2 || repos[0].Key != "alpha" || repos[1].Key != "beta" {
		t.Fatalf("repos: %+v", out)
	}
}

func wsSingle(root string) *workspace.Workspace {
	return testutil.WsSingle(root)
}
