package storage

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// IndexFamily lists base and its "<base>.*" sidecars, never neighbors that
// merely share a prefix. A missing directory is an empty family.
func IndexFamily(base string) ([]string, error) {
	dir, stem := filepath.Dir(base), filepath.Base(base)

	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	var family []string

	for _, entry := range entries {
		name := entry.Name()
		if name == stem || strings.HasPrefix(name, stem+".") {
			family = append(family, filepath.Join(dir, name))
		}
	}

	return family, nil
}

// familyTag names the per-root set a sidecar belongs to: the first dotted
// component after the base ("" for the base file itself).
func familyTag(stem, name string) string {
	rest := strings.TrimPrefix(strings.TrimPrefix(name, stem), ".")
	tag, _, _ := strings.Cut(rest, ".")

	return tag
}
