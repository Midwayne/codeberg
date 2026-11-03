package tools

import (
	"context"
	"errors"
	"testing"

	"codeberg.org/codeberg/daemon/internal/testutil"
)

func TestRegistryWithoutEmbeddingTools(t *testing.T) {
	reg := WithVectorSearch(testutil.WsSingle(t.TempDir()), testutil.StubIndexer(), false)
	names := map[string]bool{}

	for _, spec := range reg.List() {
		names[spec.Name] = true
	}

	for _, name := range []string{"search", "hybrid_search"} {
		if names[name] {
			t.Errorf("embedding tool %s is advertised", name)
		}

		if _, err := reg.Call(context.Background(), name, nil); !errors.Is(err, ErrUnknownTool) {
			t.Errorf("embedding tool %s must be unavailable: %v", name, err)
		}
	}

	for _, name := range []string{"grep", "glob", "read_file", "find_symbol", "file_outline", "get_chunk", "search_graph", "trace_path"} {
		if !names[name] {
			t.Errorf("non-embedding tool %s is missing", name)
		}
	}
}
