package indexctl

import (
	"bufio"
	"context"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStatusDoesNotQueueBehindEmbeddingRequests(t *testing.T) {
	dir, err := os.MkdirTemp("", "idx-health-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "idx.sock")
	ln, err := net.Listen("unix", socket+".health")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		line, _ := bufio.NewReader(conn).ReadString('\n')
		if line == "status\n" {
			_, _ = conn.Write([]byte("{\"ok\":true,\"ready\":true,\"chunks\":42,\"indexing\":true,\"progress\":{\"repo\":\"main\",\"phase\":\"embedding\",\"completed\":1500,\"total\":2600}}\n"))
		}
	}()

	// Slow searches occupy every ordinary IPC slot, as Gemma inference can do.
	for i := 0; i < maxInflight; i++ {
		release, err := acquireSlot(context.Background(), socket)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(release)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	st, err := NewClient(socket).Status(ctx)
	if err != nil || !st.Ready || st.Chunks != 42 {
		t.Fatalf("health queued behind embedding work: %+v, %v", st, err)
	}
	if !st.Indexing || st.Progress == nil || st.Progress.Completed != 1500 || st.Progress.Total != 2600 {
		t.Fatalf("lost measured progress: %+v", st)
	}
}
