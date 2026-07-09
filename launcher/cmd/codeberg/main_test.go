package main

import (
	"os"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
)

func TestValidateForRunRejectsConfiguredRootWithAllFlag(t *testing.T) {
	dist := t.TempDir()
	a := config.LocateArtifacts(dist)
	for _, p := range []string{a.DaemonBin, a.IndexBin, a.TUIScript} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	root := t.TempDir()
	c := &config.Config{
		Dist:  dist,
		Model: "anthropic:claude",
		Root:  root,
		All:   true,
	}
	if err := c.ValidateForRun(); err == nil {
		t.Fatal("configured CODEBERG_ROOT with --all must fail before cmdRun")
	}
}
