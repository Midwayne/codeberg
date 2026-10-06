package projects

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"codeberg.org/codeberg/daemon/internal/domain"
)

func (m *Manager) Add(name, root string) (Project, error) {
	if !filepath.IsAbs(root) || strings.ContainsAny(root, "\x00\n\r\t") {
		return Project{}, fmt.Errorf("choose an absolute directory path")
	}

	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return Project{}, fmt.Errorf("directory is unavailable: %w", err)
	}

	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return Project{}, fmt.Errorf("choose an existing directory")
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(root)
	}

	if utf8.RuneCountInString(name) > 120 {
		return Project{}, fmt.Errorf("project name must be 120 characters or shorter")
	}

	roots := []domain.Repo{{Key: filepath.Base(root), Root: root}}
	p := Project{ID: projectID(roots), Name: name, Roots: roots}
	m.mu.Lock()
	defer m.mu.Unlock()

	for _, existing := range m.catalog.Projects {
		if existing.ID == p.ID {
			return existing, nil
		}
	}

	m.catalog.Projects = append(m.catalog.Projects, p)
	if err := m.save(); err != nil {
		m.catalog.Projects = m.catalog.Projects[:len(m.catalog.Projects)-1]
		return Project{}, err
	}
	return p, nil
}

var errProjectNotFound = errors.New("project not found")

var errProjectName = errors.New("project name must contain 1 to 120 characters")

// Rename changes only the display label; roots, IDs and running indexers stay stable.
func (m *Manager) Rename(id, name string) (Project, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 120 {
		return Project{}, errProjectName
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	for i, p := range m.catalog.Projects {
		if p.ID != id {
			continue
		}

		m.catalog.Projects[i].Name = name
		if err := m.save(); err != nil {
			m.catalog.Projects[i] = p
			return Project{}, err
		}
		return m.catalog.Projects[i], nil
	}
	return Project{}, errProjectNotFound
}

func (m *Manager) project(id string) (Project, bool) {
	for _, p := range m.catalog.Projects {
		if p.ID == id {
			return p, true
		}
	}
	return Project{}, false
}
