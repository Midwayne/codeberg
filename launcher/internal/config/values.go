package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// RootPaths returns the directories named by --root. Comma-separated
// values list multiple roots; a single path returns a one-element slice.
func RootPaths(root string) []string {
	return splitList(root)
}

// splitList parses a comma-separated flag/env value into trimmed, non-empty
// items.
func splitList(v string) []string {
	var out []string
	for _, item := range strings.Split(v, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func isFalsey(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "no", "off":
		return true
	}
	return false
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func abs(p string) string {
	if p == "" {
		return ""
	}
	if a, err := filepath.Abs(p); err == nil {
		return a
	}
	return p
}

// parseFile reads a KEY=VALUE file (shell-style; `#` comments, optional quotes,
// optional `export `). A missing file is not an error — lower layers apply.
func parseFile(path string) (map[string]string, error) {
	vals := map[string]string{}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return vals, nil
		}
		return nil, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = strings.Trim(val, `"'`)
		if key != "" {
			vals[key] = val
		}
	}
	return vals, sc.Err()
}
