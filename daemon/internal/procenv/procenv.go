// Package procenv builds child-process environments from the daemon's own.
package procenv

import (
	"os"
	"sort"
	"strings"
)

// Overlay returns the daemon environment with every key in overrides
// replaced. An empty override removes the inherited value instead of setting
// it, so a child never sees a stale setting the daemon decided against.
func Overlay(overrides map[string]string) []string {
	base := os.Environ()
	env := make([]string, 0, len(base)+len(overrides))

	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, replaced := overrides[key]; !replaced {
			env = append(env, entry)
		}
	}

	keys := make([]string, 0, len(overrides))

	for key, value := range overrides {
		if value != "" {
			keys = append(keys, key)
		}
	}

	sort.Strings(keys)

	for _, key := range keys {
		env = append(env, key+"="+overrides[key])
	}

	return env
}
