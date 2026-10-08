package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/testutil"
)

// slowVectorIndexer stands in for an indexer whose embedding + ANN search
// takes a fixed time, so the benchmark isolates how hybrid_search schedules
// its vector and lexical halves.
type slowVectorIndexer struct {
	testutil.FakeIndexer
	delay time.Duration
}

func (s *slowVectorIndexer) Search(ctx context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	time.Sleep(s.delay)
	return s.FakeIndexer.Search(ctx, opts)
}

func BenchmarkHybridSearchSlowVectors(b *testing.B) {
	root := b.TempDir()

	for i := 0; i < 2000; i++ {
		body := fmt.Sprintf("package p\n\nfunc helper%d() int {\n\treturn %d\n}\n", i, i)
		if i%50 == 0 {
			body += "\nfunc checkoutSessionToken() {}\n"
		}

		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("f%04d.go", i)), []byte(body), 0o644); err != nil {
			b.Fatal(err)
		}
	}

	idx := &slowVectorIndexer{delay: 20 * time.Millisecond}
	idx.SearchHits = []indexctl.SearchResult{{ID: 1, Repo: "main", Path: "f0001.go", StartLine: 3, EndLine: 5}}
	reg := Default(testutil.WsSingle(root), idx)
	args := json.RawMessage(`{"query":"checkoutSessionToken","k":8}`)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		if _, err := reg.Call(context.Background(), "hybrid_search", args); err != nil {
			b.Fatal(err)
		}
	}
}
