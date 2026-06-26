package config

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const fileTemplate = `# codeberg launcher config — KEY=VALUE, '#' comments.
# Precedence: CLI flags > environment > this file > defaults.

# --- required ---------------------------------------------------------------
# Repository tree to index.
%s=/path/to/your/repo
# LLM the agent uses, as provider:model (anthropic, openai, google, ollama).
%s=anthropic:claude-haiku-4-5

# API key matching the model above (ollama needs none).
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# GOOGLE_GENERATIVE_AI_API_KEY=

# --- optional ---------------------------------------------------------------
# Daemon HTTP port (default 48080).
# %s=48080
# Reasoning effort: provider-default|none|minimal|low|medium|high|xhigh
# %s=medium
# Set to false for chunk-only mode (skips the embedding-model download).
# %s=true
# Override the embedding model / vector index paths (sensible defaults otherwise).
# %s=/abs/path/to/model.onnx
# %s=/abs/path/to/index.usearch
`

// InitFile writes a template config to path unless it already exists. Returns
// (created, error). It creates parent directories as needed.
func InitFile(path string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	body := fmt.Sprintf(fileTemplate,
		KeyRoot, KeyModel, KeyHTTPPort, KeyReasoning, KeyVector, KeyEmbedModel, KeyIndexPath)
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
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
		{KeyModel, orUnset(c.Model)},
		{KeyDaemonURL, c.DaemonURL},
		{KeyHTTPPort, c.HTTPPort},
		{KeyVector, fmt.Sprintf("%t", c.Vector)},
		{KeyEmbedModel, c.EmbedModel},
		{KeyIndexPath, c.IndexPath},
		{KeySocket, c.Socket},
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
