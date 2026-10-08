package projects

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

func validID(id string) bool {
	if len(id) != 18 || !strings.HasPrefix(id, "p-") {
		return false
	}

	_, err := hex.DecodeString(id[2:])
	return err == nil
}

func projectID(roots []domain.Repo) string {
	var paths []string

	for _, r := range roots {
		paths = append(paths, r.Root)
	}

	sum := sha256.Sum256([]byte(strings.Join(paths, "\x00")))
	return "p-" + hex.EncodeToString(sum[:8])
}

func (m *Manager) save() error {
	if err := os.MkdirAll(m.home, 0700); err != nil {
		return err
	}

	raw, err := json.MarshalIndent(m.catalog, "", "  ")
	if err != nil {
		return err
	}

	f, err := os.CreateTemp(m.home, ".projects-*.json")
	if err != nil {
		return err
	}

	defer os.Remove(f.Name())
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}

	if err == nil {
		err = f.Sync()
	}

	closeErr := f.Close()
	if err != nil {
		return err
	}

	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), filepath.Join(m.home, "projects.json"))
}

func (m *Manager) loadCatalog() error {
	raw, err := os.ReadFile(filepath.Join(m.home, "projects.json"))
	if err == nil {
		if err := json.Unmarshal(raw, &m.catalog); err != nil {
			return fmt.Errorf("reading project catalog: %w", err)
		}

		if m.catalog.Version != 1 {
			return fmt.Errorf("unsupported project catalog version %d", m.catalog.Version)
		}

		seen := map[string]bool{}

		for _, p := range m.catalog.Projects {
			if !validID(p.ID) || seen[p.ID] || len(p.Roots) == 0 {
				return fmt.Errorf("invalid project catalog")
			}

			seen[p.ID] = true
		}

		if !validID(m.catalog.LegacyID) || (len(m.catalog.Projects) > 0 && !seen[m.catalog.DefaultID]) || (len(m.catalog.Projects) == 0 && m.catalog.DefaultID != "") {
			return fmt.Errorf("project catalog has no valid default or migration owner")
		}
	} else if !os.IsNotExist(err) {
		return err
	} else {
		m.catalog.Version = 1
	}

	return nil
}
