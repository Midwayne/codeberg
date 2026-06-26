package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeArtifacts lays out a minimal dist/checkout tree under root so ResolveRoot
// sees all three required artifacts.
func writeArtifacts(t *testing.T, root string) {
	t.Helper()
	a := LocateArtifacts(root)
	for _, p := range []string{a.DaemonBin, a.IndexBin, a.TUIScript} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

func TestResolveRootPrefersPopulatedDist(t *testing.T) {
	dist := t.TempDir()
	writeArtifacts(t, dist)

	c := &Config{Dist: dist, Repo: "/some/checkout"}
	root, prebuilt := c.ResolveRoot()
	if !prebuilt || root != dist {
		t.Fatalf("ResolveRoot() = (%q, %v); want (%q, true)", root, prebuilt, dist)
	}
}

func TestResolveRootFallsBackToRepoWhenDistIncomplete(t *testing.T) {
	dist := t.TempDir() // exists but empty -> not a usable dist
	c := &Config{Dist: dist, Repo: "/some/checkout"}
	root, prebuilt := c.ResolveRoot()
	if prebuilt || root != "/some/checkout" {
		t.Fatalf("ResolveRoot() = (%q, %v); want (\"/some/checkout\", false)", root, prebuilt)
	}
}
