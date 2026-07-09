package config

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

//go:embed config.init.example
var initTemplate string

// InitFile writes a template config to path unless it already exists. Returns
// (created, error). It creates parent directories as needed.
func InitFile(path string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	if err := os.WriteFile(path, []byte(initTemplate), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

// Summary returns the resolved config as human-readable KEY=VALUE lines, with
// secrets masked. Useful for `codeberg config` and `codeberg doctor`.
func (c *Config) Summary() string {
	rows := [][2]string{
		{"repo", orUnset(c.Repo)},
		{"home", c.Home},
		{"config file", c.ConfigPath},
		{KeyRoot, orUnset(c.Root)},
		{KeyAll, fmt.Sprintf("%t", c.All)},
		{KeyModel, orUnset(c.Model)},
		{KeyDaemonURL, c.DaemonURL},
		{KeyHTTPPort, c.HTTPPort},
		{KeyWeb, fmt.Sprintf("%t", c.Web)},
		{KeyWebPort, c.WebPort},
		{KeyWebUse, fmt.Sprintf("%t", c.WebUse)},
		{KeySearxngURL, orUnset(c.SearxngURL) + searxngManagedNote(c)},
		{KeyVector, fmt.Sprintf("%t", c.Vector)},
		{KeyEmbedModel, c.EmbedModel},
		{KeyIndexPath, c.IndexPath},
		{KeySocket, c.Socket},
	}
	if len(c.Repos) > 0 {
		rows = append(rows, [2]string{KeyReposSel, strings.Join(c.Repos, ",")})
	}
	if c.NoIndex {
		rows = append(rows, [2]string{KeyNoIndex, "true"})
	}
	if c.Reasoning != "" {
		rows = append(rows, [2]string{KeyReasoning, c.Reasoning})
	}
	keys := make([]string, 0, len(c.Passthrough))
	for k := range c.Passthrough {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		rows = append(rows, [2]string{k, mask(c.Passthrough[k])})
	}

	width := 0
	for _, r := range rows {
		if len(r[0]) > width {
			width = len(r[0])
		}
	}
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "  %-*s  %s\n", width, r[0], r[1])
	}
	return b.String()
}

func orUnset(v string) string {
	if v == "" {
		return "<unset>"
	}
	return v
}

// searxngManagedNote annotates the (unset) external SearXNG URL to make clear
// the launcher manages a local instance when web use is on and none is set.
func searxngManagedNote(c *Config) string {
	if c.SearxngURL == "" && c.WebUse {
		return " (launcher-managed on :" + c.SearxngPort + ")"
	}
	return ""
}

// mask shows only the last 4 chars of a secret-ish value.
func mask(v string) string {
	if strings.HasPrefix(v, "http") { // OLLAMA_BASE_URL etc. are not secret
		return v
	}
	if len(v) <= 4 {
		return "****"
	}
	return "****" + v[len(v)-4:]
}
