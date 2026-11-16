package run

import "strings"

// mergeEnv overlays overrides onto base, replacing (not duplicating) keys.
func mergeEnv(base []string, overrides map[string]string) []string {
	out := make([]string, 0, len(base)+len(overrides))

	for _, kv := range base {
		key, _, _ := strings.Cut(kv, "=")
		if _, replaced := overrides[key]; !replaced {
			out = append(out, kv)
		}
	}

	for k, v := range overrides {
		out = append(out, k+"="+v)
	}
	return out
}
