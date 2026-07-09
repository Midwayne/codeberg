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

// GraphNode is one knowledge-graph node from search_graph.
type GraphNode struct {
	ID        uint64 `json:"id"`
	Repo      string `json:"repo"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	QName     string `json:"qname"`
	Path      string `json:"path"`
	StartLine uint32 `json:"start_line"`
	EndLine   uint32 `json:"end_line"`
}

// GraphEdge is a resolved graph edge with confidence/resolution metadata.
type GraphEdge struct {
	Src        uint64  `json:"src"`
	Dst        uint64  `json:"dst"`
	Kind       string  `json:"kind"`
	Resolution string  `json:"resolution"`
	Confidence float32 `json:"confidence"`
	Line       uint32  `json:"line"`
	SrcName    string  `json:"src_name"`
	DstName    string  `json:"dst_name"`
	SrcPath    string  `json:"src_path"`
	DstPath    string  `json:"dst_path"`
}

// GraphHop is one BFS hop from trace_path.
type GraphHop struct {
	Depth      uint32  `json:"depth"`
	Src        uint64  `json:"src"`
	Dst        uint64  `json:"dst"`
	Kind       string  `json:"kind"`
	Resolution string  `json:"resolution"`
	Confidence float32 `json:"confidence"`
	Line       uint32  `json:"line"`
	SrcName    string  `json:"src_name"`
	DstName    string  `json:"dst_name"`
	SrcPath    string  `json:"src_path"`
	DstPath    string  `json:"dst_path"`
}

// GraphStats is per-repo graph size from graph_stats.
type GraphStats struct {
	Repo       string          `json:"repo"`
	Nodes      int             `json:"nodes"`
	Refs       int             `json:"refs"`
	Enabled    bool            `json:"enabled"`
	Languages  []GraphLangStat `json:"languages,omitempty"`
}

// GraphLangStat is one language's FILE-node count from graph_stats.
type GraphLangStat struct {
	Lang  string `json:"lang"`
	Files int    `json:"files"`
}

// GraphHub is a degree-ranked symbol from graph_hubs.
type GraphHub struct {
	ID        uint64 `json:"id"`
	Repo      string `json:"repo"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	QName     string `json:"qname"`
	Path      string `json:"path"`
	StartLine uint32 `json:"start_line"`
	EndLine   uint32 `json:"end_line"`
	Degree    int    `json:"degree"`
}

// GraphSearchOptions configures a structural graph node search.
type GraphSearchOptions struct {
	Name       string
	Repo       string
	Kind       string
	PathPrefix string
	Limit      int
}

// TracePathOptions configures a BFS graph traversal.
type TracePathOptions struct {
	Name       string
	Repo       string
	PathPrefix string // disambiguate same-named symbols
	Direction  string // in | out | both (default in)
	EdgeKind   string // calls | imports | inherits | ... (default calls)
	MaxDepth   int
	Limit      int
}

// GraphRefsOptions configures graph-first reference lookup.
type GraphRefsOptions struct {
	Name  string
	Repo  string
	Limit int
}

// GraphHubsOptions configures degree-hub lookup.
type GraphHubsOptions struct {
	Repo  string
	Limit int
}
