package projects

import (
	"errors"
	"os"
	"path/filepath"
)

var errFixedRoots = errors.New("workspace was started with fixed roots")

// projectDir is the directory repositories are found under: the recorded
// Directory, or the single root of a project added before discovery existed.
// A workspace started with several explicit roots has none.
func projectDir(p Project) (string, error) {
	if p.Directory != "" {
		return p.Directory, nil
	}

	if len(p.Roots) == 1 {
		return p.Roots[0].Root, nil
	}

	return "", errFixedRoots
}

// refreshDiscovered finds every project's repositories again, so repositories
// cloned or removed while Codeberg was stopped are picked up and projects
// added before discovery existed are split. It runs before any indexer
// starts; the ID never changes, so chats and knowledge stay attached.
func (m *Manager) refreshDiscovered() {
	for i, p := range m.catalog.Projects {
		if m.startupProject(p) {
			continue
		}

		dir, err := projectDir(p)
		if err != nil {
			continue
		}

		// An unmounted drive or missing folder keeps the roots it had.
		if _, err := os.ReadDir(dir); err != nil {
			continue
		}

		m.catalog.Projects[i].Directory = dir
		m.catalog.Projects[i].Roots = rootsWithKey(dir, directoryKey(p, dir), discoverRepositories(dir))
	}
}

// startupProject reports a project whose roots come from launch configuration
// (CODEBERG_ROOTS, --root); those keep exactly the roots and keys configured.
func (m *Manager) startupProject(p Project) bool {
	if p.ID == m.catalog.LegacyID {
		return true
	}

	return len(m.base.Roots) > 0 && p.ID == projectID(m.base.Roots)
}

// directoryKey keeps the key tools and saved knowledge already use for the directory.
func directoryKey(p Project, dir string) string {
	if len(p.Roots) > 0 && p.Roots[0].Root == dir {
		return p.Roots[0].Key
	}

	return filepath.Base(dir)
}
