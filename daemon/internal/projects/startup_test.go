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

// fakeStart replaces the indexer with handler and records each started config.
func fakeStart(m *Manager, handler http.Handler, stop func()) *[]config.Indexer {
	var started []config.Indexer

	m.start = func(_ Project, cfg config.Indexer) (http.Handler, func(), error) {
		started = append(started, cfg)
		return handler, stop, nil
	}

	return &started
}

// startedDefault reports the config StartDefault launched, if any.
func startedDefault(t *testing.T, m *Manager) (config.Indexer, bool) {
	t.Helper()
	started := fakeStart(m, http.NotFoundHandler(), func() {})

	if err := m.StartDefault(); err != nil {
		t.Fatal(err)
	}

	if len(*started) == 0 {
		return config.Indexer{}, false
	}

	return (*started)[0], true
}

func TestStartupWithoutProjectAndRestart(t *testing.T) {
	home := t.TempDir()
	base := config.Indexer{Model: "embedding.onnx", PollMS: 1000}

	for attempt := 0; attempt < 2; attempt++ {
		m, err := New(context.Background(), home, base)
		if err != nil {
			t.Fatal(err)
		}

		if _, started := startedDefault(t, m); started {
			t.Fatal("an empty catalog must not start an indexer")
		}

		handler := m.Handler()
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
	cfg, started := startedDefault(t, restored)
	if !started || cfg.Roots[0].Root != p.Roots[0].Root || cfg.Model != base.Model {
		t.Fatalf("restored config: %#v", cfg)
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

	cfg, started := startedDefault(t, restored)
	if !started || cfg.Roots[0].Root != want.Projects[0].Roots[0].Root {
		t.Fatalf("existing project was not restored: %#v", cfg)
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

			if _, err := original.Delete(project.ID, mode); err != nil {
				t.Fatal(err)
			}

			original.Close()
			restored, err := New(context.Background(), home, base)
			if err != nil {
				t.Fatal(err)
			}

			defer restored.Close()
			if _, started := startedDefault(t, restored); started {
				t.Fatal("deleted startup roots must not start an indexer")
			}

			added, err := restored.Add("New project", t.TempDir())
			if err != nil {
				t.Fatal(err)
			}

			cfg, started := startedDefault(t, restored)
			if !started || cfg.Roots[0].Root != added.Roots[0].Root || cfg.Model != base.Model {
				t.Fatalf("new UI project must replace deleted startup roots: %#v", cfg)
			}
		})
	}
}
