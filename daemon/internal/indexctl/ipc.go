package indexctl

// IPC wire response envelopes decoded from cberg-index JSON lines.
// ok, code, and error are the shared failure prefix. Success bodies embed the
// types the rest of the daemon already uses, so a new field is added once.

type ipcFailure struct {
	OK    bool   `json:"ok"`
	Code  string `json:"code"`
	Error string `json:"error"`
}

type statusResponse struct {
	ipcFailure
	Status
}

type hitsResponse struct {
	ipcFailure
	Results []SearchResult `json:"results"`
}

type chunkResponse struct {
	ipcFailure
	Chunk ChunkDetail `json:"chunk"`
}

type graphNodesResponse struct {
	ipcFailure
	Truncated bool        `json:"truncated"`
	Results   []GraphNode `json:"results"`
}

type graphHopsResponse struct {
	ipcFailure
	Truncated bool       `json:"truncated"`
	Hops      []GraphHop `json:"hops"`
}

type graphStatsResponse struct {
	ipcFailure
	GraphStats
}

type graphEdgesResponse struct {
	ipcFailure
	Truncated bool        `json:"truncated"`
	Results   []GraphEdge `json:"results"`
}

type graphHubsResponse struct {
	ipcFailure
	Truncated bool       `json:"truncated"`
	Results   []GraphHub `json:"results"`
}
