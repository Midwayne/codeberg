package indexctl

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	socket string
}

func NewClient(socket string) *Client {
	return &Client{socket: socket}
}

func (c *Client) Status(ctx context.Context) (Status, error) {
	var out statusResponse
	if err := c.roundTrip(ctx, "status", &out); err != nil {
		return Status{}, err
	}
	if !out.OK {
		return Status{}, mapIndexerError(out.Error)
	}

	return Status{
		Ready:          out.Ready,
		Chunks:         out.Chunks,
		Version:        out.Version,
		VectorsEnabled: out.VectorsEnabled,
		Repos:          out.Repos,
	}, nil
}

// Search queries the indexer with optional filters.
func (c *Client) Search(ctx context.Context, opts SearchOptions) ([]SearchResult, error) {
	k := opts.K
	if k <= 0 {
		k = 10
	}

	hasFilters := opts.PathGlob != "" || opts.Kind != "" || opts.MinScore > 0
	fields := []string{sanitizeTab(opts.Query), strconv.Itoa(k)}

	if opts.Repo != "" || hasFilters {
		fields = append(fields, sanitizeTab(opts.Repo))
	}
	if hasFilters {
		fields = append(fields, sanitizeTab(opts.PathGlob), sanitizeTab(opts.Kind))
		if opts.MinScore > 0 {
			fields = append(fields, fmt.Sprintf("%.6f", opts.MinScore))
		}
	}

	line := "search\t" + strings.Join(fields, "\t")

	var out searchResponse
	if err := c.roundTrip(ctx, line, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, mapIndexerError(out.Error)
	}

	return out.Results, nil
}

func (c *Client) GetChunk(ctx context.Context, repo string, id uint64) (ChunkDetail, error) {
	line := fmt.Sprintf("chunk\t%s\t%d", sanitizeTab(repo), id)

	var out chunkResponse
	if err := c.roundTrip(ctx, line, &out); err != nil {
		return ChunkDetail{}, err
	}
	if !out.OK {
		return ChunkDetail{}, mapIndexerError(out.Error)
	}

	return ChunkDetail{
		ID:        out.Chunk.ID,
		Repo:      out.Chunk.Repo,
		Path:      out.Chunk.Path,
		Symbol:    out.Chunk.Symbol,
		Kind:      out.Chunk.Kind,
		StartLine: out.Chunk.StartLine,
		EndLine:   out.Chunk.EndLine,
		Snippet:   out.Chunk.Snippet,
		Body:      out.Chunk.Body,
		Truncated: out.Chunk.Truncated,
	}, nil
}

func (c *Client) FindSymbol(ctx context.Context, opts SymbolOptions) ([]SearchResult, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 20
	}

	line := fmt.Sprintf("symbol\t%s\t%s\t%s\t%d",
		sanitizeTab(opts.Name), sanitizeTab(opts.Repo), sanitizeTab(opts.Kind), limit)

	var out symbolResponse
	if err := c.roundTrip(ctx, line, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, mapIndexerError(out.Error)
	}

	return out.Results, nil
}

func (c *Client) FileOutline(ctx context.Context, repo, path string) ([]SearchResult, error) {
	line := fmt.Sprintf("outline\t%s\t%s", sanitizeTab(repo), sanitizeTab(path))

	var out outlineResponse
	if err := c.roundTrip(ctx, line, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, mapIndexerError(out.Error)
	}

	return out.Results, nil
}

func sanitizeTab(s string) string {
	return strings.ReplaceAll(s, "\t", " ")
}

func (c *Client) roundTrip(ctx context.Context, req string, dest any) error {
	d := net.Dialer{Timeout: 5 * time.Second}
	conn, err := d.DialContext(ctx, "unix", c.socket)
	if err != nil {
		return fmt.Errorf("indexer connect: %w", err)
	}
	defer conn.Close()

	if _, err := conn.Write([]byte(req + "\n")); err != nil {
		return fmt.Errorf("indexer write: %w", err)
	}

	sc := bufio.NewScanner(conn)
	if !sc.Scan() {
		return fmt.Errorf("indexer: empty response")
	}
	if err := json.Unmarshal(sc.Bytes(), dest); err != nil {
		return fmt.Errorf("indexer decode: %w", err)
	}

	return sc.Err()
}

// WaitReady polls until the indexer reports ready or ctx is canceled.
func WaitReady(ctx context.Context, c *Client) (Status, error) {
	for {
		st, err := c.Status(ctx)
		if err == nil && st.Ready {
			return st, nil
		}

		select {
		case <-ctx.Done():
			return Status{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}
