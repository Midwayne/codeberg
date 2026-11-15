package projects

import (
	"net/http"
	"os"
)

// Response buffer keeps not-yet-open IPC sockets from becoming opaque UI errors.
type httptestResponse struct {
	header http.Header
	status int
	body   []byte
}

func (w *httptestResponse) Header() http.Header { return w.header }

func (w *httptestResponse) WriteHeader(status int) { w.status = status }

func (w *httptestResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}

	w.body = append(w.body, b...)
	return len(b), nil
}

func (m *Manager) serveHealth(handler http.Handler, w http.ResponseWriter, r *http.Request, id string) {
	m.mu.Lock()
	project, _ := m.project(id)
	m.mu.Unlock()

	for _, root := range project.Roots {
		info, err := os.Stat(root.Root)
		if err != nil || !info.IsDir() {
			respond(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project directory is unavailable: " + root.Root})
			return
		}
	}

	if message, failing := crashLoop(handler); failing {
		respond(w, 503, map[string]any{"ready": false, "status": "error", "message": message})
		return
	}

	buffered := probe(handler, r)

	// A responding indexer may still be doing a long cold embedding pass.
	// The startup deadline diagnoses unreachable IPC, not healthy progress.
	if buffered.status >= 400 && m.overdue(id) {
		respond(w, 503, map[string]any{"ready": false, "status": "error", "message": "Project indexing has not become ready. Check the project indexer log and retry."})
		return
	}

	if buffered.status >= 400 {
		respond(w, 200, map[string]any{"ready": false, "chunks": 0, "status": "indexing"})
		return
	}

	for k, vs := range buffered.header {
		w.Header()[k] = vs
	}

	w.WriteHeader(buffered.status)
	_, _ = w.Write(buffered.body)
}
