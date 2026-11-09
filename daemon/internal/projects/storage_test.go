package projects

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIndexNamespaceSeparatesEmbeddingModels(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]

	jina := m.projectConfig(p).Index
	m.base.IndexNamespace = "qwen3-mlx"
	qwen := m.projectConfig(p).Index

	if jina != filepath.Join(home, "projects", p.ID, "index", "codeberg.usearch") {
		t.Fatalf("default namespace moved existing indexes: %s", jina)
	}

	if qwen != filepath.Join(home, "projects", p.ID, "index", "qwen3-mlx", "codeberg.usearch") {
		t.Fatalf("model namespace shared an index: %s", qwen)
	}
}

func TestLegacyIndexStaysWhereMovingItLosesData(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]

	p.LegacyIndex = filepath.Join(home, "index", "codeberg.usearch")
	if m.projectConfig(p).Index == p.LegacyIndex {
		t.Fatal("a managed local legacy index must migrate into project storage")
	}

	m.base.IndexBackend = "qdrant"
	if m.projectConfig(p).Index != p.LegacyIndex {
		t.Fatal("a remote legacy namespace must keep its collection names")
	}

	m.base.IndexBackend = ""
	p.LegacyIndex = filepath.Join(t.TempDir(), "custom.usearch")
	if m.projectConfig(p).Index != p.LegacyIndex {
		t.Fatal("a custom index location must stay with the user")
	}

	m.base.IndexNamespace = "qwen3-mlx"
	m.base.IndexBackend = "qdrant"
	if m.projectConfig(p).Index != p.LegacyIndex {
		t.Fatal("a remote namespace must keep the original collection path")
	}

	m.base.IndexBackend = ""
	want := filepath.Join(filepath.Dir(p.LegacyIndex), "qwen3-mlx", "custom.usearch")
	if m.projectConfig(p).Index != want {
		t.Fatalf("custom namespace = %s, want %s", m.projectConfig(p).Index, want)
	}
}

func TestRetryRestartsTheProjectIndexer(t *testing.T) {
	m, _ := setup(t)
	p := m.catalog.Projects[0]
	stops := 0
	started := fakeStart(m, http.NotFoundHandler(), func() { stops++ })
	handler := m.Handler()

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/projects/"+p.ID+"/tools", nil))

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("POST", "/projects/"+p.ID+"/retry", nil))
	if w.Code != 200 || stops != 1 {
		t.Fatalf("retry: %d stops=%d", w.Code, stops)
	}

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/projects/"+p.ID+"/tools", nil))
	if len(*started) != 2 {
		t.Fatalf("retry must start a fresh indexer, started %d", len(*started))
	}
}

func TestCatalogReportsProjectStorage(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	w := httptest.NewRecorder()

	m.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/projects", nil))

	var view catalogResponse
	if err := json.Unmarshal(w.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}

	paths := view.Storage[p.ID]
	if paths.Dir != filepath.Join(home, "projects", p.ID) || paths.Index != m.projectConfig(p).Index || paths.Logs != filepath.Join(paths.Dir, "logs") {
		t.Fatalf("storage paths: %#v", view.Storage)
	}

	raw, _ := os.ReadFile(filepath.Join(home, "projects.json"))
	if strings.Contains(string(raw), "storage") {
		t.Fatal("derived storage paths must not be persisted")
	}
}

func TestStorageReportListsEveryIndexSet(t *testing.T) {
	m, home := setup(t)
	p := m.catalog.Projects[0]
	external := filepath.Join(t.TempDir(), "custom.usearch")
	m.catalog.Projects[0].LegacyIndex = external
	if err := m.save(); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		filepath.Join(home, "index", "codeberg.usearch.aaaa.chunks"),
		filepath.Join(home, "projects", p.ID, "index", "codeberg.usearch.bbbb"),
		filepath.Join(home, "projects", p.ID, "index", "qwen3-mlx", "codeberg.usearch.bbbb.manifest"),
		external + ".cccc",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}

		if err := os.WriteFile(path, []byte("cache"), 0600); err != nil {
			t.Fatal(err)
		}
	}

	report, err := StorageReport(home)
	if err != nil {
		t.Fatal(err)
	}

	var names []string
	for _, set := range report.IndexSets {
		names = append(names, set.Name)
	}

	want := "index:aaaa projects/" + p.ID + "/index/qwen3-mlx:bbbb projects/" + p.ID + "/index:bbbb " + p.ID + ":external"
	if strings.Join(names, " ") != want {
		t.Fatalf("index sets = %v, want %s", names, want)
	}
}
