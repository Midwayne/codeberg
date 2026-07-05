package tools

import (
	"context"
	"encoding/json"
	"slices"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type stubIndexer struct{}

func (stubIndexer) Search(context.Context, indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}
func (stubIndexer) GetChunk(context.Context, string, uint64) (indexctl.ChunkDetail, error) {
	return indexctl.ChunkDetail{}, nil
}
func (stubIndexer) FindSymbol(context.Context, indexctl.SymbolOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}
func (stubIndexer) FileOutline(context.Context, string, string) ([]indexctl.SearchResult, error) {
	return nil, nil
}

// wsSingle builds a one-repo workspace the way single-root mode does: the
// repo's key doubles as the default, so tools may omit `repo`.
func wsSingle(root string) *workspace.Workspace {
	return workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main")
}

func TestDefaultRegistry(t *testing.T) {
	reg := Default(wsSingle(t.TempDir()), stubIndexer{})
	names := make([]string, len(reg.List()))
	for i, sp := range reg.List() {
		names[i] = sp.Name
	}
	want := []string{
		"repos", "search", "get_chunk", "find_symbol", "file_outline", "hybrid_search", "find_references",
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
	reg := Default(ws, stubIndexer{})

	out, err := reg.Call(context.Background(), "repos", json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	repos, ok := out.([]workspace.RepoInfo)
	if !ok || len(repos) != 2 || repos[0].Key != "alpha" || repos[1].Key != "beta" {
		t.Fatalf("repos: %+v", out)
	}
}
