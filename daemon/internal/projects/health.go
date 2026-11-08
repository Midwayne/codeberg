package projects

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"time"

	"codeberg.org/codeberg/daemon/internal/bootstrap"
	"codeberg.org/codeberg/daemon/internal/httpserver"
)

// serveHealth buffers the indexer's answer so a not-yet-open IPC socket reads
// as "indexing" instead of an opaque error, until the startup deadline passes.
func (m *Manager) serveHealth(handler http.Handler, w http.ResponseWriter, r *http.Request, id string) {
	m.mu.Lock()
	project, _ := m.project(id)
	m.mu.Unlock()

	for _, root := range project.Roots {
		info, err := os.Stat(root.Root)
		if err != nil || !info.IsDir() {
			httpserver.WriteJSON(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project directory is unavailable: " + root.Root})
			return
		}
	}

	buffered := httptest.NewRecorder()
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	handler.ServeHTTP(buffered, r.WithContext(ctx))
	m.mu.Lock()
	rt := m.runtimes[id]
	m.mu.Unlock()

	// A responding indexer may still be doing a long cold embedding pass.
	// The startup deadline diagnoses unreachable IPC, not healthy progress.
	deadline := bootstrap.StartupTimeout(m.settings.HealthTimeout, len(project.Roots))
	if buffered.Code >= 400 && !rt.started.IsZero() && time.Since(rt.started) > deadline {
		httpserver.WriteJSON(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project indexing has not become ready. Check the project indexer log and retry."})
		return
	}

	if buffered.Code >= 400 {
		httpserver.WriteJSON(w, 200, map[string]any{"ready": false, "chunks": 0, "status": "indexing"})
		return
	}

	for k, vs := range buffered.Header() {
		w.Header()[k] = vs
	}

	w.WriteHeader(buffered.Code)
	_, _ = w.Write(buffered.Body.Bytes())
}
