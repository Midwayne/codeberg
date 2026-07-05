package indexctl

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func startMockIndexer(t *testing.T, handler func(req string) []byte) string {
	t.Helper()
	sock := filepath.Join(t.TempDir(), "idx.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			buf := make([]byte, 4096)
			n, _ := conn.Read(buf)
			resp := handler(string(buf[:n]))
			if resp != nil {
				_, _ = conn.Write(resp)
			}
			_ = conn.Close()
		}
	}()
	return sock
}

func TestClientStatusAndSearch(t *testing.T) {
	sock := startMockIndexer(t, func(line string) []byte {
		switch {
		case strings.HasPrefix(line, "status"):
			return []byte(`{"ok":true,"ready":true,"chunks":3,"version":"v0.1.0","repos":[{"key":"alpha","ready":true,"chunks":2},{"key":"beta","ready":false,"chunks":1}]}` + "\n")
		case strings.HasPrefix(line, "search\t"):
			return []byte(`{"ok":true,"results":[{"id":1,"score":0.9,"repo":"alpha","path":"a.go","symbol":"Fn","start_line":1,"end_line":2,"snippet":"func Fn(){}"}]}` + "\n")
		default:
			return []byte(`{"ok":false,"error":"unknown"}` + "\n")
		}
	})

	c := NewClient(sock)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	st, err := c.Status(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Ready || st.Chunks != 3 || st.Version != "v0.1.0" {
		t.Fatalf("status: %+v", st)
	}
	if len(st.Repos) != 2 || st.Repos[0].Key != "alpha" || st.Repos[1].Ready {
		t.Fatalf("per-repo status: %+v", st.Repos)
	}

	hits, err := c.Search(ctx, SearchOptions{Query: "add function", K: 5})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || hits[0].Path != "a.go" || hits[0].Repo != "alpha" || hits[0].Snippet == "" {
		t.Fatalf("search: %+v", hits)
	}
}

func TestClientSearchEscapesTabs(t *testing.T) {
	var gotLine string
	sock := startMockIndexer(t, func(line string) []byte {
		gotLine = line
		return []byte(`{"ok":true,"results":[]}` + "\n")
	})

	c := NewClient(sock)
	_, err := c.Search(context.Background(), SearchOptions{Query: "a\tb", K: 3})
	if err != nil {
		t.Fatal(err)
	}
	if gotLine != "search\ta b\t3\n" {
		t.Fatalf("query tab not sanitized: %q", gotLine)
	}
}

func TestClientSearchRepoScoped(t *testing.T) {
	var gotLine string
	sock := startMockIndexer(t, func(line string) []byte {
		gotLine = line
		return []byte(`{"ok":true,"results":[]}` + "\n")
	})

	c := NewClient(sock)
	if _, err := c.Search(context.Background(), SearchOptions{Query: "q", K: 3, Repo: "beta"}); err != nil {
		t.Fatal(err)
	}
	if gotLine != "search\tq\t3\tbeta\n" {
		t.Fatalf("repo not appended: %q", gotLine)
	}
}

func TestWaitReady(t *testing.T) {
	ready := false
	sock := startMockIndexer(t, func(string) []byte {
		resp := map[string]any{"ok": true, "ready": ready, "chunks": 0, "version": "v0"}
		if !ready {
			ready = true
		}
		b, _ := json.Marshal(resp)
		return append(b, '\n')
	})

	c := NewClient(sock)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	st, err := WaitReady(ctx, c)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Ready {
		t.Fatal("expected ready")
	}
}
