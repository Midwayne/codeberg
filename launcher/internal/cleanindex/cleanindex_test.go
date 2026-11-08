package cleanindex

import (
	"os"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/launcher/internal/config"
	"codeberg.org/codeberg/launcher/internal/daemonapi"
)

func TestCleanupRemovesReportedFilesOnly(t *testing.T) {
	home := t.TempDir()
	cache := filepath.Join(home, "projects", "p-0123456789abcdef", "index", "qwen", "codeberg.usearch.0123456789abcdef.chunks")
	durable := filepath.Join(home, "projects", "p-0123456789abcdef", "learning", "keep")

	for _, path := range []string{cache, durable} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(path, []byte("data"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	original := loadReport
	loadReport = func(*config.Config) (daemonapi.Report, error) {
		return daemonapi.Report{IndexSets: []daemonapi.IndexSet{{
			Name:  "projects/p-0123456789abcdef/index/qwen:0123456789abcdef",
			Files: []string{cache},
		}}}, nil
	}
	t.Cleanup(func() { loadReport = original })

	c := &config.Config{Home: home}
	if err := Run(c, Options{DryRun: true}); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(cache); err != nil {
		t.Fatal("dry run removed files")
	}

	if err := Run(c, Options{AssumeYes: true}); err != nil {
		t.Fatal(err)
	}

	if _, err := os.Stat(cache); !os.IsNotExist(err) {
		t.Fatal("reported cache retained", cache)
	}

	if _, err := os.Stat(durable); err != nil {
		t.Fatal("durable data removed")
	}
}
