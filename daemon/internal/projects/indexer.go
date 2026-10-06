package projects

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

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
	cfg.Root = p.Roots[0].Root
	cfg.DefaultKey = ""
	if len(p.Roots) == 1 {
		cfg.DefaultKey = p.Roots[0].Key
	}

	dir := filepath.Join(m.home, "projects", p.ID)
	cfg.Index = filepath.Join(dir, "index", "codeberg.usearch")
	cfg.LogDir = filepath.Join(dir, "logs")
	// Unix socket paths have a small OS limit; names still include home identity.
	sum := sha256.Sum256([]byte(dir))
	cfg.Socket = filepath.Join(os.TempDir(), "cberg-"+hex.EncodeToString(sum[:12])+".sock")
	if p.LegacyIndex != "" && ((cfg.IndexBackend != "" && cfg.IndexBackend != "usearch") || !strings.HasPrefix(p.LegacyIndex, filepath.Join(m.home, "index")+string(filepath.Separator))) {
		cfg.Index = p.LegacyIndex
	}
	return cfg
}

// InitialConfig migrates local caches before the initial indexer starts. A remote
// store retains its namespace to avoid silently rebuilding into another table.
func (m *Manager) InitialConfig() (config.Indexer, error) {
	p, _ := m.project(m.catalog.DefaultID)
	cfg := m.projectConfig(p)
	// Preserve the configured initial IPC endpoint for existing local clients.
	if m.base.Socket != "" {
		cfg.Socket = m.base.Socket
	}

	if err := os.MkdirAll(filepath.Dir(cfg.Index), 0700); err != nil {
		return cfg, err
	}

	if p.LegacyIndex != "" && p.LegacyIndex != cfg.Index {
		files, err := filepath.Glob(p.LegacyIndex + ".*")
		if err != nil {
			return cfg, err
		}

		if _, err := os.Stat(p.LegacyIndex); err == nil {
			files = append(files, p.LegacyIndex)
		}

		for _, source := range files {
			target := cfg.Index + strings.TrimPrefix(source, p.LegacyIndex)
			if _, err := os.Stat(target); err == nil {
				return cfg, fmt.Errorf("index migration conflict: %s", target)
			} else if !os.IsNotExist(err) {
				return cfg, err
			}

			if err := os.Rename(source, target); err != nil {
				return cfg, fmt.Errorf("migrating index %s: %w", source, err)
			}
		}
	}
	return cfg, nil
}

func (m *Manager) startIndexer(p Project, cfg config.Indexer) (http.Handler, func(), error) {
	if err := os.MkdirAll(filepath.Dir(cfg.Index), 0700); err != nil {
		return nil, nil, err
	}

	ctx, cancel := context.WithCancel(m.ctx)
	sup, err := supervisor.Start(ctx, cfg)
	if err != nil {
		cancel()
		return nil, nil, err
	}

	repos := make([]workspace.RepoInfo, 0, len(p.Roots))

	for _, r := range p.Roots {
		repos = append(repos, workspace.RepoInfo{Key: r.Key, Root: r.Root})
	}

	if m.gitPull > 0 {
		dirs := make([]string, 0, len(p.Roots))

		for _, r := range p.Roots {
			dirs = append(dirs, r.Root)
		}

		go gitpull.Run(ctx, dirs, m.gitPull)
	}

	idx := indexctl.NewClient(cfg.Socket)
	ws := workspace.New(repos, cfg.DefaultKey)
	return httpserver.New(idx, tools.Default(ws, idx)).Handler(), func() {
		sup.Stop()
		cancel()
	}, nil
}
