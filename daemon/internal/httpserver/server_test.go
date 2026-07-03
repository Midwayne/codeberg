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
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

type fakeIndexer struct {
	status   indexctl.Status
	hits     []indexctl.SearchResult
	gotRepo  string
	gotQuery string
}

func (f *fakeIndexer) Status(context.Context) (indexctl.Status, error) {
	return f.status, nil
}

func (f *fakeIndexer) Search(_ context.Context, query string, _ int, repo string) ([]indexctl.SearchResult, error) {
	f.gotQuery = query
	f.gotRepo = repo
	return f.hits, nil
}

func wsSingle(root string) *workspace.Workspace {
	return workspace.New([]workspace.RepoInfo{{Key: "main", Root: root}}, "main")
}

func TestHealthAndSearch(t *testing.T) {
	idx := &fakeIndexer{
		status: indexctl.Status{Ready: true, Chunks: 2, Version: "v0.1.0",
			Repos: []indexctl.RepoStatus{{Key: "main", Ready: true, Chunks: 2}}},
		hits: []indexctl.SearchResult{{
			ID: 1, Score: 0.5, Repo: "main", Path: "main.go", StartLine: 1, EndLine: 10, Snippet: "package main",
		}},
	}
	ws := wsSingle(t.TempDir())
	srv := New(idx, tools.Default(ws))
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
		Repos []indexctl.RepoStatus `json:"repos"`
	}
	if err := json.NewDecoder(res.Body).Decode(&health); err != nil {
		t.Fatal(err)
	}
	if len(health.Repos) != 1 || health.Repos[0].Key != "main" {
		t.Fatalf("health repos: %+v", health.Repos)
	}

	res2, err := http.Get(ts.URL + "/search?q=main&k=5&repo=main")
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
	if idx.gotRepo != "main" {
		t.Fatalf("repo param not plumbed to indexer, got %q", idx.gotRepo)
	}
}

func TestSearchMissingQuery(t *testing.T) {
	srv := New(&fakeIndexer{}, tools.Default(wsSingle(t.TempDir())))
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
}

func TestCallTool(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(root+"/hello.txt", []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	ws := wsSingle(root)
	srv := New(&fakeIndexer{status: indexctl.Status{Ready: true}}, tools.Default(ws))
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
	srv := New(&fakeIndexer{status: indexctl.Status{Ready: true}}, tools.Default(wsSingle(root)))
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

	// Happy path: a real rg | head pipeline returns the matching file.
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

	// Unsafe pipeline: shell redirection is rejected with 400.
	res2 := call(`rg TODO > out`)
	defer res2.Body.Close()
	if res2.StatusCode != http.StatusBadRequest {
		t.Fatalf("unsafe pipe status %d, want 400", res2.StatusCode)
	}
}
