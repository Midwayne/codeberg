package projects

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestDeleteProjectModesAndReuse(t *testing.T) {
	for _, mode := range []string{"index", "all"} {
		t.Run(mode, func(t *testing.T) {
			m, home := setup(t)
			p := m.catalog.Projects[0]
			dir := filepath.Join(home, "projects", p.ID)
			for _, name := range []string{"index/codeberg.usearch.abc.chunks", "learning/knowledge/service.md", "web-sessions/chat.json", "context/history.json", "mcp.json"} {
				path := filepath.Join(dir, name)
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("saved"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			stopped := false
			m.BindDefault(http.NotFoundHandler(), func() { stopped = true })
			w := httptest.NewRecorder()
			m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("DELETE", "/projects/"+p.ID, strings.NewReader(`{"mode":"`+mode+`"}`)))
			if w.Code != 200 {
				t.Fatalf("delete: %d %s", w.Code, w.Body)
			}
			if !stopped || len(m.catalog.Projects) != 0 || m.catalog.DefaultID != "" {
				t.Fatal("project still active")
			}
			if _, err := os.Stat(filepath.Join(dir, "index")); !os.IsNotExist(err) {
				t.Fatal("index retained", err)
			}
			_, err := os.Stat(filepath.Join(dir, "learning/knowledge/service.md"))
			if (mode == "index" && err != nil) || (mode == "all" && !os.IsNotExist(err)) {
				t.Fatal("wrong knowledge retention", err)
			}
			if _, err := os.Stat(p.Roots[0].Root); err != nil {
				t.Fatal("source removed", err)
			}
			restored, err := New(context.Background(), home, m.base)
			if err != nil {
				t.Fatal(err)
			}
			defer restored.Close()
			if len(restored.catalog.Projects) != 0 {
				t.Fatal("deleted startup project returned")
			}
			added, err := restored.Add("Again", p.Roots[0].Root)
			if err != nil || added.ID != p.ID || restored.catalog.DefaultID != p.ID {
				t.Fatal("re-add failed", err)
			}
		})
	}
}

func TestDeleteValidationAndFallback(t *testing.T) {
	m, _ := setup(t)
	first := m.catalog.Projects[0]
	next, _ := m.Add("Next", t.TempDir())
	handler := m.Handler(http.NotFoundHandler())
	for _, tc := range []struct {
		id, body, origin string
		status           int
	}{
		{first.ID, `{}`, "", 400},
		{first.ID, `{"mode":"unknown"}`, "", 400},
		{first.ID, `{"mode":"all"}`, "https://other.example", 403},
		{"missing", `{"mode":"all"}`, "", 404},
	} {
		req := httptest.NewRequest("DELETE", "/projects/"+tc.id, strings.NewReader(tc.body))
		req.Header.Set("Origin", tc.origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.body, w.Code, w.Body)
		}
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("DELETE", "/projects/"+first.ID, strings.NewReader(`{"mode":"index"}`)))
	if w.Code != 200 || m.catalog.DefaultID != next.ID {
		t.Fatal("default not reassigned")
	}
	m.start = func(p Project, _ config.Indexer) (http.Handler, func(), error) {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(p.ID)) }), func() {}, nil
	}
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/tools", nil))
	if w.Body.String() != next.ID {
		t.Fatal("unscoped route uses deleted project")
	}
}

func TestDeleteSaveFailurePreservesDataAndRuntime(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	path := filepath.Join(home, "projects", p.ID, "learning", "knowledge.md")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	stopped := false
	m.BindDefault(http.NotFoundHandler(), func() { stopped = true })
	if err := os.Remove(filepath.Join(home, "projects.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(home, "projects.json"), 0700); err != nil {
		t.Fatal(err)
	}

	if _, err := m.Delete(p.ID, "all"); err == nil {
		t.Fatal("expected catalog failure")
	}
	if stopped {
		t.Fatal("runtime stopped despite save failure")
	}
	if _, ok := m.project(p.ID); !ok {
		t.Fatal("project removed despite failure")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("knowledge lost", err)
	}
}

func TestRemoteWipeFailureKeepsProjectAndHistory(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	m.base.IndexBackend = "qdrant"
	m.base.Bin = filepath.Join(home, "missing-indexer")
	path := filepath.Join(home, "projects", p.ID, "web-sessions", "chat.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}

	if _, err := m.Delete(p.ID, "all"); err == nil {
		t.Fatal("expected wipe failure")
	}
	if _, ok := m.project(p.ID); !ok {
		t.Fatal("failed wipe unregistered project")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("history lost", err)
	}
	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	if _, ok := restored.project(p.ID); !ok {
		t.Fatal("rollback did not persist")
	}
}

func TestExternalIndexDeletionOnlyRemovesIndexFamily(t *testing.T) {
	m, _ := setup(t)
	p := m.catalog.Projects[0]
	base := filepath.Join(t.TempDir(), "custom.usearch")
	m.catalog.Projects[0].LegacyIndex = base
	for _, suffix := range []string{"", ".0123.chunks", "-unrelated"} {
		if err := os.WriteFile(base+suffix, []byte("cache"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := m.Delete(p.ID, "index"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(base); !os.IsNotExist(err) {
		t.Fatal("external index retained")
	}
	if _, err := os.Stat(base + ".0123.chunks"); !os.IsNotExist(err) {
		t.Fatal("external sidecar retained")
	}
	if _, err := os.Stat(base + "-unrelated"); err != nil {
		t.Fatal("neighbor removed")
	}
	again, err := m.Add("Again", p.Roots[0].Root)
	if err != nil || again.LegacyIndex != base {
		t.Fatal("legacy namespace lost", err)
	}
}
