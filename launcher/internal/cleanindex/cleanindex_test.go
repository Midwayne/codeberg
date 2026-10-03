package cleanindex

import (
	"codeberg.org/codeberg/launcher/internal/config"
	"os"
	"path/filepath"
	"testing"
)

func TestCleanupIncludesProjectCachesAndKeepsDurableData(t *testing.T) {
	home := t.TempDir()
	c := &config.Config{Home: home, IndexPath: filepath.Join(home, "index", "codeberg.usearch")}
	paths := []string{c.IndexPath + ".0123456789abcdef.chunks", filepath.Join(home, "projects", "p-0123456789abcdef", "index", "codeberg.usearch.0123456789abcdef.chunks")}
	durable := filepath.Join(home, "projects", "p-0123456789abcdef", "learning", "keep")
	for _, p := range append(paths, durable) {
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := Run(c, Options{DryRun: true}); err != nil {
		t.Fatal(err)
	}
	for _, p := range paths {
		if _, err := os.Stat(p); err != nil {
			t.Fatal("dry run removed files")
		}
	}
	if err := Run(c, Options{AssumeYes: true}); err != nil {
		t.Fatal(err)
	}
	for _, p := range paths {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatal("cache retained", p)
		}
	}
	if _, err := os.Stat(durable); err != nil {
		t.Fatal("durable data removed")
	}
}
