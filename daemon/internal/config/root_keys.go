package config

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"strings"
)

func splitList(v string) []string {
	var out []string

	for _, item := range strings.Split(v, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

// deriveRepoKey matches the launcher's registry key derivation: basename, with a
// short path-hash suffix when another repo already claimed that name.
func deriveRepoKey(resolved string, taken map[string]bool) string {
	base := strings.Map(func(r rune) rune {
		switch r {
		case '\t', '\n', '\r':
			return '-'
		}
		return r
	}, filepath.Base(resolved))
	if !taken[base] {
		return base
	}

	sum := sha256.Sum256([]byte(resolved))
	tag := hex.EncodeToString(sum[:])

	for n := 6; n <= len(tag); n += 6 {
		if key := base + "-" + tag[:n]; !taken[key] {
			return key
		}
	}
	return base + "-" + tag
}
