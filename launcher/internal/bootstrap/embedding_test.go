package bootstrap

import (
	"errors"
	"strings"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
)

func withPrepareModel(t *testing.T, fn func(*config.Config, string) error) {
	t.Helper()

	original := prepareModel
	prepareModel = fn
	t.Cleanup(func() { prepareModel = original })
}

func TestRunStartsWithoutSemanticSearchWhenModelSetupFails(t *testing.T) {
	withPrepareModel(t, func(*config.Config, string) error { return errors.New("mirror unreachable") })
	c := &config.Config{Vector: true}

	var err error
	out := captureStderr(t, func() { err = ensureEmbedding(c, "/root", false) })

	if err != nil {
		t.Fatalf("a normal run must not fail: %v", err)
	}
	if c.Vector {
		t.Fatal("semantic search must be off for this run")
	}
	for _, want := range []string{"Semantic search is off", "mirror unreachable", "codeberg build"} {
		if !strings.Contains(out, want) {
			t.Fatalf("warning %q does not mention %q", out, want)
		}
	}
}

func TestBuildStillReportsModelSetupFailure(t *testing.T) {
	withPrepareModel(t, func(*config.Config, string) error { return errors.New("mirror unreachable") })
	c := &config.Config{Vector: true}

	if err := ensureEmbedding(c, "/root", true); err == nil || !c.Vector {
		t.Fatalf("codeberg build must fail loudly: err=%v vector=%v", err, c.Vector)
	}
}

func TestEmbeddingSetupKeepsSemanticSearchWhenReadyOrDisabled(t *testing.T) {
	calls := 0
	withPrepareModel(t, func(*config.Config, string) error { calls++; return nil })

	on := &config.Config{Vector: true}
	if err := ensureEmbedding(on, "/root", false); err != nil || !on.Vector {
		t.Fatalf("ready model: err=%v vector=%v", err, on.Vector)
	}

	off := &config.Config{}
	if err := ensureEmbedding(off, "/root", false); err != nil || calls != 1 {
		t.Fatalf("disabled vectors must skip setup: err=%v calls=%d", err, calls)
	}
}
