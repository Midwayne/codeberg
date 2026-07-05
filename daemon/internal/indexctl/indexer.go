package indexctl

import "context"

// Indexer is the daemon-facing API to the C indexer over IPC.
type Indexer interface {
	Status(ctx context.Context) (Status, error)
	Search(ctx context.Context, opts SearchOptions) ([]SearchResult, error)
	GetChunk(ctx context.Context, repo string, id uint64) (ChunkDetail, error)
	FindSymbol(ctx context.Context, opts SymbolOptions) ([]SearchResult, error)
	FileOutline(ctx context.Context, repo, path string) ([]SearchResult, error)
}

var _ Indexer = (*Client)(nil)
