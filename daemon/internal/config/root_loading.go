package config

import (
	"log"
	"os"
	"path/filepath"
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

// loadRoots resolves the served repos. CODEBERG_ROOTS ("<key>\t<path>" records,
// newline-separated — the same shape the launcher registry stores) wins and
// means multi-repo mode (no default repo); CODEBERG_ROOT alone is single-root
// mode with the basename as both key and default. Dead or malformed records are
// skipped with a log line, mirroring the C engine, so one deleted tree does not
// take the daemon down.
func loadRoots() ([]domain.Repo, string, error) {
	if raw := os.Getenv(EnvRoots); raw != "" {
		return loadRootRecords(raw)
	}

	return loadRootPaths()
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

func loadRootPaths() ([]domain.Repo, string, error) {
	root := os.Getenv(EnvRoot)
	if root == "" {
		return nil, "", missing(EnvRoot)
	}

	paths := splitList(root)
	if len(paths) == 0 {
		return nil, "", invalid(EnvRoot)
	}

	var roots []domain.Repo
	takenKey := map[string]bool{}
	seenRoot := map[string]bool{}

	for _, path := range paths {
		resolved, err := resolveRoot(path)
		if err != nil {
			return nil, "", invalid(EnvRoot)
		}

		if fi, err := os.Stat(resolved); err != nil || !fi.IsDir() {
			return nil, "", invalid(EnvRoot)
		}

		if seenRoot[resolved] {
			continue // CODEBERG_ROOT=/a,/a → one repo
		}

		seenRoot[resolved] = true
		key := deriveRepoKey(resolved, takenKey)
		takenKey[key] = true
		roots = append(roots, domain.Repo{Key: key, Root: resolved})
	}

	if len(roots) == 0 {
		return nil, "", invalid(EnvRoot)
	}

	if len(roots) == 1 {
		return roots, roots[0].Key, nil
	}
	return roots, "", nil
}
