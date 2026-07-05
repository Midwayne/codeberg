package indexctl

// SearchOptions configures a vector search request.
type SearchOptions struct {
	Query     string
	K         int
	Repo      string
	PathGlob  string
	Kind      string
	MinScore  float32
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
	ID         uint64  `json:"id"`
	Repo       string  `json:"repo"`
	Path       string  `json:"path"`
	Symbol     string  `json:"symbol"`
	Kind       string  `json:"kind"`
	StartLine  uint32  `json:"start_line"`
	EndLine    uint32  `json:"end_line"`
	Snippet    string  `json:"snippet"`
	Body       string  `json:"body"`
	Truncated  bool    `json:"truncated"`
}
