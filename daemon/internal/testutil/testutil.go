package testutil

import (
	"context"

	"codeberg.org/codeberg/daemon/internal/domain"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

// WsSingle builds a one-repo workspace (key "main" is the default).
func WsSingle(root string) *workspace.Workspace {
	return workspace.New([]domain.Repo{{Key: "main", Root: root}}, "main")
}

// FakeIndexer is a configurable indexctl.Indexer for tests.
type FakeIndexer struct {
	StatusValue indexctl.Status
	StatusErr   error
	statusSet   bool

	SearchHits []indexctl.SearchResult
	SearchErr  error
	GotSearch  indexctl.SearchOptions

	Chunk      indexctl.ChunkDetail
	ChunkErr   error
	GetChunkFn func(context.Context, string, uint64) (indexctl.ChunkDetail, error)

	SymbolHits []indexctl.SearchResult
	SymbolErr  error

	OutlineHits []indexctl.SearchResult
	OutlineErr  error
}

// WithStatus sets StatusValue and marks it as explicitly configured.
func (f *FakeIndexer) WithStatus(st indexctl.Status) *FakeIndexer {
	f.StatusValue = st
	f.statusSet = true
	return f
}

func (f *FakeIndexer) Status(context.Context) (indexctl.Status, error) {
	if f.StatusErr != nil {
		return f.StatusValue, f.StatusErr
	}
	if f.statusSet || f.StatusValue.Ready || f.StatusValue.Version != "" || f.StatusValue.Chunks != 0 || len(f.StatusValue.Repos) > 0 {
		return f.StatusValue, nil
	}
	return indexctl.Status{Ready: true}, nil
}

func (f *FakeIndexer) Search(_ context.Context, opts indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	f.GotSearch = opts
	return f.SearchHits, f.SearchErr
}

func (f *FakeIndexer) GetChunk(ctx context.Context, repo string, id uint64) (indexctl.ChunkDetail, error) {
	if f.GetChunkFn != nil {
		return f.GetChunkFn(ctx, repo, id)
	}
	return f.Chunk, f.ChunkErr
}

func (f *FakeIndexer) FindSymbol(context.Context, indexctl.SymbolOptions) ([]indexctl.SearchResult, error) {
	return f.SymbolHits, f.SymbolErr
}

func (f *FakeIndexer) FileOutline(context.Context, string, string) ([]indexctl.SearchResult, error) {
	return f.OutlineHits, f.OutlineErr
}

// StubIndexer is a ready no-op indexer for tests that do not exercise search.
func StubIndexer() *FakeIndexer {
	return (&FakeIndexer{}).WithStatus(indexctl.Status{Ready: true})
}
