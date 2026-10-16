package tools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/testutil"
)

func TestHybridSearchKindPreservesIndexErrors(t *testing.T) {
	for _, stage := range []string{"outline", "chunk"} {
		t.Run(stage, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(root+"/exact.go", []byte("func checkoutSessionToken() {}\n"), 0o644); err != nil {
				t.Fatal(err)
			}

			unavailable := &indexctl.IndexerError{Code: "NOT_READY", Message: "index building"}
			idx := &testutil.FakeIndexer{
				SearchErr: unavailable,
				OutlineHits: []indexctl.SearchResult{{
					ID: 9, Repo: "main", Path: "exact.go", StartLine: 1, EndLine: 1,
				}},
			}
			if stage == "outline" {
				idx.OutlineErr = unavailable
			} else {
				idx.ChunkErr = unavailable
			}

			reg := Default(testutil.WsSingle(root), idx)
			_, err := reg.Call(context.Background(), "hybrid_search", json.RawMessage(`{"query":"checkoutSessionToken","kind":"function"}`))
			if !errors.Is(err, unavailable) {
				t.Fatalf("kind lookup should preserve readiness error, got %v", err)
			}
		})
	}
}
