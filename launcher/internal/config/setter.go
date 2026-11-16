package config

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SetValues upserts KEY=VALUE pairs into the config file, preserving its
// comments and order. A matching line (active or a commented template line like
// `# KEY=...`) is replaced in place and uncommented; otherwise the pair is
// appended. The file (and its parent dir) is created if absent.
func SetValues(path string, kv map[string]string) error {
	lines, err := readLines(path)
	if err != nil {
		return err
	}
	pending := map[string]string{}
	for k, v := range kv {
		pending[k] = v
	}
	for i, line := range lines {
		key := lineKey(line)
		if key == "" {
			continue
		}
		if v, ok := pending[key]; ok {
			lines[i] = key + "=" + v
			delete(pending, key)
		}
	}
	// Append any keys that weren't already present, in stable order.
	rest := make([]string, 0, len(pending))
	for k := range pending {
		rest = append(rest, k)
	}
	sort.Strings(rest)
	for _, k := range rest {
		lines = append(lines, k+"="+pending[k])
	}
	return writeLines(path, lines)
}

// UnsetValues removes active assignments for the given keys (commented template
// lines are left untouched).
func UnsetValues(path string, keys []string) error {
	lines, err := readLines(path)
	if err != nil {
		return err
	}
	drop := map[string]bool{}
	for _, k := range keys {
		drop[k] = true
	}
	out := lines[:0]
	for _, line := range lines {
		if isActiveAssignment(line) && drop[lineKey(line)] {
			continue
		}
		out = append(out, line)
	}
	return writeLines(path, out)
}

// lineKey returns the key a line assigns (whether active `KEY=...` or a
// commented `# KEY=...` template line), or "" if the line is not an assignment.
func lineKey(line string) string {
	s := strings.TrimSpace(line)
	s = strings.TrimPrefix(s, "#")
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "export ")
	eq := strings.IndexByte(s, '=')
	if eq <= 0 {
		return ""
	}
	return strings.TrimSpace(s[:eq])
}

func isActiveAssignment(line string) bool {
	s := strings.TrimSpace(line)
	return s != "" && !strings.HasPrefix(s, "#") && strings.Contains(s, "=")
}

func readLines(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	text := strings.TrimRight(string(data), "\n")
	if text == "" {
		return nil, nil
	}
	return strings.Split(text, "\n"), nil
}

func writeLines(path string, lines []string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	body := strings.Join(lines, "\n") + "\n"
	return os.WriteFile(path, []byte(body), 0o600)
}
