package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestStopWaitsForFinalIndexWrite(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "fake-indexer")
	saved := filepath.Join(dir, "saved")
	ready := filepath.Join(dir, "ready")
	script := "#!/bin/sh\ntrap 'echo saved > \"" + saved + "\"; exit 0' INT\necho ready > \"" + ready + "\"\nwhile :; do :; done\n"
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	sup, err := Start(context.Background(), config.Indexer{Bin: bin})
	if err != nil {
		t.Fatal(err)
	}
	defer sup.Stop()
	for deadline := time.Now().Add(time.Second); ; {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("indexer did not start")
		}
		time.Sleep(time.Millisecond)
	}

	sup.Stop()
	if _, err := os.Stat(saved); err != nil {
		t.Fatal("Stop returned before indexer shutdown write", err)
	}
}
