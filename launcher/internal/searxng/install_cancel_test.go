package searxng

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestCancelInstallStopsSubprocessesAndReturnsPromptly(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- runCmd(ctx, io.Discard, dir, "sh", "-c", `sleep 30 & echo $! > child.pid; wait`)
	}()

	var child int
	deadline := time.Now().Add(3 * time.Second)
	for child == 0 && time.Now().Before(deadline) {
		data, _ := os.ReadFile(filepath.Join(dir, "child.pid"))
		child, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		if child == 0 {
			time.Sleep(time.Millisecond)
		}
	}
	if child == 0 {
		t.Fatal("installer child did not start")
	}
	t.Cleanup(func() { _ = syscall.Kill(child, syscall.SIGKILL) })
	cancel()

	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled install unexpectedly succeeded")
		}
	case <-time.After(2 * time.Second):
		_ = syscall.Kill(child, syscall.SIGKILL)
		<-done
		t.Fatal("installer descendants kept running after cancellation")
	}
}
