package config

import (
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

const (
	rootSeparator = "\t"
	rootNewline   = "\n"
)

// FormatRoots encodes repos for the CODEBERG_ROOTS environment variable.
func FormatRoots(roots []domain.Repo) string {
	if len(roots) == 0 {
		return ""
	}

	records := make([]string, len(roots))

	for i, r := range roots {
		records[i] = rootRecord(r.Key, r.Root)
	}

	return strings.Join(records, rootNewline)
}

func rootRecord(key, root string) string {
	return key + rootSeparator + root
}

func splitRootRecord(line string) (string, string, bool) {
	key, path, ok := strings.Cut(line, rootSeparator)
	if !ok || key == "" || path == "" {
		return "", "", false
	}

	return key, path, true
}
