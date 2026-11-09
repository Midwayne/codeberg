package tools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestSymbolTouchesHunk(t *testing.T) {
	lines := map[uint32]struct{}{15: {}}
	if !symbolTouchesHunk(10, 20, lines) {
		t.Fatal("expected overlap")
	}

	if symbolTouchesHunk(1, 5, lines) {
		t.Fatal("expected miss")
	}

	if symbolTouchesHunk(10, 20, nil) {
		t.Fatal("empty hunks must not match")
	}
}

func TestTracePathForwardsDefinitionScope(t *testing.T) {
	idx := &mockIndexer{}
	registry := WithVectorSearch(workspace.New([]domain.Repo{{Key: "api", Root: t.TempDir()}}, "api"), idx, true)
	_, err := registry.Call(context.Background(), "trace_path", json.RawMessage(
		`{"name":"Save","repo":"api","path_prefix":"src/store.ts","direction":"in","edge_kind":"calls","max_depth":1}`))
	if err != nil {
		t.Fatal(err)
	}

	want := indexctl.TracePathOptions{
		Name: "Save", Repo: "api", PathPrefix: "src/store.ts", Direction: "in", EdgeKind: "calls", MaxDepth: 1,
	}
	if idx.lastTrace != want {
		t.Fatalf("trace must retain the chosen definition's repo/path and traversal: got %+v, want %+v", idx.lastTrace, want)
	}
}

func TestGetArchitectureUsesHubsAndLanguages(t *testing.T) {
	idx := &mockIndexer{
		graphStats: indexctl.GraphStats{
			Repo: "main", Nodes: 10, Refs: 20,
			Languages: []indexctl.GraphLangStat{{Lang: "go", Files: 3}, {Lang: "typescript", Files: 1}},
		},
		graphHubs: []indexctl.GraphHub{
			{Name: "helper", Path: "a.go", Kind: "function", Degree: 5},
		},
		searchGraph: []indexctl.GraphNode{
			{Name: "main", Path: "main.go", Kind: "function"},
		},
	}
	root := t.TempDir()
	reg := WithVectorSearch(workspace.New([]domain.Repo{{Key: "main", Root: root}}, "main"), idx, true)
	out, err := reg.Call(context.Background(), "get_architecture", json.RawMessage(`{"repo":"main","hub_limit":5}`))
	if err != nil {
		t.Fatal(err)
	}

	res, ok := out.(getArchitectureResult)
	if !ok {
		t.Fatalf("type: %T", out)
	}

	if res.Nodes != 10 || len(res.Hubs) != 1 || res.Hubs[0].Degree != 5 {
		t.Fatalf("hubs: %+v", res)
	}

	if len(res.Languages) != 2 || res.Languages[0].Lang != "go" {
		t.Fatalf("languages: %+v", res.Languages)
	}

	if len(res.Entrypoints) != 1 || res.Entrypoints[0].Name != "main" {
		t.Fatalf("entrypoints: %+v", res.Entrypoints)
	}
}

func TestDetectChangesHunkFilterAndPathPrefix(t *testing.T) {
	root := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init")
	run("config", "user.email", "t@example.com")
	run("config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("package main\n\nfunc Keep() {}\n\nfunc Touch() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	run("add", "a.go")
	run("commit", "-m", "init")
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("package main\n\nfunc Keep() {}\n\nfunc Touch() { x := 1; _ = x }\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	idx := &mockIndexer{
		outline: map[string][]indexctl.SearchResult{
			"a.go": {
				{Symbol: "Keep", Path: "a.go", StartLine: 3, EndLine: 3},
				{Symbol: "Touch", Path: "a.go", StartLine: 5, EndLine: 5},
			},
		},
		traceHops: []indexctl.GraphHop{
			{SrcName: "Caller", SrcPath: "b.go", DstName: "Touch", DstPath: "a.go", Kind: "calls"},
		},
	}
	reg := WithVectorSearch(workspace.New([]domain.Repo{{Key: "main", Root: root}}, "main"), idx, true)
	// Bogus base forces working-tree-vs-HEAD fallback so unstaged edits are visible.
	out, err := reg.Call(context.Background(), "detect_changes", json.RawMessage(`{"repo":"main","base":"does-not-exist","head":"HEAD","limit":20}`))
	if err != nil {
		t.Fatal(err)
	}

	res, ok := out.(detectChangesResult)
	if !ok {
		t.Fatalf("type: %T", out)
	}

	if res.Fallback != "working-tree-vs-HEAD" {
		t.Fatalf("expected fallback, got %+v", res)
	}

	if len(res.Direct) != 1 || res.Direct[0].Name != "Touch" {
		t.Fatalf("hunk filter direct: %+v", res.Direct)
	}

	if idx.lastTrace.PathPrefix != "a.go" || idx.lastTrace.Name != "Touch" {
		t.Fatalf("trace path prefix: %+v", idx.lastTrace)
	}

	if len(res.Indirect) != 1 || res.Indirect[0].Name != "Caller" {
		t.Fatalf("indirect: %+v", res.Indirect)
	}
}
