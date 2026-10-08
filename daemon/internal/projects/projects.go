// Package projects owns the persistent catalog and independently supervised
// project indexers. Selection belongs to a request, never to a global variable.
package projects

import (
	"context"
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/domain"
)

type Project struct {
	ID    string        `json:"id"`
	Name  string        `json:"name"`
	Roots []domain.Repo `json:"roots"`
	// Keep the original provider namespace on upgrade (remote names hash this path).
	LegacyIndex string `json:"legacyIndex,omitempty"`
}

type RemovedProject struct {
	ID          string `json:"id"`
	LegacyIndex string `json:"legacyIndex,omitempty"`
}

type Catalog struct {
	Version   int              `json:"version"`
	DefaultID string           `json:"defaultId"`
	LegacyID  string           `json:"legacyId"`
	Projects  []Project        `json:"projects"`
	Removed   []RemovedProject `json:"removed,omitempty"`
}

type runtime struct {
	handler http.Handler
	stop    func()
	started time.Time
}

type Manager struct {
	ctx      context.Context
	home     string
	base     config.Indexer
	catalog  Catalog
	mu       sync.Mutex
	runtimes map[string]runtime
	closed   bool
	gitPull  time.Duration
	start    func(Project, config.Indexer) (http.Handler, func(), error)
}

func New(ctx context.Context, home string, cfg config.Indexer) (*Manager, error) {
	m := &Manager{ctx: ctx, home: home, base: cfg, runtimes: make(map[string]runtime)}
	if err := m.loadCatalog(); err != nil {
		return nil, err
	}

	p := Project{ID: projectID(cfg.Roots), Name: filepath.Base(cfg.Root), Roots: cfg.Roots}
	if len(cfg.Roots) > 1 {
		p.Name = "Existing workspace"
	}

	exists, removed := false, false

	for _, candidate := range m.catalog.Projects {
		if candidate.ID == p.ID {
			exists = true
		}
	}

	for _, candidate := range m.catalog.Removed {
		removed = removed || candidate.ID == p.ID
	}

	if !exists && !removed {
		if m.catalog.LegacyID == "" {
			p.LegacyIndex = cfg.Index
			m.catalog.LegacyID = p.ID
		}

		m.catalog.Projects = append(m.catalog.Projects, p)
	}

	if !removed {
		m.catalog.DefaultID = p.ID
	}

	if err := m.save(); err != nil {
		return nil, err
	}

	m.start = m.startIndexer
	return m, nil
}
