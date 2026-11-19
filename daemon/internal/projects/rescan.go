package projects

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
)

var errFixedRoots = errors.New("this workspace was started with fixed roots; add its directory as a project instead")

// projectDir is the directory repositories are found under: the recorded
// Directory, or the single root of a project added before discovery existed.
func projectDir(p Project) (string, error) {
	if p.Directory != "" {
		return p.Directory, nil
	}

	if len(p.Roots) == 1 {
		return p.Roots[0].Root, nil
	}

	return "", errFixedRoots
}

// Rescan finds a project's repositories again. A nil ignored list keeps the
// project's current one. Changed roots stop the running indexer so the next
// request starts one over the new roots; the ID never changes.
func (m *Manager) Rescan(id string, ignored *[]string) (Project, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	for i, p := range m.catalog.Projects {
		if p.ID != id {
			continue
		}

		next, err := rediscovered(p, ignored)
		if err != nil {
			return Project{}, err
		}

		return next, m.replaceProject(i, p, next)
	}

	return Project{}, errProjectNotFound
}

func rediscovered(p Project, ignored *[]string) (Project, error) {
	dir, err := projectDir(p)
	if err != nil {
		return Project{}, err
	}

	if ignored != nil {
		p.Ignored = cleanIgnored(*ignored)
	}

	p.Directory, p.Discover = dir, true
	p.Roots = rootsFor(dir, discoverRepositories(dir, p.Ignored))
	return p, nil
}

func (m *Manager) replaceProject(i int, previous, next Project) error {
	m.catalog.Projects[i] = next
	if err := m.save(); err != nil {
		m.catalog.Projects[i] = previous
		return err
	}

	if rt, ok := m.runtimes[next.ID]; ok && !reflect.DeepEqual(previous.Roots, next.Roots) {
		rt.stop()
		delete(m.runtimes, next.ID)
	}

	return nil
}

// refreshDiscovered picks up repositories added or removed while Codeberg was
// stopped. It runs before any indexer starts, so it only updates the catalog.
func (m *Manager) refreshDiscovered() {
	for i, p := range m.catalog.Projects {
		if !p.Discover {
			continue
		}

		if next, err := rediscovered(p, nil); err == nil {
			m.catalog.Projects[i] = next
		}
	}
}

func (m *Manager) serveDiscover(w http.ResponseWriter, r *http.Request) {
	dir, err := projectDirectory(r.URL.Query().Get("root"))
	if err != nil {
		respond(w, 400, map[string]string{"message": err.Error()})
		return
	}

	found := withKeys(dir, discoverRepositories(dir, nil))
	if found == nil {
		found = []Discovered{}
	}

	respond(w, 200, map[string]any{"directory": dir, "repositories": found})
}

func (m *Manager) serveRescan(w http.ResponseWriter, r *http.Request, id string) {
	if r.Method != "POST" || !sameOrigin(r) {
		respond(w, 405, map[string]string{"message": "rescan needs a same-origin POST"})
		return
	}

	var body struct {
		Ignored *[]string `json:"ignored"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64*1024)).Decode(&body); err != nil {
		respond(w, 400, map[string]string{"message": "invalid rescan request"})
		return
	}

	p, err := m.Rescan(id, body.Ignored)
	if err != nil {
		respond(w, 400, map[string]string{"message": fmt.Sprint(err)})
		return
	}

	respond(w, 200, p)
}
