package config

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

//go:embed config.init.example
var initTemplate string

//go:embed mcp.init.json
var mcpInitTemplate string

// InitFile writes a template config to path unless it already exists. Returns
// (created, error). It creates parent directories as needed.
func InitFile(path string) (bool, error) {
	return writeIfAbsent(path, initTemplate)
}

// InitMcpFile writes a starter ~/.codeberg/mcp.json unless it already exists.
func InitMcpFile(path string) (bool, error) {
	return writeIfAbsent(path, mcpInitTemplate)
}

func writeIfAbsent(path, body string) (bool, error) {
	if _, err := os.Stat(path); err == nil {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return false, err
	}
	return true, nil
}

// summaryRow is one KEY  VALUE line of the config summary.
type summaryRow [2]string

// Summary returns the resolved config as human-readable KEY=VALUE lines, with
// secrets masked. Useful for `codeberg config` and `codeberg doctor`.
func (c *Config) Summary() string {
	rows := c.coreSummaryRows()
	rows = append(rows, c.optionalSummaryRows()...)
	rows = append(rows, c.passthroughSummaryRows()...)

	return formatSummary(rows)
}

// coreSummaryRows are always shown, set or not.
func (c *Config) coreSummaryRows() []summaryRow {
	return []summaryRow{
		{"repo", orUnset(c.Repo)},
		{"home", c.Home},
		{"config file", c.ConfigPath},
		{"--root", orUnset(c.Root)},
		{KeyAll, strconv.FormatBool(c.All)},
		{KeyModel, orUnset(c.Model)},
		{KeySubagentModel, orUnset(c.SubagentModel)},
		{KeyDaemonURL, c.DaemonURL},
		{KeyHTTPPort, c.HTTPPort},
		{KeyWebPort, c.WebPort},
		{KeyWebUse, strconv.FormatBool(c.WebUse)},
		{KeyWebSearchUse, strconv.FormatBool(c.WebSearchUse)},
		{KeyLearningUse, strconv.FormatBool(c.LearningUse)},
		{KeySearxngURL, orUnset(c.SearxngURL) + searxngManagedNote(c)},
		{KeyMcpUse, strconv.FormatBool(c.McpUse)},
		{"mcp.json", filepath.Join(c.Home, "mcp.json")},
		{KeyDbmcpUse, strconv.FormatBool(c.DbmcpUse)},
		{"dbmcp spec", dbmcpSpecSummary(c)},
		{KeyScriptUse, strconv.FormatBool(c.ScriptUse)},
		{KeyVector, strconv.FormatBool(c.Vector)},
		{KeyEmbedding, orUnset(c.Embedding)},
		{KeyEmbedModel, c.EmbedModel},
		{KeyIndexPath, c.IndexPath},
		{KeySocket, c.Socket},
	}
}

// optionalSummaryRows are shown only when they differ from the default.
func (c *Config) optionalSummaryRows() []summaryRow {
	candidates := []struct {
		show bool
		row  summaryRow
	}{
		{len(c.Repos) > 0, summaryRow{KeyReposSel, strings.Join(c.Repos, ",")}},
		{c.NoIndex, summaryRow{KeyNoIndex, "true"}},
		{c.Verbose, summaryRow{KeyVerbose, "true"}},
		{c.Reasoning != "", summaryRow{KeyReasoning, c.Reasoning}},
		{c.McpConfig != "", summaryRow{KeyMcpConfig, c.McpConfig}},
		{c.DbmcpSpec != "", summaryRow{KeyDbmcpSpec, c.DbmcpSpec}},
		{c.DbmcpBin != "", summaryRow{KeyDbmcpBin, c.DbmcpBin}},
		{c.ScriptPython != "", summaryRow{KeyScriptPython, c.ScriptPython}},
		{c.ScriptMcp != "", summaryRow{KeyScriptMcp, c.ScriptMcp}},
	}

	var rows []summaryRow
	for _, candidate := range candidates {
		if candidate.show {
			rows = append(rows, candidate.row)
		}
	}

	return rows
}

// passthroughSummaryRows lists provider keys in name order, values masked.
func (c *Config) passthroughSummaryRows() []summaryRow {
	keys := make([]string, 0, len(c.Passthrough))
	for k := range c.Passthrough {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	rows := make([]summaryRow, 0, len(keys))
	for _, k := range keys {
		rows = append(rows, summaryRow{k, mask(c.Passthrough[k])})
	}

	return rows
}

// formatSummary aligns the values in one column.
func formatSummary(rows []summaryRow) string {
	width := 0
	for _, r := range rows {
		width = max(width, len(r[0]))
	}

	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "  %-*s  %s\n", width, r[0], r[1])
	}

	return b.String()
}

func dbmcpSpecSummary(c *Config) string {
	path, found := c.DbmcpSpecFile()
	if found {
		return path
	}
	return path + " (not found)"
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
	if c.SearxngURL == "" && c.WebUse && c.WebSearchUse {
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
