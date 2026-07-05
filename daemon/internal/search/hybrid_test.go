package search

import (
	"context"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

func TestSignificantTerms(t *testing.T) {
	terms := SignificantTerms("How does the authentication handler work?")
	if len(terms) != 3 || terms[0] != "authentication" || terms[1] != "handler" || terms[2] != "work" {
		t.Fatalf("terms: %v", terms)
	}

	short := SignificantTerms("go io")
	if len(short) != 0 {
		t.Fatalf("short/stop words filtered: %v", short)
	}

	trimmed := SignificantTerms(`tokenize, "punctuation"!`)
	if len(trimmed) != 2 || trimmed[0] != "tokenize" || trimmed[1] != "punctuation" {
		t.Fatalf("trimmed: %v", trimmed)
	}
}

func TestHybridReranksByTermPresence(t *testing.T) {
	candidates := []indexctl.SearchResult{
		{ID: 1, Score: 0.95, Repo: "main", Path: "a.go", Snippet: "unrelated code"},
		{ID: 2, Score: 0.90, Repo: "main", Path: "b.go", Snippet: "authentication handler implementation"},
	}

	reads := 0
	read := func(_ context.Context, _, path string) ([]byte, error) {
		reads++
		switch path {
		case "a.go":
			return []byte("unrelated code"), nil
		case "b.go":
			return []byte("authentication handler implementation"), nil
		default:
			return nil, nil
		}
	}

	out, err := Hybrid(context.Background(), candidates, "authentication handler", read, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("len %d", len(out))
	}
	if out[0].Hit.ID != 2 {
		t.Fatalf("expected lexical boost to promote hit 2, got %+v", out[0])
	}
	if out[0].GrepBoost != 2 {
		t.Fatalf("grep boost %d", out[0].GrepBoost)
	}
	if out[0].FinalScore <= out[1].FinalScore {
		t.Fatalf("final scores not ordered: %+v", out)
	}
}

func TestHybridReadsEachFileOnce(t *testing.T) {
	candidates := []indexctl.SearchResult{
		{ID: 1, Score: 0.9, Repo: "main", Path: "dup.go", Snippet: "plain"},
		{ID: 2, Score: 0.8, Repo: "main", Path: "dup.go", Snippet: "plain"},
	}

	reads := 0
	read := func(_ context.Context, _, _ string) ([]byte, error) {
		reads++
		return []byte("authentication"), nil
	}

	if _, err := Hybrid(context.Background(), candidates, "authentication", read, 2); err != nil {
		t.Fatal(err)
	}
	if reads != 1 {
		t.Fatalf("content cache should read once, got %d reads", reads)
	}
}

func TestHybridTruncatesToK(t *testing.T) {
	candidates := make([]indexctl.SearchResult, 5)
	for i := range candidates {
		candidates[i] = indexctl.SearchResult{ID: uint64(i + 1), Score: float32(i), Repo: "main", Path: "f.go"}
	}

	read := func(_ context.Context, _, _ string) ([]byte, error) {
		return []byte("x"), nil
	}

	out, err := Hybrid(context.Background(), candidates, "xyz", read, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 2 {
		t.Fatalf("want 2 results, got %d", len(out))
	}
}
