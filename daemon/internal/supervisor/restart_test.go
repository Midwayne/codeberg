package supervisor

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
)

func fakeIndexer(t *testing.T, script string) string {
	t.Helper()

	bin := filepath.Join(t.TempDir(), "fake-indexer")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+script), 0o700); err != nil {
		t.Fatal(err)
	}

	return bin
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()

	for deadline := time.Now().Add(5 * time.Second); !done(); {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}

		time.Sleep(5 * time.Millisecond)
	}
}

func TestCrashingIndexerReportsWhyAndBacksOff(t *testing.T) {
	runs := filepath.Join(t.TempDir(), "runs")
	bin := fakeIndexer(t, "echo run >> \""+runs+"\"\necho 'cberg-index: bootstrap: no repo could be indexed' >&2\nexit 1\n")

	sup, err := Start(context.Background(), config.Indexer{Bin: bin, LogDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer sup.Stop()

	waitFor(t, "first failure", func() bool { return sup.State().Failures >= 1 })

	state := sup.State()
	if !strings.Contains(state.LastError, "no repo could be indexed") || !strings.Contains(state.LastError, "exit status 1") {
		t.Fatalf("last error = %q, want exit status and the indexer's last line", state.LastError)
	}
	if !strings.HasSuffix(state.LogPath, "indexer.log") {
		t.Fatalf("log path = %q", state.LogPath)
	}

	// The second restart waits twice as long: a failing indexer must not spin.
	waitFor(t, "second failure", func() bool { return sup.State().Failures >= 2 })
	time.Sleep(initialBackoff + initialBackoff/2)

	data, _ := os.ReadFile(runs)
	if got := strings.Count(string(data), "run"); got > 2 {
		t.Fatalf("indexer ran %d times; restarts did not back off", got)
	}
}

func TestRetryRestartsWithoutWaitingForBackoff(t *testing.T) {
	runs := filepath.Join(t.TempDir(), "runs")
	bin := fakeIndexer(t, "echo run >> \""+runs+"\"\nexit 1\n")

	sup, err := Start(context.Background(), config.Indexer{Bin: bin})
	if err != nil {
		t.Fatal(err)
	}
	defer sup.Stop()

	waitFor(t, "second failure", func() bool { return sup.State().Failures >= 2 })
	sup.Retry(false)

	// Retrying clears the streak and skips the remaining two-second wait.
	started := time.Now()
	waitFor(t, "retried run", func() bool {
		data, _ := os.ReadFile(runs)
		return strings.Count(string(data), "run") >= 3
	})

	if waited := time.Since(started); waited > initialBackoff {
		t.Fatalf("retry waited %s for the backoff", waited)
	}
	if failures := sup.State().Failures; failures > 1 {
		t.Fatalf("failures = %d after retry, want the streak cleared", failures)
	}
}

func TestForcedRetryReplacesAnUnresponsiveIndexer(t *testing.T) {
	runs := filepath.Join(t.TempDir(), "runs")
	bin := fakeIndexer(t, "trap 'exit 0' INT\necho run >> \""+runs+"\"\nwhile :; do :; done\n")

	sup, err := Start(context.Background(), config.Indexer{Bin: bin})
	if err != nil {
		t.Fatal(err)
	}
	defer sup.Stop()

	count := func() int {
		data, _ := os.ReadFile(runs)
		return strings.Count(string(data), "run")
	}
	waitFor(t, "first run", func() bool { return count() == 1 })

	sup.Retry(false)
	time.Sleep(100 * time.Millisecond)
	if count() != 1 {
		t.Fatal("an unforced retry replaced a running indexer")
	}

	sup.Retry(true)
	waitFor(t, "replacement run", func() bool { return count() == 2 })

	if failures := sup.State().Failures; failures != 0 {
		t.Fatalf("failures = %d; a requested restart is not a failure", failures)
	}
}
