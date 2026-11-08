package projects

import (
	"net/http"

	"codeberg.org/codeberg/daemon/internal/httpserver"
)

func (m *Manager) serveCatalog(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		m.mu.Lock()
		defer m.mu.Unlock()
		httpserver.WriteJSON(w, 200, m.catalogView(m.catalog))
	case "POST":
		m.serveAdd(w, r)
	default:
		httpserver.RejectMethod(w)
	}
}

func (m *Manager) serveAdd(w http.ResponseWriter, r *http.Request) {
	if !allowProjectChange(w, r) {
		return
	}

	var body struct {
		Name string `json:"name"`
		Root string `json:"root"`
	}
	if err := readProjectJSON(w, r, &body); err != nil {
		httpserver.WriteError(w, 400, "invalid project")
		return
	}

	p, err := m.Add(body.Name, body.Root)
	if err != nil {
		httpserver.WriteError(w, 400, err.Error())
		return
	}

	httpserver.WriteJSON(w, 201, p)
}

func (m *Manager) serveRename(w http.ResponseWriter, r *http.Request, id string) {
	if !httpserver.AllowMethod(w, r, "PATCH") {
		return
	}

	if !allowProjectChange(w, r) {
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := readProjectJSON(w, r, &body); err != nil {
		httpserver.WriteError(w, 400, "invalid project name")
		return
	}

	p, err := m.Rename(id, body.Name)
	if err != nil {
		writeProjectError(w, err)
		return
	}

	httpserver.WriteJSON(w, 200, p)
}

func (m *Manager) serveRetry(w http.ResponseWriter, r *http.Request, id string) {
	if !httpserver.AllowMethod(w, r, "POST") {
		return
	}

	if !allowProjectChange(w, r) {
		return
	}

	// Retry restarts the indexer, which also restarts its startup deadline.
	m.mu.Lock()
	m.stopRuntime(id)
	m.mu.Unlock()

	httpserver.WriteJSON(w, 200, map[string]bool{"ok": true})
}
