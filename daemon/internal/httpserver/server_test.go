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
	status indexctl.Status
	hits   []indexctl.SearchResult
}

func (f *fakeIndexer) Status(context.Context) (indexctl.Status, error) {
	return f.status, nil
}

func (f *fakeIndexer) Search(context.Context, string, int) ([]indexctl.SearchResult, error) {
	return f.hits, nil
}

func TestHealthAndSearch(t *testing.T) {
	idx := &fakeIndexer{
		status: indexctl.Status{Ready: true, Chunks: 2, Version: "v0.1.0"},
		hits: []indexctl.SearchResult{{
			ID: 1, Score: 0.5, Path: "main.go", StartLine: 1, EndLine: 10, Snippet: "package main",
		}},
	}
	ws := workspace.New(t.TempDir())
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

	res2, err := http.Get(ts.URL + "/search?q=main&k=5")
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
	if len(body.Results) != 1 || body.Results[0].Path != "main.go" {
		t.Fatalf("results: %+v", body.Results)
	}
}

func TestSearchMissingQuery(t *testing.T) {
	srv := New(&fakeIndexer{}, tools.Default(workspace.New(t.TempDir())))
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
	ws := workspace.New(root)
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
