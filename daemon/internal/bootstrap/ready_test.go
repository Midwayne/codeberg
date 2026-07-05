package bootstrap

import (
	"context"
	"encoding/json"
	"net"
	"path/filepath"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

func TestStartupTimeoutScalesWithRepos(t *testing.T) {
	if StartupTimeout(1) != 5*time.Minute {
		t.Fatalf("single repo timeout")
	}
	if StartupTimeout(20) != 60*time.Minute {
		t.Fatalf("timeout capped at 60m")
	}
}

func TestWaitIndexerTimeout(t *testing.T) {
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
			resp, _ := json.Marshal(map[string]any{"ok": true, "ready": false, "chunks": 0, "version": "v0"})
			_, _ = conn.Write(append(resp, '\n'))
			_ = conn.Close()
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	_, err = WaitIndexer(ctx, indexctl.NewClient(sock))
	if err == nil {
		t.Fatal("expected context deadline")
	}
}
