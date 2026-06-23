package indexctl

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

type SearchResult struct {
	ID    uint64  `json:"id"`
	Score float32 `json:"score"`
}

type Status struct {
	Ready   bool   `json:"ready"`
	Chunks  int    `json:"chunks"`
	Version string `json:"version"`
}

type Client struct {
	socket string
}

func NewClient(socket string) *Client {
	return &Client{socket: socket}
}

func (c *Client) Status(ctx context.Context) (Status, error) {
	var out struct {
		OK      bool   `json:"ok"`
		Ready   bool   `json:"ready"`
		Chunks  int    `json:"chunks"`
		Version string `json:"version"`
		Error   string `json:"error"`
	}
	if err := c.roundTrip(ctx, "status", &out); err != nil {
		return Status{}, err
	}
	if !out.OK {
		return Status{}, fmt.Errorf("indexer: %s", out.Error)
	}
	return Status{Ready: out.Ready, Chunks: out.Chunks, Version: out.Version}, nil
}

func (c *Client) Search(ctx context.Context, query string, k int) ([]SearchResult, error) {
	line := fmt.Sprintf("search\t%s\t%d", strings.ReplaceAll(query, "\t", " "), k)
	var out struct {
		OK      bool           `json:"ok"`
		Results []SearchResult `json:"results"`
		Error   string         `json:"error"`
	}
	if err := c.roundTrip(ctx, line, &out); err != nil {
		return nil, err
	}
	if !out.OK {
		return nil, fmt.Errorf("indexer: %s", out.Error)
	}
	return out.Results, nil
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
