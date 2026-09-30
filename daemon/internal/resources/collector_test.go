package resources

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCachedReadsDoNotWaitForCollection(t *testing.T) {
	processStarted, diskStarted := make(chan struct{}), make(chan struct{})
	release := make(chan struct{})
	c := New(Options{
		PID: 30, Cores: 4, TotalMemory: 48000,
		ReadProcesses: func(ctx context.Context) ([]ProcessCounter, error) {
			close(processStarted)
			select {
			case <-release:
			case <-ctx.Done():
			}
			return nil, ctx.Err()
		},
		ReadDisk: func(ctx context.Context) (*Disk, error) {
			close(diskStarted)
			select {
			case <-release:
			case <-ctx.Done():
			}
			return nil, ctx.Err()
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)
	<-processStarted
	<-diskStarted
	done := make(chan Usage, 1)
	go func() { done <- c.Usage(0) }()
	select {
	case usage := <-done:
		if usage.Current != nil || len(usage.History) != 0 {
			t.Fatalf("cold cache: %+v", usage)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("cached read blocked on sampling or disk scan")
	}
	close(release)
}

func TestCPUCollectionContinuesDuringBlockedDiskScan(t *testing.T) {
	diskStarted := make(chan struct{})
	captures := make(chan struct{}, 4)
	c := New(Options{PID: 30, Cores: 4, TotalMemory: 48000,
		ReadProcesses: func(context.Context) ([]ProcessCounter, error) {
			captures <- struct{}{}
			return []ProcessCounter{{PID: 30, Command: "codeberg-d"}, {PID: 20, Command: "node"}}, nil
		},
		ReadDisk: func(ctx context.Context) (*Disk, error) {
			close(diskStarted)
			<-ctx.Done()
			return nil, ctx.Err()
		},
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	c.Start(ctx)
	<-diskStarted
	<-captures
	if err := c.Register(20); err != nil {
		t.Fatal(err)
	}
	select {
	case <-captures:
	case <-time.After(time.Second):
		t.Fatal("CPU sampling waited for the blocked disk scan")
	}
}

func TestCompleteProcessCoverageAndDeltaHistory(t *testing.T) {
	now := time.UnixMilli(10000)
	rows := []ProcessCounter{
		{PID: 10, PPID: 1, Command: "codeberg", MemoryBytes: 10, CPUTimeMS: 100},
		{PID: 20, PPID: 10, Command: "node", MemoryBytes: 100, CPUTimeMS: 100},
		{PID: 30, PPID: 10, Command: "codeberg-d", MemoryBytes: 200, CPUTimeMS: 100},
		{PID: 40, PPID: 30, Command: "cberg-index", MemoryBytes: 300, CPUTimeMS: 100},
		{PID: 50, PPID: 40, Command: "/home/.codeberg/embedding-venv/bin/python", MemoryBytes: 400, CPUTimeMS: 100},
		{PID: 60, PPID: 20, Command: "dbmcp", MemoryBytes: 500, CPUTimeMS: 100},
		{PID: 70, PPID: 10, Command: "xdg-open", MemoryBytes: 40000},
		{PID: 80, PPID: 70, Command: "firefox", MemoryBytes: 40000},
		{PID: 90, PPID: 1, Command: "codeberg-d", MemoryBytes: 40000},
	}
	c := New(Options{PID: 30, RootPID: 10, Cores: 4, TotalMemory: 48000, ModelPath: "/models/qwen3-fp16-mlx", EmbeddingBackend: "mlx", Now: func() time.Time { return now },
		ReadProcesses: func(context.Context) ([]ProcessCounter, error) { return rows, nil }})
	if err := c.Register(20); err != nil {
		t.Fatal(err)
	}
	if err := c.Capture(context.Background()); err != nil {
		t.Fatal(err)
	}
	if c.Usage(0).Current.CPU.UsedPercent != nil {
		t.Fatal("first CPU interval must be unknown")
	}
	now = now.Add(10 * time.Second)
	rows[1].CPUTimeMS += 1000
	rows[3].CPUTimeMS += 1000
	if err := c.Capture(context.Background()); err != nil {
		t.Fatal(err)
	}
	usage := c.Usage(10000)
	if len(usage.History) != 1 {
		t.Fatalf("delta history: %d", len(usage.History))
	}
	if len(usage.History[0].Processes) != 0 {
		t.Fatal("historical points must not duplicate the current PID table")
	}
	if got := *usage.Current.CPU.UsedPercent; got != 5 {
		t.Fatalf("CPU: got %v want 5", got)
	}
	if got := usage.Current.Memory.UsedBytes; got != 1510 {
		t.Fatalf("memory: got %d want 1510", got)
	}
	if len(usage.Current.Processes) != 6 {
		t.Fatalf("processes: %+v", usage.Current.Processes)
	}
	if usage.Current.Processes[4].Name != "Embedding worker — Qwen3/MLX" {
		t.Fatalf("embedding worker label: %q", usage.Current.Processes[4].Name)
	}
}

func TestDiskScanOwnedPathsAndHardlinks(t *testing.T) {
	home, external := t.TempDir(), t.TempDir()
	data := filepath.Join(home, "data.json")
	model := filepath.Join(external, "model.onnx")
	index := filepath.Join(external, "index.usearch.repo.chunks")
	for _, path := range []string{data, model, index, filepath.Join(external, "unrelated")} {
		if err := os.WriteFile(path, make([]byte, 16384), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Link(index, filepath.Join(home, "index-copy")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(external, "unrelated"), filepath.Join(home, "link")); err != nil {
		t.Fatal(err)
	}
	disk, err := ScanDisk(context.Background(), Options{Home: home, ModelPath: model, IndexPath: filepath.Join(external, "index.usearch")})
	if err != nil {
		t.Fatal(err)
	}
	var expected int64
	for _, path := range []string{data, model, index} {
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		size, _ := fileAllocation(info)
		expected += size
	}
	if disk.CodebergBytes != expected {
		t.Fatalf("disk: got %d want %d", disk.CodebergBytes, expected)
	}
}

func TestProcessParsingAndNativeSnapshot(t *testing.T) {
	if systemMemory() <= 0 {
		t.Fatal("native physical memory unavailable")
	}
	rows := parsePS("20 10 1:02.50 1024 Wed Sep 30 07:00:00 2026 /usr/local/bin/node\n30 10 1-02:03:04 2048 Wed Sep 30 07:00:00 2026 /some path/codeberg-d\n")
	if len(rows) != 2 || rows[0].CPUTimeMS != 62500 || rows[1].CPUTimeMS != 93784000 {
		t.Fatalf("parse: %+v", rows)
	}
	snapshot, err := nativeProcesses(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range snapshot {
		if row.PID == os.Getpid() && row.MemoryBytes > 0 {
			return
		}
	}
	t.Fatal("native snapshot omitted the running process")
}

func TestStandaloneWebPIDReuseAndBoundedHistory(t *testing.T) {
	now := time.UnixMilli(10000)
	rows := []ProcessCounter{{PID: 30, PPID: 1, Command: "codeberg-d", MemoryBytes: 10},
		{PID: 20, PPID: 1, Command: "node", MemoryBytes: 100, StartedAt: 1}}
	c := New(Options{PID: 30, Cores: 4, TotalMemory: 48000, Now: func() time.Time { return now },
		ReadProcesses: func(context.Context) ([]ProcessCounter, error) { return rows, nil }})
	if err := c.Register(20); err != nil {
		t.Fatal(err)
	}
	_ = c.Capture(context.Background())
	if len(c.Usage(0).Current.Processes) != 2 {
		t.Fatal("standalone web process missing")
	}
	rows[1].StartedAt = 15000
	now = now.Add(10 * time.Second)
	_ = c.Capture(context.Background())
	if len(c.Usage(0).Current.Processes) != 1 {
		t.Fatal("reused PID was attributed without re-registration")
	}
	if err := c.Register(20); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 400; i++ {
		now = now.Add(10 * time.Second)
		_ = c.Capture(context.Background())
	}
	usage := c.Usage(0)
	if len(usage.History) != 360 || len(usage.Current.Processes) != 2 {
		t.Fatalf("bounded history or re-registration: %+v", usage)
	}
}
