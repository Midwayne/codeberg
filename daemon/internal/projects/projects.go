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
	"codeberg.org/codeberg/daemon/internal/storage"
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

// Runtime holds the settings shared by every started project.
type Runtime struct {
	GitPull       time.Duration
	HealthTimeout time.Duration
	// OnIndexReady runs whenever a project's indexer first reports ready.
	OnIndexReady func()
}

type Manager struct {
	ctx      context.Context
	layout   storage.Layout
	base     config.Indexer
	settings Runtime
	catalog  Catalog
	mu       sync.Mutex
	runtimes map[string]runtime
	closed   bool
	start    func(Project, config.Indexer) (http.Handler, func(), error)
}

// New restores the catalog under home. cfg.Roots, when set, registers the
// startup workspace; every project indexer inherits the rest of cfg.
func New(ctx context.Context, home string, cfg config.Indexer) (*Manager, error) {
	m := &Manager{ctx: ctx, layout: storage.Layout{Home: home}, base: cfg, runtimes: make(map[string]runtime)}
	if err := m.loadCatalog(); err != nil {
		return nil, err
	}

	if len(cfg.Roots) > 0 {
		m.registerStartup(cfg)
	}

	if err := m.save(); err != nil {
		return nil, err
	}

	m.settings.OnIndexReady = func() {}
	m.start = m.startIndexer
	return m, nil
}

func (m *Manager) WithRuntime(settings Runtime) *Manager {
	if settings.OnIndexReady == nil {
		settings.OnIndexReady = func() {}
	}

	m.settings = settings
	return m
}

// Only explicitly configured roots create a startup workspace or migration owner.
func (m *Manager) registerStartup(cfg config.Indexer) {
	p := Project{ID: projectID(cfg.Roots), Name: filepath.Base(cfg.Roots[0].Root), Roots: cfg.Roots}
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
}
