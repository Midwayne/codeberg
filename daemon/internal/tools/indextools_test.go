package tools

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type mockIndexer struct {
	searchOpts indexctl.SearchOptions
	searchHits []indexctl.SearchResult
	chunk      indexctl.ChunkDetail
	graphRefs  []indexctl.GraphEdge
}

func (m *mockIndexer) Status(context.Context) (indexctl.Status, error) {
	return indexctl.Status{Ready: true, VectorsEnabled: true}, nil
}

func (m *mockIndexer) Search(_ context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	m.searchOpts = opts
	return m.searchHits, nil
}

func (m *mockIndexer) GetChunk(context.Context, string, uint64) (indexctl.ChunkDetail, error) {
	return m.chunk, nil
}

func (m *mockIndexer) FindSymbol(context.Context, indexctl.SymbolOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (m *mockIndexer) FileOutline(context.Context, string, string) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (m *mockIndexer) SearchGraph(context.Context, indexctl.GraphSearchOptions) ([]indexctl.GraphNode, error) {
	return nil, nil
}

func (m *mockIndexer) TracePath(context.Context, indexctl.TracePathOptions) ([]indexctl.GraphHop, error) {
	return nil, nil
}

func (m *mockIndexer) GraphStats(context.Context, string) (indexctl.GraphStats, error) {
	return indexctl.GraphStats{}, nil
}

func (m *mockIndexer) GraphRefs(context.Context, indexctl.GraphRefsOptions) ([]indexctl.GraphEdge, error) {
	return m.graphRefs, nil
}

func TestGetChunkTool(t *testing.T) {
	idx := &mockIndexer{chunk: indexctl.ChunkDetail{ID: 7, Repo: "main", Path: "a.go", Body: "func main(){}"}}
	root := t.TempDir()
	reg := Default(workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main"), idx)

	out, err := reg.Call(context.Background(), "get_chunk", json.RawMessage(`{"repo":"main","id":7}`))
	if err != nil {
		t.Fatal(err)
	}
	detail, ok := out.(indexctl.ChunkDetail)
	if !ok || detail.ID != 7 || detail.Body != "func main(){}" {
		t.Fatalf("get_chunk: %+v", out)
	}
}

func TestHybridSearchTool(t *testing.T) {
	idx := &mockIndexer{
		searchHits: []indexctl.SearchResult{
			{ID: 1, Score: 0.9, Repo: "main", Path: "low.go"},
			{ID: 2, Score: 0.85, Repo: "main", Path: "high.go"},
		},
	}
	root := t.TempDir()
	if err := os.WriteFile(root+"/low.go", []byte("package main\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/high.go", []byte("package main\n// authentication handler\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	reg := Default(workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main"), idx)
	out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"authentication handler","k":1}`))
	if err != nil {
		t.Fatal(err)
	}

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	var decoded []struct {
		Hit indexctl.SearchResult `json:"hit"`
	}
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("hybrid output: %v", err)
	}
	if len(decoded) != 1 || decoded[0].Hit.Path != "high.go" {
		t.Fatalf("hybrid rerank: %+v", decoded)
	}
	if idx.searchOpts.K != 2 {
		t.Fatalf("hybrid fetches 2*k candidates, got K=%d", idx.searchOpts.K)
	}
}

func TestFindReferencesTool(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/use.go", []byte("package main\nfunc Foo() {}\nfunc FooBar() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(root+"/skip.go", []byte("package main\n// Fooish comment only\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	reg := Default(workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main"), &mockIndexer{})
	out, err := reg.Call(context.Background(), "find_references", json.RawMessage(`{"symbol":"Foo","repo":"main"}`))
	if err != nil {
		t.Fatal(err)
	}
	res, ok := out.(findReferencesResult)
	if !ok {
		t.Fatalf("find_references type: %T", out)
	}
	if res.Source != "grep" || len(res.Matches) != 1 || res.Matches[0].Path != "use.go" {
		t.Fatalf("word-boundary refs: %+v", res)
	}
}

func TestFindReferencesGraphFirst(t *testing.T) {
	idx := &mockIndexer{}
	idx.graphRefs = []indexctl.GraphEdge{{
		Src: 1, Dst: 2, Kind: "calls", Resolution: "textual", Confidence: 0.9,
		SrcName: "caller", DstName: "Foo", SrcPath: "a.go", Line: 10,
	}}
	root := t.TempDir()
	reg := Default(workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main"), idx)
	out, err := reg.Call(context.Background(), "find_references", json.RawMessage(`{"symbol":"Foo","repo":"main"}`))
	if err != nil {
		t.Fatal(err)
	}
	res, ok := out.(findReferencesResult)
	if !ok || res.Source != "graph" || len(res.Graph) != 1 || res.Graph[0].SrcName != "caller" {
		t.Fatalf("graph-first refs: %+v", out)
	}
}
