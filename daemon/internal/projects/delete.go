package projects

import (
	"errors"
	"fmt"
	"net/http"
	"os"

	"codeberg.org/codeberg/daemon/internal/httpserver"
)

func (m *Manager) serveDelete(w http.ResponseWriter, r *http.Request, id string) {
	if !allowProjectChange(w, r) {
		return
	}

	var body struct {
		Mode string `json:"mode"`
	}
	if err := readProjectJSON(w, r, &body); err != nil || (body.Mode != "index" && body.Mode != "all") {
		httpserver.WriteError(w, 400, "choose deletion mode: index or all")
		return
	}

	catalog, err := m.Delete(id, body.Mode)
	if err != nil {
		status := 500
		if errors.Is(err, errProjectNotFound) {
			status = 404
		}
		httpserver.WriteError(w, status, err.Error())
		return
	}

	httpserver.WriteJSON(w, 200, m.catalogView(catalog))
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

	m.stopRuntime(id)

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
	if err := m.wipeIndex(m.projectConfig(p)); err != nil {
		return err
	}

	if err := os.RemoveAll(m.layout.ProjectIndexDir(p.ID)); err != nil {
		return err
	}
	if mode == "all" {
		return os.RemoveAll(m.layout.ProjectDir(p.ID))
	}

	return nil
}
