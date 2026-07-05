package indexctl

// SearchResult is one vector-search or symbol-lookup hit from the indexer.
type SearchResult struct {
	ID        uint64  `json:"id"`
	Score     float32 `json:"score"`
	Repo      string  `json:"repo"`
	Path      string  `json:"path"`
	Symbol    string  `json:"symbol"`
	StartLine uint32  `json:"start_line"`
	EndLine   uint32  `json:"end_line"`
	Snippet   string  `json:"snippet"`
}

// RepoStatus is one repo's slice of the indexer status. A repo that failed to
// bootstrap stays Ready=false while its siblings serve searches.
type RepoStatus struct {
	Key    string `json:"key"`
	Ready  bool   `json:"ready"`
	Chunks int    `json:"chunks"`
}

// Status is the aggregate indexer health returned by GET /health.
type Status struct {
	Ready          bool         `json:"ready"`
	Chunks         int          `json:"chunks"`
	Version        string       `json:"version"`
	VectorsEnabled bool         `json:"vectors_enabled"`
	Repos          []RepoStatus `json:"repos"`
}

// SearchOptions configures a vector search request.
type SearchOptions struct {
	Query    string
	K        int
	Repo     string
	PathGlob string
	Kind     string
	MinScore float32
}

// SymbolOptions configures a symbol lookup request.
type SymbolOptions struct {
	Name  string
	Repo  string
	Kind  string
	Limit int
}

// ChunkDetail is a full indexed chunk body plus metadata.
type ChunkDetail struct {
	ID        uint64 `json:"id"`
	Repo      string `json:"repo"`
	Path      string `json:"path"`
	Symbol    string `json:"symbol"`
	Kind      string `json:"kind"`
	StartLine uint32 `json:"start_line"`
	EndLine   uint32 `json:"end_line"`
	Snippet   string `json:"snippet"`
	Body      string `json:"body"`
	Truncated bool   `json:"truncated"`
}
