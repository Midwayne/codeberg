package projects

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"codeberg.org/codeberg/daemon/internal/httpserver"
)

const projectJSONLimit = 8192

func (m *Manager) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/projects/pick-directory":
			desktopFolderPicker.ServeHTTP(w, r)
		case r.URL.Path == "/projects":
			m.serveCatalog(w, r)
		case strings.HasPrefix(r.URL.Path, "/projects/"):
			m.serveProject(w, r)
		default:
			m.serveDefault(w, r)
		}
	})
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")

	return origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host
}

func allowProjectChange(w http.ResponseWriter, r *http.Request) bool {
	if sameOrigin(r) {
		return true
	}

	httpserver.WriteError(w, 403, "cross-origin project changes are not allowed")

	return false
}

func writeProjectError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	if errors.Is(err, errProjectName) {
		status = http.StatusBadRequest
	}

	if errors.Is(err, errProjectNotFound) {
		status = http.StatusNotFound
	}

	httpserver.WriteError(w, status, err.Error())
}

func readProjectJSON(w http.ResponseWriter, r *http.Request, dest any) error {
	return json.NewDecoder(http.MaxBytesReader(w, r.Body, projectJSONLimit)).Decode(dest)
}

func (m *Manager) serveProject(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/projects/"), "/", 2)
	m.mu.Lock()
	_, ok := m.project(parts[0])
	m.mu.Unlock()
	if !ok {
		httpserver.WriteError(w, 404, errProjectNotFound.Error())
		return
	}

	if len(parts) == 1 {
		if r.Method == "DELETE" {
			m.serveDelete(w, r, parts[0])
		} else {
			m.serveRename(w, r, parts[0])
		}
		return
	}

	if parts[1] == "retry" {
		m.serveRetry(w, r, parts[0])
		return
	}

	handler, err := m.activate(parts[0])
	if err != nil {
		httpserver.WriteError(w, 503, err.Error())
		return
	}

	next := r.Clone(r.Context())
	next.URL.Path = "/" + parts[1]
	if parts[1] == "health" {
		m.serveHealth(handler, w, next, parts[0])
		return
	}

	handler.ServeHTTP(w, next)
}

func (m *Manager) serveDefault(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	id := m.catalog.DefaultID
	m.mu.Unlock()

	if id == "" {
		// The daemon itself is up; there is just nothing to index yet.
		if r.URL.Path == "/health" {
			httpserver.WriteJSON(w, 200, map[string]any{"ready": true, "status": "idle", "chunks": 0})
			return
		}

		httpserver.WriteError(w, 404, "add a project first")
		return
	}

	next := r.Clone(r.Context())
	next.URL.Path = "/projects/" + id + r.URL.Path
	m.serveProject(w, next)
}
