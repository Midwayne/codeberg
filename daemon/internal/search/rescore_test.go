package search

import (
	"context"
	"errors"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

type fakeIndexer struct {
	indexctl.Indexer
	hits []indexctl.SearchResult
	got  indexctl.SearchOptions
}

func (f *fakeIndexer) Search(_ context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	f.got = opts
	return append([]indexctl.SearchResult(nil), f.hits...), nil
}

type fakeFiles map[string]string

func (f fakeFiles) ReadRaw(repo, path string) ([]byte, error) {
	body, ok := f[repo+"/"+path]
	if !ok {
		return nil, errors.New("missing")
	}
	return []byte(body), nil
}

func hit(id uint64, score float32, path string, start, end uint32) indexctl.SearchResult {
	return indexctl.SearchResult{ID: id, Score: score, Repo: "r", Path: path, StartLine: start, EndLine: end}
}

func ids(hits []indexctl.SearchResult) []uint64 {
	out := make([]uint64, len(hits))
	for i, h := range hits {
		out[i] = h.ID
	}
	return out
}

func TestRescoreLiftsKeywordMatchAboveNearTie(t *testing.T) {
	files := fakeFiles{
		"r/a.go": "func add(a, b int) int {\n\treturn a + b\n}\n",
		"r/b.go": "package b\n\nfunc retryWithBackoff(op func() error) error {\n\treturn op()\n}\n",
	}
	idx := &fakeIndexer{hits: []indexctl.SearchResult{
		hit(1, 0.80, "a.go", 1, 3),
		hit(2, 0.79, "b.go", 3, 5),
		hit(3, 0.10, "missing.go", 1, 2),
	}}

	got, err := NewRescorer(idx, files).Search(context.Background(), indexctl.SearchOptions{Query: "retry with backoff", K: 2})
	if err != nil {
		t.Fatal(err)
	}

	if want := []uint64{2, 1}; !equalIDs(ids(got), want) {
		t.Fatalf("order = %v, want %v", ids(got), want)
	}

	if idx.got.K != RescorePool {
		t.Fatalf("fetched K = %d, want the %d-hit pool", idx.got.K, RescorePool)
	}

	if got[0].Score != 0.79 {
		t.Fatalf("score = %v, want the unchanged dense similarity", got[0].Score)
	}
}

func TestRescoreKeepsDenseOrderWithoutKeywordEvidence(t *testing.T) {
	idx := &fakeIndexer{hits: []indexctl.SearchResult{
		hit(1, 0.9, "a.go", 1, 1), hit(2, 0.8, "b.go", 1, 1), hit(3, 0.7, "c.go", 1, 1),
	}}
	files := fakeFiles{"r/a.go": "alpha\n", "r/b.go": "beta\n", "r/c.go": "gamma\n"}

	got, _ := NewRescorer(idx, files).Search(context.Background(), indexctl.SearchOptions{Query: "the and of"})

	if want := []uint64{1, 2, 3}; !equalIDs(ids(got), want) {
		t.Fatalf("order = %v, want dense order %v", ids(got), want)
	}
}

func TestRescoreFallsBackToSnippetWhenFileIsUnreadable(t *testing.T) {
	first := hit(1, 0.9, "gone.go", 1, 1)
	second := hit(2, 0.89, "gone.go", 2, 2)
	second.Snippet = "func flushJournal() {}"
	idx := &fakeIndexer{hits: []indexctl.SearchResult{first, second, hit(3, 0.2, "gone.go", 3, 3)}}

	got, _ := NewRescorer(idx, fakeFiles{}).Search(context.Background(), indexctl.SearchOptions{Query: "flush journal", K: 1})

	if len(got) != 1 || got[0].ID != 2 {
		t.Fatalf("got %v, want the snippet's keyword match first and k=1", ids(got))
	}
}

func equalIDs(a, b []uint64) bool {
	if len(a) != len(b) {
		return false
	}

	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
