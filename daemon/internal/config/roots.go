package config

import (
	"strings"

	"codeberg.org/codeberg/daemon/internal/domain"
)

// FormatRoots encodes repos for the CODEBERG_ROOTS environment variable.
func FormatRoots(roots []domain.Repo) string {
	if len(roots) == 0 {
		return ""
	}

	records := make([]string, len(roots))
	for i, r := range roots {
		records[i] = r.Key + "\t" + r.Root
	}

	return strings.Join(records, "\n")
}
