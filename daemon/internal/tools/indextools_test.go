package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/search"
	"codeberg.org/codeberg/daemon/internal/testutil"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type mockIndexer struct {
	searchOpts  indexctl.SearchOptions
	searchHits  []indexctl.SearchResult
	chunk       indexctl.ChunkDetail
	graphRefs   []indexctl.GraphEdge
	outline     map[string][]indexctl.SearchResult
	traceHops   []indexctl.GraphHop
	graphStats  indexctl.GraphStats
	graphHubs   []indexctl.GraphHub
	searchGraph []indexctl.GraphNode
	lastTrace   indexctl.TracePathOptions
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

func (m *mockIndexer) FileOutline(_ context.Context, _, path string) ([]indexctl.SearchResult, error) {
	if m.outline == nil {
		return nil, nil
	}
	return m.outline[path], nil
}

func (m *mockIndexer) SearchGraph(_ context.Context, opts indexctl.GraphSearchOptions) ([]indexctl.GraphNode, error) {
	if opts.Name == "" {
		return m.searchGraph, nil
	}
	var out []indexctl.GraphNode
	for _, n := range m.searchGraph {
		if n.Name == opts.Name {
			out = append(out, n)
		}
	}
	return out, nil
}

func (m *mockIndexer) TracePath(_ context.Context, opts indexctl.TracePathOptions) ([]indexctl.GraphHop, error) {
	m.lastTrace = opts
	return m.traceHops, nil
}

func (m *mockIndexer) GraphStats(context.Context, string) (indexctl.GraphStats, error) {
	return m.graphStats, nil
}

func (m *mockIndexer) GraphRefs(context.Context, indexctl.GraphRefsOptions) ([]indexctl.GraphEdge, error) {
	return m.graphRefs, nil
}

func (m *mockIndexer) GraphHubs(context.Context, indexctl.GraphHubsOptions) ([]indexctl.GraphHub, error) {
	return m.graphHubs, nil
}

func TestGetChunkTool(t *testing.T) {
	idx := &testutil.FakeIndexer{
		Chunk: indexctl.ChunkDetail{ID: 7, Repo: "main", Path: "a.go", Body: "func main(){}"},
	}
	root := t.TempDir()
	reg := Default(testutil.WsSingle(root), idx)

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
	idx := &testutil.FakeIndexer{
		SearchHits: []indexctl.SearchResult{
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

	reg := Default(testutil.WsSingle(root), idx)
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
	if idx.GotSearch.K != 2 {
		t.Fatalf("hybrid fetches 2*k candidates, got K=%d", idx.GotSearch.K)
	}
}

func TestHybridSearchFindsLexicalOnlyFile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/exact.go", []byte("package main\nfunc checkoutSessionToken() {}\nfunc companion() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx := &testutil.FakeIndexer{SearchHits: []indexctl.SearchResult{{ID: 1, Repo: "main", Path: "unrelated.go", Score: .9}}}
	reg := Default(testutil.WsSingle(root), idx)
	out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"where is checkoutSessionToken used?","k":2}`))
	if err != nil {
		t.Fatal(err)
	}
	hits := out.([]search.HybridHit)
	if len(hits) != 2 || hits[0].Hit.Path != "exact.go" || hits[0].Hit.StartLine != 2 || hits[0].Hit.ID != 0 {
		t.Fatalf("expected lexical-only file missed by vector search: %+v", hits)
	}
	if hits[0].ContextStartLine != 1 || !strings.Contains(hits[0].Context, "func companion()") {
		t.Fatalf("lexical hit should carry nearby context without an extra tool call: %+v", hits[0])
	}
}

func TestHybridSearchWorksWithoutVectors(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/exact.go", []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx := &testutil.FakeIndexer{SearchErr: &indexctl.IndexerError{Code: "NOT_IMPLEMENTED", Message: "not implemented"}}
	reg := Default(testutil.WsSingle(root), idx)
	out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken"}`))
	if err != nil {
		t.Fatal(err)
	}
	hits := out.([]search.HybridHit)
	if len(hits) != 1 || hits[0].Hit.Path != "exact.go" || hits[0].Hit.ID != 0 {
		t.Fatalf("lexical fallback: %+v", hits)
	}
}

func TestHybridSearchScopesLexicalCandidates(t *testing.T) {
	alpha, beta := t.TempDir(), t.TempDir()
	for _, root := range []string{alpha, beta} {
		if err := os.Mkdir(root+"/api", 0o755); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/api/match.go", "/other.go"} {
			if err := os.WriteFile(root+path, []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
	}
	ws := workspace.New([]workspace.RepoInfo{{Key: "alpha", Root: alpha}, {Key: "beta", Root: beta}}, "")
	reg := Default(ws, &testutil.FakeIndexer{})
	out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken","repo":"beta","path_glob":"api/*.go"}`))
	if err != nil {
		t.Fatal(err)
	}
	hits := out.([]search.HybridHit)
	if len(hits) != 1 || hits[0].Hit.Repo != "beta" || hits[0].Hit.Path != "api/match.go" {
		t.Fatalf("repo and path glob should apply to lexical branch: %+v", hits)
	}
}

func TestHybridSearchDoesNotStarveLaterRepos(t *testing.T) {
	alpha, beta := t.TempDir(), t.TempDir()
	for i := 0; i < 65; i++ {
		path := filepath.Join(alpha, fmt.Sprintf("file%03d.go", i))
		if err := os.WriteFile(path, []byte("checkoutSessionToken\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(beta, "exact.go"), []byte("checkoutSessionToken\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	ws := workspace.New([]workspace.RepoInfo{{Key: "alpha", Root: alpha}, {Key: "beta", Root: beta}}, "")
	reg := Default(ws, &testutil.FakeIndexer{})
	out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken","k":64}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, hit := range out.([]search.HybridHit) {
		if hit.Hit.Repo == "beta" {
			return
		}
	}
	t.Fatalf("lexical search should include later repos within the candidate budget")
}

func TestHybridSearchKindFiltersLexicalCandidates(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/exact.go", []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx := &testutil.FakeIndexer{
		OutlineHits: []indexctl.SearchResult{{ID: 9, Repo: "main", Path: "exact.go", StartLine: 1, EndLine: 1}},
		Chunk:       indexctl.ChunkDetail{Kind: "function"},
	}
	reg := Default(testutil.WsSingle(root), idx)
	for _, tc := range []struct {
		kind string
		want int
	}{{"method", 0}, {"function", 1}} {
		out, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken","kind":"`+tc.kind+`"}`))
		if err != nil {
			t.Fatal(err)
		}
		if got := len(out.([]search.HybridHit)); got != tc.want {
			t.Fatalf("kind %q: got %d want %d", tc.kind, got, tc.want)
		}
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

	reg := Default(testutil.WsSingle(root), &testutil.FakeIndexer{})
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
