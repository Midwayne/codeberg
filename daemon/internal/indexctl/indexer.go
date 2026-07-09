package indexctl

import "context"

// Indexer is the daemon-facing API to the C indexer over IPC.
type Indexer interface {
	Status(ctx context.Context) (Status, error)
	Search(ctx context.Context, opts SearchOptions) ([]SearchResult, error)
	GetChunk(ctx context.Context, repo string, id uint64) (ChunkDetail, error)
	FindSymbol(ctx context.Context, opts SymbolOptions) ([]SearchResult, error)
	FileOutline(ctx context.Context, repo, path string) ([]SearchResult, error)
	SearchGraph(ctx context.Context, opts GraphSearchOptions) ([]GraphNode, error)
	TracePath(ctx context.Context, opts TracePathOptions) ([]GraphHop, error)
	GraphStats(ctx context.Context, repo string) (GraphStats, error)
	GraphRefs(ctx context.Context, opts GraphRefsOptions) ([]GraphEdge, error)
	GraphHubs(ctx context.Context, opts GraphHubsOptions) ([]GraphHub, error)
}

var _ Indexer = (*Client)(nil)
