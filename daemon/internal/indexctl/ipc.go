package indexctl

// IPC wire response envelopes decoded from cberg-index JSON lines.

type statusResponse struct {
	OK             bool         `json:"ok"`
	Ready          bool         `json:"ready"`
	Chunks         int          `json:"chunks"`
	Version        string       `json:"version"`
	VectorsEnabled bool         `json:"vectors_enabled"`
	Repos          []RepoStatus `json:"repos"`
	Error          string       `json:"error"`
}

type hitsResponse struct {
	OK      bool           `json:"ok"`
	Results []SearchResult `json:"results"`
	Error   string         `json:"error"`
}

type chunkPayload struct {
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

type chunkResponse struct {
	OK    bool         `json:"ok"`
	Chunk chunkPayload `json:"chunk"`
	Error string       `json:"error"`
}
