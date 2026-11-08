package config

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

// loadRoots reads the internal keyed repository list. Normal startup restores
// the project catalog; an empty list leaves the daemon idle until a UI project
// is added.
func loadRoots() ([]domain.Repo, string, error) {
	if raw := os.Getenv(EnvRoots); strings.TrimSpace(raw) != "" {
		return loadRootRecords(raw)
	}

	return nil, "", nil
}

func resolveRoot(root string) (string, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}

	return filepath.EvalSymlinks(abs)
}

func loadRootRecords(raw string) ([]domain.Repo, string, error) {
	var roots []domain.Repo

	for _, line := range strings.Split(raw, rootNewline) {
		key, path, ok := splitRootRecord(line)
		if !ok {
			continue
		}

		resolved, err := resolveRoot(path)
		if err != nil {
			log.Printf("skipping repo %q: missing root %q", key, path)
			continue
		}

		roots = append(roots, domain.Repo{Key: key, Root: resolved})
	}

	if len(roots) == 0 {
		return nil, "", invalid(EnvRoots)
	}

	// A lone record keeps a default repo (tools may omit `repo`); with
	// several repos there is no sensible default, so repo must be explicit.
	if len(roots) == 1 {
		return roots, roots[0].Key, nil
	}

	return roots, "", nil
}
