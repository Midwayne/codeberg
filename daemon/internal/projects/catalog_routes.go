package projects

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

func (m *Manager) serveCatalog(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		m.mu.Lock()
		defer m.mu.Unlock()
		respond(w, 200, m.catalog)
	case "POST":
		m.serveAdd(w, r)
	default:
		respond(w, 405, map[string]string{"message": "method not allowed"})
	}
}

func (m *Manager) serveAdd(w http.ResponseWriter, r *http.Request) {
	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
		return
	}

	var body struct {
		Name string `json:"name"`
		Root string `json:"root"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		respond(w, 400, map[string]string{"message": "invalid project"})
		return
	}

	p, err := m.Add(body.Name, body.Root)
	if err != nil {
		respond(w, 400, map[string]string{"message": err.Error()})
		return
	}

	respond(w, 201, p)
}

func (m *Manager) serveRename(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != "PATCH" {
		respond(w, 405, map[string]string{"message": "method not allowed"})
		return
	}

	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
		return
	}

	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil {
		respond(w, 400, map[string]string{"message": "invalid project name"})
		return
	}

	p, err := m.Rename(id, body.Name)
	if err != nil {
		status := 500
		if errors.Is(err, errProjectName) {
			status = 400
		}

		if errors.Is(err, errProjectNotFound) {
			status = 404
		}

		respond(w, status, map[string]string{"message": err.Error()})
		return
	}

	respond(w, 200, p)
}

func (m *Manager) serveRetry(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != "POST" {
		respond(w, 405, map[string]string{"message": "method not allowed"})
		return
	}

	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
		return
	}

	m.mu.Lock()
	rt, active := m.runtimes[id]
	if active {
		rt.started = time.Now()
		m.runtimes[id] = rt
	}

	m.mu.Unlock()
	respond(w, 200, map[string]bool{"ok": true})
}
