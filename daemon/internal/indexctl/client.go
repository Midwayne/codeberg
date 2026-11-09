package indexctl

import "context"

// Client talks to cberg-index over a Unix domain socket.
type Client struct {
	socket string
}

func NewClient(socket string) *Client {
	return &Client{socket: socket}
}

func (c *Client) Status(ctx context.Context) (Status, error) {
	var out statusResponse
	if err := c.statusReply(ctx, &out); err != nil {
		return Status{}, err
	}

	if !out.OK {
		return Status{}, mapIndexerError(out.Code, out.Error)
	}

	return out.Status, nil
}

func (c *Client) Search(ctx context.Context, opts SearchOptions) ([]SearchResult, error) {
	return roundHits(ctx, c.socket, encodeSearch(opts))
}

func (c *Client) GetChunk(ctx context.Context, repo string, id uint64) (ChunkDetail, error) {
	var out chunkResponse
	if err := roundTrip(ctx, c.socket, encodeChunk(repo, id), &out); err != nil {
		return ChunkDetail{}, err
	}

	if !out.OK {
		return ChunkDetail{}, mapIndexerError(out.Code, out.Error)
	}

	return out.Chunk, nil
}

func (c *Client) FindSymbol(ctx context.Context, opts SymbolOptions) ([]SearchResult, error) {
	return roundHits(ctx, c.socket, encodeSymbol(opts))
}

func (c *Client) FileOutline(ctx context.Context, repo, path string) ([]SearchResult, error) {
	return roundHits(ctx, c.socket, encodeOutline(repo, path))
}

func (c *Client) SearchGraph(ctx context.Context, opts GraphSearchOptions) ([]GraphNode, error) {
	var out graphNodesResponse
	if err := roundTrip(ctx, c.socket, encodeSearchGraph(opts), &out); err != nil {
		return nil, err
	}

	if !out.OK {
		return nil, mapIndexerError(out.Code, out.Error)
	}
	return clipped(out.Results, out.Truncated)
}

func (c *Client) TracePath(ctx context.Context, opts TracePathOptions) ([]GraphHop, error) {
	var out graphHopsResponse
	if err := roundTrip(ctx, c.socket, encodeTracePath(opts), &out); err != nil {
		return nil, err
	}

	if !out.OK {
		return nil, mapIndexerError(out.Code, out.Error)
	}
	return clipped(out.Hops, out.Truncated)
}

func (c *Client) GraphStats(ctx context.Context, repo string) (GraphStats, error) {
	var out graphStatsResponse
	if err := roundTrip(ctx, c.socket, encodeGraphStats(repo), &out); err != nil {
		return GraphStats{}, err
	}

	if !out.OK {
		return GraphStats{}, mapIndexerError(out.Code, out.Error)
	}
	return out.GraphStats, nil
}

func (c *Client) GraphRefs(ctx context.Context, opts GraphRefsOptions) ([]GraphEdge, error) {
	var out graphEdgesResponse
	if err := roundTrip(ctx, c.socket, encodeGraphRefs(opts), &out); err != nil {
		return nil, err
	}

	if !out.OK {
		return nil, mapIndexerError(out.Code, out.Error)
	}
	return clipped(out.Results, out.Truncated)
}

func (c *Client) GraphHubs(ctx context.Context, opts GraphHubsOptions) ([]GraphHub, error) {
	var out graphHubsResponse
	if err := roundTrip(ctx, c.socket, encodeGraphHubs(opts), &out); err != nil {
		return nil, err
	}

	if !out.OK {
		return nil, mapIndexerError(out.Code, out.Error)
	}
	return clipped(out.Results, out.Truncated)
}

func clipped[T any](rows []T, truncated bool) ([]T, error) {
	if truncated {
		return rows, ErrTruncated
	}

	return rows, nil
}

func roundHits(ctx context.Context, socket, req string) ([]SearchResult, error) {
	var out hitsResponse
	if err := roundTrip(ctx, socket, req, &out); err != nil {
		return nil, err
	}

	if !out.OK {
		return nil, mapIndexerError(out.Code, out.Error)
	}

	return out.Results, nil
}
