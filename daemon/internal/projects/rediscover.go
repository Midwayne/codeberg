package projects

import "errors"

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
		dir, err := projectDir(p)
		if err != nil {
			continue
		}

		m.catalog.Projects[i].Directory = dir
		m.catalog.Projects[i].Roots = rootsFor(dir, discoverRepositories(dir))
	}
}
