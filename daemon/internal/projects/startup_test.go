package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestStartupWithoutProjectAndRestart(t *testing.T) {
	home := t.TempDir()
	base := config.Indexer{Socket: filepath.Join(home, "index.sock"), Model: "embedding.onnx", PollMS: 1000}

	for attempt := 0; attempt < 2; attempt++ {
		m, err := New(context.Background(), home, base)
		if err != nil {
			t.Fatal(err)
		}

		cfg, err := m.InitialConfig()
		if err != nil || len(cfg.Roots) != 0 || cfg.Model != base.Model || cfg.Socket != base.Socket {
			t.Fatalf("initial config: %#v, %v", cfg, err)
		}

		handler := m.Handler(http.NotFoundHandler())
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/projects", nil))

		var catalog Catalog
		if err := json.Unmarshal(w.Body.Bytes(), &catalog); err != nil {
			t.Fatal(err)
		}

		if w.Code != 200 || catalog.Projects == nil || len(catalog.Projects) != 0 || catalog.DefaultID != "" || catalog.LegacyID != "" {
			t.Fatalf("empty catalog: %d %s", w.Code, w.Body)
		}

		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
		if w.Code != 200 || len(m.runtimes) != 0 {
			t.Fatalf("idle daemon must be healthy without an indexer: %d %s", w.Code, w.Body)
		}

		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/tools", nil))
		if w.Code != 404 {
			t.Fatalf("repository tools require a project: %d", w.Code)
		}

		m.Close()
	}
}

func TestFirstAddedProjectRestoresWithoutStartupRoots(t *testing.T) {
	home := t.TempDir()
	base := config.Indexer{Model: "embedding.onnx", PollMS: 1000}
	m, err := New(context.Background(), home, base)
	if err != nil {
		t.Fatal(err)
	}

	p, err := m.Add("First", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	m.Close()
	restored, err := New(context.Background(), home, base)
	if err != nil {
		t.Fatal(err)
	}

	defer restored.Close()
	cfg, err := restored.InitialConfig()
	if err != nil || cfg.Root != p.Roots[0].Root || cfg.Model != base.Model {
		t.Fatalf("restored config: %#v, %v", cfg, err)
	}

	if len(restored.catalog.Projects) != 1 || restored.catalog.DefaultID != p.ID || restored.catalog.LegacyID != "" {
		t.Fatalf("restored catalog: %#v", restored.catalog)
	}
}

func TestSavedLegacyProjectRestoresWithoutStartupRoots(t *testing.T) {
	original, home := setup(t)
	want := original.catalog

	restored, err := New(context.Background(), home, config.Indexer{Model: "embedding.onnx"})
	if err != nil {
		t.Fatal(err)
	}

	defer restored.Close()
	if restored.catalog.DefaultID != want.DefaultID || restored.catalog.LegacyID != want.LegacyID || len(restored.catalog.Projects) != len(want.Projects) {
		t.Fatalf("rootless restart changed the existing workspace: %#v", restored.catalog)
	}

	cfg, err := restored.InitialConfig()
	if err != nil || cfg.Root != want.Projects[0].Roots[0].Root {
		t.Fatalf("existing project was not restored: %#v, %v", cfg, err)
	}
}

func TestDeletedStartupProjectRestartsIdle(t *testing.T) {
	for _, mode := range []string{"index", "all"} {
		t.Run(mode, func(t *testing.T) {
			original, home := setup(t)
			project := original.catalog.Projects[0]
			base := original.base
			base.Model = "embedding.onnx"
			base.Index = filepath.Join(home, "index", "codeberg.usearch")
			base.Socket = filepath.Join(home, "index.sock")

			if _, err := original.Delete(project.ID, mode); err != nil {
				t.Fatal(err)
			}

			original.Close()
			restored, err := New(context.Background(), home, base)
			if err != nil {
				t.Fatal(err)
			}

			defer restored.Close()
			cfg, err := restored.InitialConfig()
			if err != nil {
				t.Fatal(err)
			}

			if cfg.Root != "" || len(cfg.Roots) != 0 || cfg.DefaultKey != "" {
				t.Fatalf("deleted startup roots must not start an indexer: %#v", cfg)
			}

			if cfg.Model != base.Model || cfg.Index != base.Index || cfg.Socket != base.Socket {
				t.Fatalf("idle config must preserve settings for future projects: %#v", cfg)
			}

			added, err := restored.Add("New project", t.TempDir())
			if err != nil {
				t.Fatal(err)
			}

			cfg, err = restored.InitialConfig()
			if err != nil || cfg.Root != added.Roots[0].Root {
				t.Fatalf("new UI project must replace deleted startup roots: %#v, %v", cfg, err)
			}
		})
	}
}
