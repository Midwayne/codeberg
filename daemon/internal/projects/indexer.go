package projects

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"codeberg.org/codeberg/daemon/internal/bootstrap"
	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/gitpull"
	"codeberg.org/codeberg/daemon/internal/httpserver"
	"codeberg.org/codeberg/daemon/internal/indexctl"
	"codeberg.org/codeberg/daemon/internal/supervisor"
	"codeberg.org/codeberg/daemon/internal/tools"
	"codeberg.org/codeberg/daemon/internal/workspace"
)

func (m *Manager) projectConfig(p Project) config.Indexer {
	cfg := m.base
	cfg.Roots = p.Roots
	cfg.DefaultKey = ""
	if len(p.Roots) == 1 {
		cfg.DefaultKey = p.Roots[0].Key
	}

	cfg.Index = m.indexPath(p, cfg)
	cfg.LogDir = m.layout.ProjectLogs(p.ID)
	cfg.Socket = m.layout.ProjectSocket(p.ID)
	return cfg
}

// indexPath keeps a pre-project index where moving it would lose data: a
// remote store names its collections after the path, and a custom location
// outside the managed index directory belongs to the user.
func (m *Manager) indexPath(p Project, cfg config.Indexer) string {
	if p.LegacyIndex != "" && (cfg.RemoteIndex() || !m.layout.InLegacyIndexDir(p.LegacyIndex)) {
		return p.LegacyIndex
	}

	return m.layout.ProjectIndex(p.ID, cfg.IndexNamespace)
}

func (m *Manager) startIndexer(p Project, cfg config.Indexer) (http.Handler, func(), error) {
	if err := m.prepareIndex(p, cfg); err != nil {
		return nil, nil, err
	}

	ctx, cancel := context.WithCancel(m.ctx)
	sup, err := supervisor.Start(ctx, cfg)
	if err != nil {
		cancel()
		return nil, nil, err
	}

	go gitpull.Run(ctx, rootDirs(p), m.settings.GitPull)

	idx := indexctl.NewClient(cfg.Socket)
	go m.awaitReady(ctx, p, idx)

	ws := workspace.New(p.Roots, cfg.DefaultKey)
	handler := httpserver.New(idx, tools.WithVectorSearch(ws, idx, cfg.VectorsEnabled())).Handler()

	return handler, func() {
		sup.Stop()
		cancel()
	}, nil
}

// awaitReady reports the first ready status so disk usage covers the new index.
func (m *Manager) awaitReady(ctx context.Context, p Project, idx *indexctl.Client) {
	ctx, cancel := context.WithTimeout(ctx, bootstrap.StartupTimeout(m.settings.HealthTimeout, len(p.Roots)))
	defer cancel()

	st, err := bootstrap.WaitIndexer(ctx, idx)
	if err != nil {
		log.Printf("project %s indexing: %v", p.ID, err)
		return
	}

	log.Printf("project %s indexer ready: %d chunks, version %s", p.ID, st.Chunks, st.Version)
	m.settings.OnIndexReady()
}

func rootDirs(p Project) []string {
	dirs := make([]string, 0, len(p.Roots))

	for _, r := range p.Roots {
		dirs = append(dirs, r.Root)
	}

	return dirs
}

func (m *Manager) prepareIndex(p Project, cfg config.Indexer) error {
	if err := os.MkdirAll(filepath.Dir(cfg.Index), 0700); err != nil {
		return err
	}

	if p.LegacyIndex == "" || p.LegacyIndex == cfg.Index {
		return nil
	}

	return migrateIndex(p.LegacyIndex, cfg.Index)
}
