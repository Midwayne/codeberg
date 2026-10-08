package projects

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
)

func (m *Manager) serveDelete(w http.ResponseWriter, r *http.Request, id string) {
	if !sameOrigin(r) {
		respond(w, 403, map[string]string{"message": "cross-origin project changes are not allowed"})
		return
	}

	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&body); err != nil || (body.Mode != "index" && body.Mode != "all") {
		respond(w, 400, map[string]string{"message": "choose deletion mode: index or all"})
		return
	}

	catalog, err := m.Delete(id, body.Mode)
	if err != nil {
		status := 500
		if errors.Is(err, errProjectNotFound) {
			status = 404
		}
		respond(w, status, map[string]string{"message": err.Error()})
		return
	}

	respond(w, 200, catalog)
}

// Delete stops the writer before removing caches. Retained data uses the same
// stable directory when roots are added again; source repositories are untouched.
func (m *Manager) Delete(id, mode string) (Catalog, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	p, ok := m.project(id)
	if !ok {
		return Catalog{}, errProjectNotFound
	}
	if mode != "index" && mode != "all" {
		return Catalog{}, fmt.Errorf("invalid deletion mode")
	}

	previous := m.catalog
	m.catalog = withoutProject(previous, p)
	// Verify catalog persistence before destroying any data.
	if err := m.save(); err != nil {
		m.catalog = previous
		return Catalog{}, err
	}

	if rt, ok := m.runtimes[id]; ok {
		rt.stop()
		delete(m.runtimes, id)
	}

	if err := m.deleteData(p, mode); err != nil {
		m.catalog = previous
		saveErr := m.save()
		return Catalog{}, errors.Join(err, saveErr)
	}

	return m.catalog, nil
}

func withoutProject(c Catalog, p Project) Catalog {
	remaining := make([]Project, 0, len(c.Projects)-1)
	for _, candidate := range c.Projects {
		if candidate.ID != p.ID {
			remaining = append(remaining, candidate)
		}
	}

	c.Projects = remaining
	c.Removed = append(append([]RemovedProject{}, c.Removed...), RemovedProject{ID: p.ID, LegacyIndex: p.LegacyIndex})
	if c.DefaultID == p.ID {
		c.DefaultID = ""
		if len(remaining) > 0 {
			c.DefaultID = remaining[0].ID
		}
	}

	return c
}

func (m *Manager) deleteData(p Project, mode string) error {
	dir := filepath.Join(m.home, "projects", p.ID)
	cfg := m.projectConfig(p)
	if err := m.wipeIndex(cfg); err != nil {
		return err
	}

	if err := os.RemoveAll(filepath.Join(dir, "index")); err != nil {
		return err
	}
	if mode == "all" {
		return os.RemoveAll(dir)
	}

	return nil
}
