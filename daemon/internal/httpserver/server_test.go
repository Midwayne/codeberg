package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/testutil"
	"codeberg.org/codeberg/daemon/internal/tools"
)

type fakeIndexer struct {
	status  indexctl.Status
	hits    []indexctl.SearchResult
	gotOpts indexctl.SearchOptions
	getChunk func(context.Context, string, uint64) (indexctl.ChunkDetail, error)
}

func (f *fakeIndexer) Status(context.Context) (indexctl.Status, error) {
	return f.status, nil
}

func (f *fakeIndexer) Search(_ context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	f.gotOpts = opts
	return f.hits, nil
}

func (f *fakeIndexer) GetChunk(ctx context.Context, repo string, id uint64) (indexctl.ChunkDetail, error) {
	if f.getChunk != nil {
		return f.getChunk(ctx, repo, id)
	}
	return indexctl.ChunkDetail{}, nil
}

func (f *fakeIndexer) FindSymbol(context.Context, indexctl.SymbolOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (f *fakeIndexer) FileOutline(context.Context, string, string) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func TestHealthAndSearch(t *testing.T) {
	idx := &fakeIndexer{
		status: indexctl.Status{
			Ready:          true,
			Chunks:         2,
			Version:        "v0.1.0",
			VectorsEnabled: true,
			Repos:          []indexctl.RepoStatus{{Key: "main", Ready: true, Chunks: 2}},
		},
		hits: []indexctl.SearchResult{{
			ID: 1, Score: 0.5, Repo: "main", Path: "main.go", StartLine: 1, EndLine: 10, Snippet: "package main",
		}},
	}
	ws := testutil.WsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	res, err := http.Get(ts.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("health status %d", res.StatusCode)
	}
	var health struct {
		VectorsEnabled bool                  `json:"vectors_enabled"`
		Repos          []indexctl.RepoStatus `json:"repos"`
	}
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if !health.VectorsEnabled {
		t.Fatal("expected vectors_enabled true")
	}
	if len(health.Repos) != 1 || health.Repos[0].Key != "main" {
		t.Fatalf("health repos: %+v", health.Repos)
	}

	res2, err := http.Get(ts.URL + "/search?q=main&k=5&repo=main&path_glob=*.go")
	if err != nil {
		t.Fatal(err)
	}
	defer res2.Body.Close()
	var body struct {
		Results []indexctl.SearchResult `json:"results"`
	}
	if err := json.NewDecoder(res2.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Results) != 1 || body.Results[0].Path != "main.go" || body.Results[0].Repo != "main" {
		t.Fatalf("results: %+v", body.Results)
	}
	if idx.gotOpts.Repo != "main" || idx.gotOpts.PathGlob != "*.go" {
		t.Fatalf("search opts not plumbed: %+v", idx.gotOpts)
	}
}

func TestSearchMissingQuery(t *testing.T) {
	idx := &fakeIndexer{}
	ws := testutil.WsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	res, err := http.Get(ts.URL + "/search")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d", res.StatusCode)
	}
	var body struct {
		OK      bool   `json:"ok"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "MISSING_QUERY" {
		t.Fatalf("code %q", body.Code)
	}
}

func TestCallTool(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/hello.txt", []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx := &fakeIndexer{status: indexctl.Status{Ready: true}}
	ws := testutil.WsSingle(root)
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	payload := map[string]any{"name": "read_file", "args": map[string]any{"path": "hello.txt"}}
	b, _ := json.Marshal(payload)
	res, err := http.Post(ts.URL+"/tools/call", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
}

func TestCallPipeTool(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/a.go", []byte("package main\n// TODO\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	idx := &fakeIndexer{status: indexctl.Status{Ready: true}}
	ws := testutil.WsSingle(root)
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	call := func(command string) *http.Response {
		b, _ := json.Marshal(map[string]any{"name": "pipe", "args": map[string]any{"command": command}})
		res, err := http.Post(ts.URL+"/tools/call", "application/json", bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		return res
	}

	res := call(`rg -l TODO --glob "*.go" | head -1`)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pipe status %d", res.StatusCode)
	}
	var body struct {
		Result struct {
			Stdout string `json:"stdout"`
		} `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Result.Stdout == "" {
		t.Fatal("expected non-empty pipe stdout")
	}

	res2 := call(`rg TODO > out`)
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusBadRequest {
		t.Fatalf("unsafe pipe status %d, want 400", res2.StatusCode)
	}
}

func TestSearchInvalidMinScore(t *testing.T) {
	idx := &fakeIndexer{}
	ws := testutil.WsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	res, err := http.Get(ts.URL + "/search?q=test&min_score=not-a-number")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("status %d", res.StatusCode)
	}
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "INVALID_MIN_SCORE" {
		t.Fatalf("code %q", body.Code)
	}
}

func TestCallToolForbiddenPath(t *testing.T) {
	root := t.TempDir()
	idx := &fakeIndexer{status: indexctl.Status{Ready: true}}
	ws := testutil.WsSingle(root)
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	payload := map[string]any{"name": "read_file", "args": map[string]any{"path": "../etc/passwd"}}
	b, _ := json.Marshal(payload)
	res, err := http.Post(ts.URL+"/tools/call", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("status %d want 403", res.StatusCode)
	}
}

func TestCallToolGetChunk(t *testing.T) {
	idx := &fakeIndexer{
		status: indexctl.Status{Ready: true},
	}
	idx.getChunk = func(_ context.Context, repo string, id uint64) (indexctl.ChunkDetail, error) {
		return indexctl.ChunkDetail{ID: id, Repo: repo, Path: "a.go", Body: "func main(){}"}, nil
	}
	ws := testutil.WsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	payload := map[string]any{"name": "get_chunk", "args": map[string]any{"repo": "main", "id": 42}}
	b, _ := json.Marshal(payload)
	res, err := http.Post(ts.URL+"/tools/call", "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d", res.StatusCode)
	}
	var body struct {
		Result indexctl.ChunkDetail `json:"result"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Result.ID != 42 || body.Result.Body == "" {
		t.Fatalf("get_chunk result: %+v", body.Result)
	}
}

func TestSearchToolRegistered(t *testing.T) {
	idx := &fakeIndexer{status: indexctl.Status{Ready: true}}
	ws := testutil.WsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws, idx))
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(ts.Close)

	res, err := http.Get(ts.URL + "/tools")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, tool := range body.Tools {
		if tool.Name == "search" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("search tool not registered")
	}
}
