package projects

import (
	"os"
	"path/filepath"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/supervisor"
)

func (m *Manager) wipeIndex(cfg config.Indexer) error {
	if cfg.IndexBackend != "" && cfg.IndexBackend != "usearch" {
		for _, root := range cfg.Roots {
			if err := supervisor.WipeIndex(m.ctx, cfg, root.Root); err != nil {
				return err
			}
		}
	}

	// Include explicitly configured legacy caches, but never neighboring files.
	entries, err := os.ReadDir(filepath.Dir(cfg.Index))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	base := filepath.Base(cfg.Index)
	for _, entry := range entries {
		name := entry.Name()
		if name == base || indexFamily(name, base) {
			if err := os.RemoveAll(filepath.Join(filepath.Dir(cfg.Index), name)); err != nil {
				return err
			}
		}
	}

	return nil
}

func indexFamily(name, base string) bool {
	return len(name) > len(base) && name[:len(base)] == base && name[len(base)] == '.'
}
