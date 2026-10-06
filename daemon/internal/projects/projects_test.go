package projects

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/domain"
)

func setup(t *testing.T) (*Manager, string) {
	t.Helper()
	home := t.TempDir()
	root := t.TempDir()
	m, err := New(context.Background(), home, config.Indexer{Root: root, Roots: []domain.Repo{{Key: "original", Root: root}}, DefaultKey: "original"})
	if err != nil {
		t.Fatal(err)
	}

	t.Cleanup(m.Close)
	return m, home
}

func TestCatalogCanonicalRootsAndRestart(t *testing.T) {
	m, home := setup(t)
	root := t.TempDir()
	p, err := m.Add("Other", root)
	if err != nil {
		t.Fatal(err)
	}

	duplicate, err := m.Add("Alias", filepath.Join(root, "."))
	if err != nil || duplicate.ID != p.ID {
		t.Fatalf("duplicate = %#v, %v", duplicate, err)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}

	defer restored.Close()

	if len(restored.catalog.Projects) != 2 || restored.catalog.LegacyID != m.catalog.LegacyID {
		t.Fatal("catalog lost on restart")
	}

	if _, err := m.Add("Bad", filepath.Join(home, "missing")); err == nil {
		t.Fatal("accepted missing directory")
	}
}

func TestRenamePersistsWithoutChangingProjectIdentity(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	w := httptest.NewRecorder()
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("PATCH", "/projects/"+p.ID, strings.NewReader(`{"name":"  New workspace  "}`)))

	if w.Code != 200 {
		t.Fatalf("rename: %d %s", w.Code, w.Body)
	}

	var updated Project
	if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}

	want := p
	want.Name = "New workspace"
	if !reflect.DeepEqual(updated, want) || len(m.runtimes) != 0 {
		t.Fatalf("rename changed identity or started an indexer: %#v", updated)
	}

	restored, err := New(context.Background(), home, m.base)
	if err != nil {
		t.Fatal(err)
	}

	defer restored.Close()

	if got, _ := restored.project(p.ID); !reflect.DeepEqual(got, want) {
		t.Fatalf("rename lost on restart: %#v", got)
	}
}

func TestRenameValidationAndSaveFailure(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	handler := m.Handler(http.NotFoundHandler())

	for _, tc := range []struct {
		method, id, body, origin string
		status                   int
	}{
		{"PATCH", p.ID, `{}`, "", 400},
		{"PATCH", p.ID, `{"name":"   "}`, "", 400},
		{"PATCH", p.ID, `{"name":123}`, "", 400},
		{"PATCH", p.ID, `{"name":"` + strings.Repeat("a", 121) + `"}`, "", 400},
		{"PATCH", p.ID, `{"name":"Renamed"}`, "https://other.example", 403},
		{"PATCH", "missing", `{"name":"Renamed"}`, "", 404},
		{"POST", p.ID, `{"name":"Renamed"}`, "", 405},
	} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest(tc.method, "/projects/"+tc.id, strings.NewReader(tc.body))
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}

		handler.ServeHTTP(w, r)

		if w.Code != tc.status {
			t.Errorf("%s %s: %d %s", tc.method, tc.body, w.Code, w.Body)
		}
	}

	// A catalog path that cannot be replaced must leave the in-memory name intact.
	if err := os.Remove(filepath.Join(home, "projects.json")); err != nil {
		t.Fatal(err)
	}

	if err := os.Mkdir(filepath.Join(home, "projects.json"), 0700); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("PATCH", "/projects/"+p.ID, strings.NewReader(`{"name":"Unsaved"}`)))

	if w.Code != 500 {
		t.Fatalf("save failure: %d %s", w.Code, w.Body)
	}

	if got, _ := m.project(p.ID); got.Name != p.Name {
		t.Fatal("failed rename changed in-memory catalog")
	}
}

func TestRoutesIsolateProjectsAndStartOnce(t *testing.T) {
	m, _ := setup(t)
	a, _ := m.Add("A", t.TempDir())
	b, _ := m.Add("B", t.TempDir())
	var starts atomic.Int32
	m.start = func(p Project, cfg config.Indexer) (http.Handler, func(), error) {
		starts.Add(1)

		if cfg.Root != p.Roots[0].Root || !strings.Contains(cfg.Index, p.ID) || cfg.DefaultKey != p.Roots[0].Key {
			t.Error("unscoped runtime")
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(p.ID + ":" + r.URL.Path)) }), func() {}, nil
	}
	handler := m.Handler(http.NotFoundHandler())

	for _, p := range []Project{a, b, a} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/projects/"+p.ID+"/tools", nil))

		if w.Code != 200 || w.Body.String() != p.ID+":/tools" {
			t.Fatalf("response %d %s", w.Code, w.Body)
		}
	}

	if starts.Load() != 2 {
		t.Fatalf("started %d times", starts.Load())
	}

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/projects/unknown/tools", nil))

	if w.Code != 404 {
		t.Fatal("unknown project fell back to default")
	}
}

func TestMigrationMovesOnlyIndexFamily(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	old := filepath.Join(home, "index", "codeberg.usearch")
	_ = os.MkdirAll(filepath.Dir(old), 0700)

	for _, suffix := range []string{".abcdef.chunks", ".abcdef.manifest"} {
		_ = os.WriteFile(old+suffix, []byte(suffix), 0600)
	}

	_ = os.WriteFile(old+"-unrelated", []byte("keep"), 0600)
	m, err := New(context.Background(), home, config.Indexer{Root: root, Roots: []domain.Repo{{Key: "root", Root: root}}, Index: old})
	if err != nil {
		t.Fatal(err)
	}

	defer m.Close()
	cfg, err := m.InitialConfig()
	if err != nil {
		t.Fatal(err)
	}

	if data, err := os.ReadFile(cfg.Index + ".abcdef.chunks"); err != nil || string(data) != ".abcdef.chunks" {
		t.Fatal("index not migrated", err)
	}

	if _, err := os.Stat(old + "-unrelated"); err != nil {
		t.Fatal("unrelated file moved")
	}

	raw, _ := os.ReadFile(filepath.Join(home, "projects.json"))
	var cat Catalog
	if json.Unmarshal(raw, &cat) != nil || cat.Version != 1 {
		t.Fatal("missing versioned catalog")
	}
}

func TestInheritedRootsCannotLeakIntoProjectIndexer(t *testing.T) {
	// Exercised with a small executable: the project must receive only its root,
	// even when the daemon was launched with an inherited CODEBERG_ROOTS list.
	m, home := setup(t)
	root := t.TempDir()
	p, _ := m.Add("Child", root)
	bin := filepath.Join(home, "fake-indexer")
	output := filepath.Join(home, "seen-root")
	script := "#!/bin/sh\nprintf '%s|%s' \"$CODEBERG_ROOT\" \"${CODEBERG_ROOTS-unset}\" > '" + output + "'\nsleep 30\n"
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CODEBERG_ROOTS", "other\t/other")
	m.base.Bin = bin
	if _, err := m.activate(p.ID); err != nil {
		t.Fatal(err)
	}

	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		data, err := os.ReadFile(output)
		if err == nil {
			if string(data) != p.Roots[0].Root+"|"+config.FormatRoots(p.Roots) {
				t.Fatalf("leaked roots %q", data)
			}
			return
		}

		time.Sleep(10 * time.Millisecond)
	}

	t.Fatal("indexer did not start")
}

func TestInitialSocketCompatibilityAndMissingDirectory(t *testing.T) {
	m, _ := setup(t)
	m.base.Socket = filepath.Join(t.TempDir(), "legacy.sock")
	cfg, err := m.InitialConfig()
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Socket != m.base.Socket {
		t.Fatal("legacy IPC socket changed")
	}

	p, _ := m.Add("Removed", t.TempDir())
	m.start = func(Project, config.Indexer) (http.Handler, func(), error) {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(`{"ready":true}`)) }), func() {}, nil
	}
	if err := os.RemoveAll(p.Roots[0].Root); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("GET", "/projects/"+p.ID+"/health", nil))

	if w.Code != 503 || !strings.Contains(w.Body.String(), "unavailable") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
