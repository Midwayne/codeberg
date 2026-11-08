package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestIndexerOutputHasDedicatedLog(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "indexer")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho index-stdout\necho index-stderr >&2\n"), 0o700); err != nil {
		t.Fatal(err)
	}

	s := &Supervisor{cfg: config.Indexer{LogDir: dir}}
	if err := s.spawn(context.Background(), bin); err != nil {
		t.Fatal(err)
	}

	if err := s.cmd.Wait(); err != nil {
		t.Fatal(err)
	}

	s.closeLog()
	data, err := os.ReadFile(filepath.Join(dir, "indexer.log"))
	if err != nil || !strings.Contains(string(data), "index-stdout") || !strings.Contains(string(data), "index-stderr") {
		t.Fatalf("indexer log = %q, err = %v", data, err)
	}
}
