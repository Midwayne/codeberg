package projects

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"codeberg.org/codeberg/daemon/internal/config"
)

func TestCatalogReportsEmbeddingModeBeforeIndexing(t *testing.T) {
	for _, model := range []string{"", "/model.onnx"} {
		t.Run(model, func(t *testing.T) {
			home := t.TempDir()
			m, err := New(context.Background(), home, config.Indexer{Model: model})
			if err != nil {
				t.Fatal(err)
			}

			defer m.Close()
			w := httptest.NewRecorder()
			m.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/projects", nil))

			var body struct {
				VectorsEnabled *bool `json:"vectorsEnabled"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}

			if w.Code != 200 || body.VectorsEnabled == nil || *body.VectorsEnabled != (model != "") {
				t.Fatalf("catalog must report the launch mode: %d %s", w.Code, w.Body)
			}

			saved, err := os.ReadFile(filepath.Join(home, "projects.json"))
			if err != nil {
				t.Fatal(err)
			}

			if len(m.runtimes) != 0 || strings.Contains(string(saved), "vectorsEnabled") {
				t.Fatal("reporting the mode must not start an indexer or persist the launch setting")
			}
		})
	}
}
