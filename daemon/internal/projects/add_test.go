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

func addRequest(t *testing.T, m *Manager, root string) *httptest.ResponseRecorder {
	t.Helper()

	body := `{"name":"Again","root":` + quote(root) + `}`
	w := httptest.NewRecorder()
	m.Handler(http.NotFoundHandler()).ServeHTTP(w, httptest.NewRequest("POST", "/projects", strings.NewReader(body)))

	return w
}

func quote(value string) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func TestAddingAnExistingDirectoryPointsToItsProject(t *testing.T) {
	m, _ := setup(t)
	root := t.TempDir()

	first := addRequest(t, m, root)
	if first.Code != 201 {
		t.Fatalf("first add = %d %s", first.Code, first.Body)
	}

	var added Project
	if err := json.Unmarshal(first.Body.Bytes(), &added); err != nil {
		t.Fatal(err)
	}

	second := addRequest(t, m, filepath.Join(root, "."))
	if second.Code != 409 {
		t.Fatalf("duplicate add = %d %s", second.Code, second.Body)
	}

	var conflict struct {
		Message string  `json:"message"`
		Project Project `json:"project"`
	}
	if err := json.Unmarshal(second.Body.Bytes(), &conflict); err != nil {
		t.Fatal(err)
	}

	if conflict.Project.ID != added.ID || !strings.Contains(conflict.Message, "already uses this directory") {
		t.Fatalf("conflict = %#v", conflict)
	}
}

func TestProjectsMayOverlapWhenTheirDirectoriesDiffer(t *testing.T) {
	m, _ := setup(t)
	parent := t.TempDir()
	child := filepath.Join(parent, "api")

	if err := mkdir(child); err != nil {
		t.Fatal(err)
	}

	if w := addRequest(t, m, parent); w.Code != 201 {
		t.Fatalf("parent add = %d %s", w.Code, w.Body)
	}

	if w := addRequest(t, m, child); w.Code != 201 {
		t.Fatalf("nested add = %d %s", w.Code, w.Body)
	}
}

func mkdir(path string) error {
	return os.MkdirAll(path, 0o755)
}
