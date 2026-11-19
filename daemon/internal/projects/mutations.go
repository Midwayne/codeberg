package projects

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// Add adds a project directory and the repositories found inside it. The ID
// depends only on the directory, so later scans keep the same project.
func (m *Manager) Add(name, root string) (Project, error) {
	root, err := projectDirectory(root)
	if err != nil {
		return Project{}, err
	}

	name = strings.TrimSpace(name)
	if name == "" {
		name = filepath.Base(root)
	}

	if utf8.RuneCountInString(name) > 120 {
		return Project{}, fmt.Errorf("project name must be 120 characters or shorter")
	}

	p := Project{ID: projectID(rootsFor(root, nil)), Name: name, Directory: root}
	p.Roots = rootsFor(root, discoverRepositories(root))

	m.mu.Lock()
	defer m.mu.Unlock()

	for _, existing := range m.catalog.Projects {
		if existing.ID == p.ID {
			return Project{}, &ExistingProjectError{Project: existing}
		}
	}

	return m.addProject(p)
}

// projectDirectory resolves an absolute, existing directory path.
func projectDirectory(root string) (string, error) {
	if !filepath.IsAbs(root) || strings.ContainsAny(root, "\x00\n\r\t") {
		return "", fmt.Errorf("choose an absolute directory path")
	}

	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("directory is unavailable: %w", err)
	}

	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("choose an existing directory")
	}

	return root, nil
}

func (m *Manager) addProject(p Project) (Project, error) {
	previous := m.catalog
	for i, removed := range m.catalog.Removed {
		if removed.ID == p.ID {
			p.LegacyIndex = removed.LegacyIndex
			m.catalog.Removed = append(append([]RemovedProject{}, m.catalog.Removed[:i]...), m.catalog.Removed[i+1:]...)
			break
		}
	}

	m.catalog.Projects = append(append([]Project{}, m.catalog.Projects...), p)
	if m.catalog.DefaultID == "" {
		m.catalog.DefaultID = p.ID
	}

	if err := m.save(); err != nil {
		m.catalog = previous
		return Project{}, err
	}
	return p, nil
}

// ExistingProjectError reports a directory that already belongs to a project.
// Projects may overlap, but two projects never share the same directory.
type ExistingProjectError struct {
	Project Project
}

func (e *ExistingProjectError) Error() string {
	return fmt.Sprintf("%q already uses this directory", e.Project.Name)
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
