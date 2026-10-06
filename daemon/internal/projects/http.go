package projects

import (
	"encoding/json"
	"net/http"
	"strings"
)

func respond(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (m *Manager) Handler(fallback http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/projects/pick-directory" {
			desktopFolderPicker.ServeHTTP(w, r)
			return
		}

		if r.URL.Path == "/projects" {
			m.serveCatalog(w, r)
			return
		}

		if !strings.HasPrefix(r.URL.Path, "/projects/") {
			if r.URL.Path == "/health" {
				m.serveHealth(fallback, w, r, m.catalog.DefaultID)
			} else {
				fallback.ServeHTTP(w, r)
			}
			return
		}

		m.serveProject(w, r)
	})
}

func sameOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	return origin == "" || origin == "http://"+r.Host || origin == "https://"+r.Host
}

func (m *Manager) serveProject(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/projects/"), "/", 2)
	m.mu.Lock()
	_, ok := m.project(parts[0])
	m.mu.Unlock()
	if !ok {
		respond(w, 404, map[string]string{"message": "project not found"})
		return
	}

	if len(parts) == 1 {
		m.serveRename(w, r, parts[0])
		return
	}

	if parts[1] == "retry" {
		m.serveRetry(w, r, parts[0])
		return
	}

	handler, err := m.activate(parts[0])
	if err != nil {
		respond(w, 503, map[string]string{"message": err.Error()})
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
