package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/testutil"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func TestReferencesKeepLexicalEvidenceAlongsidePartialGraph(t *testing.T) {
	root := t.TempDir()
	source := "package main\nfunc caller() { Save() }\nvar callback = Save\n"
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte(source), 0600); err != nil {
		t.Fatal(err)
	}

	idx := &mockIndexer{graphRefs: []indexctl.GraphEdge{{
		Src: 1, Dst: 2, Kind: "calls", SrcName: "caller", DstName: "Save", SrcPath: "a.go", Line: 2,
	}}}
	registry := WithVectorSearch(testutil.WsSingle(root), idx, true)
	output, err := registry.Call(context.Background(), "find_references", json.RawMessage(`{"symbol":"Save"}`))
	if err != nil {
		t.Fatal(err)
	}

	result := output.(findReferencesResult)
	if result.Source != "graph+grep" || len(result.Graph) != 1 || len(result.Matches) != 1 || result.Matches[0].Line != 3 {
		t.Fatalf("callback evidence must survive partial graph hits without duplicating the call site: %+v", result)
	}
	if !result.Partial || result.LimitReached {
		t.Fatalf("coverage must remain explicitly partial without claiming truncation: %+v", result)
	}
}

func TestReferencesShareOneLimit(t *testing.T) {
	edges := []indexctl.GraphEdge{{SrcPath: "a.go", Line: 2}}
	matches := []workspace.GrepMatch{
		{Path: "a.go", Line: 2},
		{Path: "b.go", Line: 3},
		{Path: "c.go", Line: 4},
	}

	result := combineReferences(edges, matches, 2)
	if len(result.Graph) != 1 || len(result.Matches) != 1 || result.Matches[0].Path != "b.go" || !result.LimitReached {
		t.Fatalf("graph and unique lexical hits must share a bounded budget: %+v", result)
	}
}

func TestReferencesSearchAllConfiguredRoots(t *testing.T) {
	repos := []domain.Repo{{Key: "api", Root: t.TempDir()}, {Key: "storage", Root: t.TempDir()}}
	for _, repo := range repos {
		if err := os.WriteFile(filepath.Join(repo.Root, "main.go"), []byte("var callback = Save\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	ws := workspace.New(repos, "")
	output, err := collectReferences(context.Background(), &mockIndexer{}, ws, findReferencesArgs{Symbol: "Save"})
	if err != nil {
		t.Fatal(err)
	}

	result := output.(findReferencesResult)
	if len(result.Matches) != 2 || result.Matches[0].Repo == result.Matches[1].Repo {
		t.Fatalf("same file and line in different repositories are distinct evidence: %+v", result)
	}
}

func TestReferencesDeduplicateWithinTheSourceRepository(t *testing.T) {
	edges := []indexctl.GraphEdge{{SrcRepo: "api", DstRepo: "storage", SrcPath: "main.go", Line: 3}}
	matches := []workspace.GrepMatch{
		{Repo: "api", Path: "main.go", Line: 3},
		{Repo: "worker", Path: "main.go", Line: 3},
	}

	result := combineReferences(edges, matches, 10)
	if len(result.Matches) != 1 || result.Matches[0].Repo != "worker" {
		t.Fatalf("repository identity must survive deduplication: %+v", result)
	}
}

type brokenReferenceIndexer struct {
	*mockIndexer
}

func (m *brokenReferenceIndexer) GraphRefs(context.Context, indexctl.GraphRefsOptions) ([]indexctl.GraphEdge, error) {
	return nil, errors.New("graph not ready")
}

func TestReferencesReportGraphFailureWithUsableLexicalResults(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("var callback = Save\n"), 0600); err != nil {
		t.Fatal(err)
	}

	idx := &brokenReferenceIndexer{&mockIndexer{}}
	output, err := collectReferences(context.Background(), idx, testutil.WsSingle(root), findReferencesArgs{Symbol: "Save"})
	if err != nil {
		t.Fatal(err)
	}

	result := output.(findReferencesResult)
	if result.Source != "grep" || len(result.Matches) != 1 || result.GraphError != "graph not ready" || !result.Partial {
		t.Fatalf("keep usable evidence and explain the unavailable source: %+v", result)
	}
}

func TestReferencesReportLexicalFailureWithUsableGraphResults(t *testing.T) {
	root := t.TempDir()
	if err := os.Remove(root); err != nil {
		t.Fatal(err)
	}

	idx := &mockIndexer{graphRefs: []indexctl.GraphEdge{{SrcPath: "a.go", Line: 2}}}
	output, err := collectReferences(context.Background(), idx, testutil.WsSingle(root), findReferencesArgs{Symbol: "Save"})
	if err != nil {
		t.Fatal(err)
	}

	result := output.(findReferencesResult)
	if result.Source != "graph" || len(result.Graph) != 1 || result.LexicalError == "" || !result.Partial {
		t.Fatalf("keep usable graph evidence and report lexical failure: %+v", result)
	}
}

type truncatedReferenceIndexer struct {
	*mockIndexer
}

func (m *truncatedReferenceIndexer) GraphRefs(context.Context, indexctl.GraphRefsOptions) ([]indexctl.GraphEdge, error) {
	return m.graphRefs, indexctl.ErrTruncated
}

func TestReferencesKeepTruncatedGraphWhenLexicalSearchFails(t *testing.T) {
	root := t.TempDir()
	if err := os.Remove(root); err != nil {
		t.Fatal(err)
	}

	idx := &truncatedReferenceIndexer{&mockIndexer{graphRefs: []indexctl.GraphEdge{{
		SrcRepo: "main", DstRepo: "main", SrcPath: "a.go", Line: 2,
	}}}}
	output, err := collectReferences(context.Background(), idx, testutil.WsSingle(root), findReferencesArgs{Symbol: "Save"})
	if err != nil {
		t.Fatal(err)
	}

	result := output.(findReferencesResult)
	if len(result.Graph) != 1 || !result.Partial || !result.LimitReached || result.GraphError == "" || result.LexicalError == "" {
		t.Fatalf("preserve usable edges and report both coverage problems: %+v", result)
	}
}
