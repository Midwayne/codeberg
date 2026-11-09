package projects

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

// Project ids are p- plus 16 lowercase hex digits, the same check as the agent.
var projectIDPattern = regexp.MustCompile(`^p-[a-f0-9]{16}$`)

func validID(id string) bool {
	return projectIDPattern.MatchString(id)
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
	if err := os.MkdirAll(m.layout.Home, 0700); err != nil {
		return err
	}

	raw, err := json.MarshalIndent(m.catalog, "", "  ")
	if err != nil {
		return err
	}

	f, err := os.CreateTemp(m.layout.Home, ".projects-*.json")
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
	return os.Rename(f.Name(), m.layout.Catalog())
}

func (m *Manager) loadCatalog() error {
	catalog, err := readCatalog(m.layout.Catalog())
	if err != nil {
		return err
	}

	m.catalog = catalog
	return nil
}

// readCatalog returns an empty catalog when the file does not exist yet.
func readCatalog(path string) (Catalog, error) {
	catalog := Catalog{Version: 1}

	raw, err := os.ReadFile(path)
	if err == nil {
		if err := json.Unmarshal(raw, &catalog); err != nil {
			return Catalog{}, fmt.Errorf("reading project catalog: %w", err)
		}

		if err := validateCatalog(catalog); err != nil {
			return Catalog{}, err
		}
	} else if !os.IsNotExist(err) {
		return Catalog{}, err
	}

	if catalog.Projects == nil {
		catalog.Projects = []Project{}
	}

	return catalog, nil
}

func validateCatalog(c Catalog) error {
	if c.Version != 1 {
		return fmt.Errorf("unsupported project catalog version %d", c.Version)
	}

	seen := map[string]bool{}

	for _, p := range c.Projects {
		if !validID(p.ID) || seen[p.ID] || len(p.Roots) == 0 {
			return fmt.Errorf("invalid project catalog")
		}

		seen[p.ID] = true
	}

	if (c.LegacyID != "" && !validID(c.LegacyID)) || (len(c.Projects) > 0 && !seen[c.DefaultID]) || (len(c.Projects) == 0 && c.DefaultID != "") {
		return fmt.Errorf("project catalog has no valid default or migration owner")
	}

	return nil
}
