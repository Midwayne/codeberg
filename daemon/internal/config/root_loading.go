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

	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		// Path may not exist yet (e.g. first boot); keep the absolute form.
		return abs, nil
	}
	return real, nil
}

func loadRootRecords(raw string) ([]domain.Repo, string, error) {
	var roots []domain.Repo

	for _, line := range strings.Split(raw, "\n") {
		key, path, ok := strings.Cut(line, "\t")
		if !ok || key == "" || path == "" {
			continue
		}

		resolved, err := resolveRoot(path)
		if err != nil {
			log.Printf("skipping repo %q: unresolvable root %q", key, path)
			continue
		}

		if _, err := os.Stat(resolved); err != nil {
			log.Printf("skipping repo %q: missing root %q", key, resolved)
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
