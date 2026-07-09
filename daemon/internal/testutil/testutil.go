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

// StubIndexer is a no-op indexctl.Indexer for tool tests.
type StubIndexer struct{}

func (StubIndexer) Status(context.Context) (indexctl.Status, error) {
	return indexctl.Status{Ready: true}, nil
}

func (StubIndexer) Search(context.Context, indexctl.SearchOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (StubIndexer) GetChunk(context.Context, string, uint64) (indexctl.ChunkDetail, error) {
	return indexctl.ChunkDetail{}, nil
}

func (StubIndexer) FindSymbol(context.Context, indexctl.SymbolOptions) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (StubIndexer) FileOutline(context.Context, string, string) ([]indexctl.SearchResult, error) {
	return nil, nil
}

func (StubIndexer) SearchGraph(context.Context, indexctl.GraphSearchOptions) ([]indexctl.GraphNode, error) {
	return nil, nil
}

func (StubIndexer) TracePath(context.Context, indexctl.TracePathOptions) ([]indexctl.GraphHop, error) {
	return nil, nil
}

func (StubIndexer) GraphStats(context.Context, string) (indexctl.GraphStats, error) {
	return indexctl.GraphStats{}, nil
}

func (StubIndexer) GraphRefs(context.Context, indexctl.GraphRefsOptions) ([]indexctl.GraphEdge, error) {
	return nil, nil
}

func (StubIndexer) GraphHubs(context.Context, indexctl.GraphHubsOptions) ([]indexctl.GraphHub, error) {
	return nil, nil
}
