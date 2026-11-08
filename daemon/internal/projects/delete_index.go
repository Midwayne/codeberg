package projects

import (
	"os"

	"codeberg.org/codeberg/daemon/internal/config"
	"codeberg.org/codeberg/daemon/internal/storage"
	"codeberg.org/codeberg/daemon/internal/supervisor"
)

// wipeIndex removes a project's vectors wherever they live, including a legacy
// index outside project storage, but never files that merely sit beside it.
func (m *Manager) wipeIndex(cfg config.Indexer) error {
	if cfg.RemoteIndex() {
		for _, root := range cfg.Roots {
			if err := supervisor.WipeIndex(m.ctx, cfg, root.Root); err != nil {
				return err
			}
		}
	}

	family, err := storage.IndexFamily(cfg.Index)
	if err != nil {
		return err
	}

	for _, path := range family {
		if err := os.RemoveAll(path); err != nil {
			return err
		}
	}

	return nil
}
