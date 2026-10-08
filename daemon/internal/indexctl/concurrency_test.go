package indexctl_test

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/indexctl"
)

// startSerialIndexer mirrors cberg-index: one thread accepts and answers one
// connection at a time, with a small listen backlog.
func startSerialIndexer(t *testing.T, backlog int, work time.Duration) (string, func() int) {
	t.Helper()

	// Keep the socket path below macOS's sockaddr_un limit, even with a long TMPDIR.
	dir, err := os.MkdirTemp("", "idx-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	sock := filepath.Join(dir, "idx.sock")

	fd, err := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}

	if err := syscall.Bind(fd, &syscall.SockaddrUnix{Name: sock}); err != nil {
		t.Fatal(err)
	}

	if err := syscall.Listen(fd, backlog); err != nil {
		t.Fatal(err)
	}

	file := os.NewFile(uintptr(fd), sock)
	ln, err := net.FileListener(file)
	_ = file.Close()
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(func() { _ = ln.Close() })

	var mu sync.Mutex
	served := 0

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}

			buf := make([]byte, 4096)
			_, _ = conn.Read(buf)
			time.Sleep(work)

			mu.Lock()
			served++
			mu.Unlock()

			_, _ = conn.Write([]byte(`{"ok":true,"results":[]}` + "\n"))
			_ = conn.Close()
		}
	}()

	return sock, func() int {
		mu.Lock()
		defer mu.Unlock()

		return served
	}
}

// Parallel agent tool calls fan out to many concurrent indexer requests. A
// serial indexer with a short backlog must queue them, not refuse them.
func TestClientQueuesConcurrentRequestsForSerialIndexer(t *testing.T) {
	sock, served := startSerialIndexer(t, 2, 5*time.Millisecond)
	c := indexctl.NewClient(sock)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	const requests = 32

	errs := make(chan error, requests)

	var wg sync.WaitGroup
	for i := 0; i < requests; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			_, err := c.Search(ctx, indexctl.SearchOptions{Query: "q", K: 1})
			errs <- err
		}()
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent request failed: %v", err)
		}
	}

	if got := served(); got != requests {
		t.Fatalf("served %d of %d requests", got, requests)
	}
}

func TestClientWaitForSlotHonoursContext(t *testing.T) {
	sock, _ := startSerialIndexer(t, 2, 200*time.Millisecond)
	c := indexctl.NewClient(sock)

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	var wg sync.WaitGroup
	failed := make(chan error, 16)

	for i := 0; i < 16; i++ {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if _, err := c.Search(ctx, indexctl.SearchOptions{Query: "q", K: 1}); err != nil {
				failed <- err
			}
		}()
	}

	wg.Wait()
	close(failed)

	if len(failed) == 0 {
		t.Fatal("requests queued past their deadline should fail")
	}
}
