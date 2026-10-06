package workspace

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func SafeRel(path string) (string, error) {
	if path == "" {
		return ".", nil
	}

	clean := filepath.Clean(path)
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%w: %s", ErrEscape, path)
	}
	return clean, nil
}

func resolve(root, rel string) (string, error) {
	if rel == "" {
		rel = "."
	}

	clean := filepath.Clean(rel)
	if filepath.IsAbs(clean) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}

	full := filepath.Join(root, clean)
	if !within(root, full) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}

	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("codeberg: resolve root: %w", err)
	}

	realFull, err := filepath.EvalSymlinks(full)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("%w: %s", ErrNotFound, rel)
		}
		return "", fmt.Errorf("codeberg: resolve path: %w", err)
	}

	if !within(realRoot, realFull) {
		return "", fmt.Errorf("%w: %s", ErrEscape, rel)
	}
	return realFull, nil
}

func within(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
